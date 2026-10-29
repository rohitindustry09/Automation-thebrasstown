import type { TargetVariant } from "./plan";
import type { RunProgress, TargetItem } from "./types";
import { throwIfCancelled } from "./cancel";
import { ScrapeError, normalizePublicDomain, publicGet } from "./public-fetch";
import { extractQuantityFromHtml } from "./storefront-parse";

const PAGE_SIZE = 250;
const MAX_PAGES = 400;
const PAGE_WORKERS = Number(process.env.SCRAPE_WORKERS ?? 6);

interface RawVariant {
  sku: string | null;
  available?: boolean;
}
interface RawProduct {
  handle: string;
  title?: string;
  variants: RawVariant[];
}

export interface ResumeState {
  results: Record<string, number | null>;
  save: (results: Record<string, number | null>) => Promise<void>;
}

const SAVE_EVERY = 25;

export interface TargetScrape {
  variants: TargetVariant[];
  /** SKUs seen in stock whose exact number the storefront does not publish */
  hidden: number;
  outOfStock: number;
  exposed: number;
}

async function fetchCatalog(origin: string, onProgress: (n: number) => void): Promise<RawProduct[]> {
  const products: RawProduct[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    throwIfCancelled();
    const { status, text } = await publicGet(`${origin}/products.json?limit=${PAGE_SIZE}&page=${page}`, "application/json");
    let batch: RawProduct[];
    try {
      if (status !== 200) throw new Error(`HTTP ${status}`);
      batch = (JSON.parse(text) as { products?: RawProduct[] }).products ?? [];
      if (!Array.isArray(batch)) throw new Error("no products array");
    } catch (err) {
      if (page === 1) throw new ScrapeError(`${origin} is not a readable Shopify storefront (/products.json: ${(err as Error).message})`);
      throw new ScrapeError(`Catalog page ${page} failed: ${(err as Error).message}`);
    }
    if (batch.length === 0) break;
    products.push(...batch);
    onProgress(products.length);
    if (batch.length < PAGE_SIZE) break;
  }
  return products;
}

/**
 * Domain-only scrape of a public Shopify storefront (no token). Exact numbers exist only where
 * the store publishes them:
 *  - variant `available: false`        -> exactly 0
 *  - single-variant product page shows a count ("Only 3 left", inventory_quantity) -> that count
 *  - everything else                   -> hidden (not guessed)
 */
export async function scrapeTargetInventory(
  domain: string,
  onProgress: (phase: string, progress?: RunProgress) => void,
  /** Receives the live item list once (entries are updated in place as pages are checked) */
  onItems: (items: TargetItem[]) => void = () => undefined,
  /** Page results from an earlier, unfinished attempt (reused, not re-fetched) and a saver for new ones */
  resume: ResumeState = { results: {}, save: async () => undefined },
): Promise<TargetScrape> {
  const host = normalizePublicDomain(domain);
  if (!host) throw new ScrapeError(`"${domain}" is not a valid public domain`);
  const origin = `https://${host}`;

  onProgress("Reading target catalog");
  const products = await fetchCatalog(origin, (n) => onProgress(`Reading target catalog (${n} products)`));

  const variants: TargetVariant[] = [];
  let hidden = 0;
  let outOfStock = 0;
  let exposed = 0;

  // Single-variant products with something in stock are the only pages worth opening.
  const toOpen: RawProduct[] = [];
  const items: TargetItem[] = [];
  const itemByHandle = new Map<string, TargetItem>();
  for (const p of products) {
    const withSku = p.variants.filter((v) => v.sku?.trim());
    const title = p.title ?? p.handle;
    for (const v of withSku) {
      if (v.available === false) {
        variants.push({ sku: v.sku as string, quantity: 0 });
        items.push({ title, sku: v.sku as string, handle: p.handle, quantity: 0, state: "sold-out" });
        outOfStock++;
      }
    }
    const inStock = withSku.filter((v) => v.available !== false);
    if (inStock.length === 0) continue;
    if (p.variants.length === 1) {
      toOpen.push(p);
      const item: TargetItem = { title, sku: inStock[0].sku as string, handle: p.handle, quantity: null, state: "pending" };
      items.push(item);
      itemByHandle.set(p.handle, item);
    } else {
      for (const v of inStock) {
        variants.push({ sku: v.sku as string, quantity: null });
        items.push({ title, sku: v.sku as string, handle: p.handle, quantity: null, state: "hidden" });
      }
      hidden += inStock.length;
    }
  }

  onItems(items);
  let done = 0;
  const total = toOpen.length;
  onProgress(`Checking product pages (0/${total})`, { current: null, exact: outOfStock, hidden, checked: 0, total, catalogTotal: products.length, soldOut: outOfStock });
  const queue = [...toOpen];
  const results = { ...resume.results };
  let sinceSave = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      throwIfCancelled();
      const sku = p.variants[0].sku as string;
      let quantity: number | null = null;
      if (p.handle in results) {
        quantity = results[p.handle]; // already checked in an earlier attempt
      } else {
        try {
          const { status, text } = await publicGet(`${origin}/products/${encodeURIComponent(p.handle)}`, "text/html");
          if (status === 200) {
            quantity = extractQuantityFromHtml(text);
            results[p.handle] = quantity; // only a real page read is remembered; failures get retried next time
            if (++sinceSave >= SAVE_EVERY) {
              sinceSave = 0;
              await resume.save(results);
            }
          }
        } catch {
          quantity = null; // a single unreachable page must not abort the whole scrape
        }
      }
      variants.push({ sku, quantity });
      const item = itemByHandle.get(p.handle);
      if (item) {
        item.quantity = quantity;
        item.state = quantity === null ? "hidden" : "exact";
      }
      if (quantity === null) hidden++;
      else exposed++;
      done++;
      onProgress(`Checking product pages (${done}/${total})`, {
        current: p.title ?? p.handle,
        exact: outOfStock + exposed,
        hidden,
        checked: done,
        total,
        catalogTotal: products.length,
        soldOut: outOfStock,
      });
    }
  };
  try {
    await Promise.all(Array.from({ length: PAGE_WORKERS }, worker));
  } finally {
    await resume.save(results); // stop, error or finish: never lose what was already read
  }

  return { variants, hidden, outOfStock, exposed };
}
