import { isCancelled } from "./cancel";
import type { PlannedPriceUpdate } from "./price-plan";
import { shopifyGraphQL } from "./shopify";
import type { StoreCredentials } from "./types";

/** Products written in one request (each is its own aliased mutation, so one bad product cannot sink the rest). */
const PRODUCTS_PER_REQUEST = 10;

export interface PriceWriteResult {
  update: PlannedPriceUpdate;
  error: string | null;
}

interface VariantInput {
  id: string;
  price: string;
  compareAtPrice?: string | null;
}
interface ProductInput {
  productId: string;
  variants: VariantInput[];
}

const money = (n: number) => n.toFixed(2);

/** Groups price updates per product, the shape `productVariantsBulkUpdate` takes. */
export function buildProductVariantsBulkUpdate(updates: PlannedPriceUpdate[]): ProductInput[] {
  const byProduct = new Map<string, VariantInput[]>();
  for (const u of updates) {
    const variant: VariantInput = {
      id: u.variantId,
      price: money(u.price),
      // undefined must stay out of the payload: sending null would erase a compare price we were told to keep
      ...(u.compareAt === undefined ? {} : { compareAtPrice: u.compareAt === null ? null : money(u.compareAt) }),
    };
    byProduct.set(u.productId, [...(byProduct.get(u.productId) ?? []), variant]);
  }
  return [...byProduct].map(([productId, variants]) => ({ productId, variants }));
}

/** One request that updates several products, each as an aliased mutation. */
export function buildBatchMutation(count: number): string {
  const defs = Array.from({ length: count }, (_, i) => `$p${i}: ID!, $v${i}: [ProductVariantsBulkInput!]!`).join(", ");
  const calls = Array.from(
    { length: count },
    (_, i) => `m${i}: productVariantsBulkUpdate(productId: $p${i}, variants: $v${i}) { userErrors { field message } }`,
  ).join("\n  ");
  return `mutation PriceBatch(${defs}) {\n  ${calls}\n}`;
}

type BatchData = Record<string, { userErrors: { field: string[] | null; message: string }[] }>;

const isAccessError = (message: string) => /access denied|write_products|required access/i.test(message);

async function writeBatch(store: StoreCredentials, products: ProductInput[], updatesOf: Map<string, PlannedPriceUpdate[]>): Promise<PriceWriteResult[]> {
  const variables: Record<string, unknown> = {};
  products.forEach((p, i) => {
    variables[`p${i}`] = p.productId;
    variables[`v${i}`] = p.variants;
  });
  const data = await shopifyGraphQL<BatchData>(store, buildBatchMutation(products.length), variables);
  return products.flatMap((p, i) => {
    const err = data[`m${i}`]?.userErrors[0];
    return (updatesOf.get(p.productId) ?? []).map((update) => ({ update, error: err ? err.message : null }));
  });
}

/**
 * Writes selling and compare prices, a few products per request. A Stop request ends it at the next request;
 * a missing `write_products` permission ends it at once (every later write would fail the same way).
 */
export async function applyPriceUpdates(
  store: StoreCredentials,
  updates: PlannedPriceUpdate[],
  onBatch: (done: number) => void,
): Promise<{ results: PriceWriteResult[]; cancelled: boolean }> {
  const results: PriceWriteResult[] = [];
  const products = buildProductVariantsBulkUpdate(updates);
  const updatesOf = new Map<string, PlannedPriceUpdate[]>();
  for (const u of updates) updatesOf.set(u.productId, [...(updatesOf.get(u.productId) ?? []), u]);
  let cancelled = false;

  for (let i = 0; i < products.length; i += PRODUCTS_PER_REQUEST) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const batch = products.slice(i, i + PRODUCTS_PER_REQUEST);
    try {
      results.push(...(await writeBatch(store, batch, updatesOf)));
    } catch (err) {
      const message = (err as Error).message;
      const failed = batch.flatMap((p) => updatesOf.get(p.productId) ?? []).map((update) => ({ update, error: message }));
      results.push(...failed);
      if (isAccessError(message)) {
        const rest = products.slice(i + PRODUCTS_PER_REQUEST).flatMap((p) => updatesOf.get(p.productId) ?? []);
        results.push(...rest.map((update) => ({ update, error: "stopped: the token cannot write prices (needs the write_products scope)" })));
        break;
      }
    }
    onBatch(results.length);
  }
  return { results, cancelled };
}
