import { isCancelled, throwIfCancelled } from "./cancel";
import type { ConnectedVariant, PlannedUpdate } from "./plan";
import { shopifyGraphQL } from "./shopify";
import type { MatchSettings, StoreCredentials } from "./types";

const BATCH_SIZE = 100;

const QUERY = `
query ConnectedVariants($cursor: String, $ns: String!, $key: String!, $loc: ID!, $onProduct: Boolean!, $onVariant: Boolean!) {
  productVariants(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title
      sku
      metafield(namespace: $ns, key: $key) @include(if: $onVariant) { value }
      product {
        title
        variantsCount { count }
        metafield(namespace: $ns, key: $key) @include(if: $onProduct) { value }
      }
      inventoryItem {
        id
        tracked
        inventoryLevel(locationId: $loc) { quantities(names: ["available"]) { quantity } }
      }
    }
  }
}`;

const SET_QUANTITIES = `
mutation SetQuantities($input: InventorySetQuantitiesInput!, $key: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } }
}`;

const ACTIVATE = `
mutation Activate($item: ID!, $loc: ID!) {
  inventoryActivate(inventoryItemId: $item, locationId: $loc) { userErrors { field message } }
}`;

interface Page {
  productVariants: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      title: string;
      sku: string | null;
      metafield?: { value: string } | null;
      product: { title: string; variantsCount: { count: number } | null; metafield?: { value: string } | null };
      inventoryItem: {
        id: string;
        tracked: boolean;
        inventoryLevel: { quantities: { quantity: number }[] } | null;
      };
    }[];
  };
}

/** Lists every variant of the connected store that carries a vendor-sku metafield. */
export async function fetchConnectedVariants(
  store: StoreCredentials,
  match: MatchSettings,
  locationId: string,
  onProgress: (count: number) => void,
): Promise<{ all: number; withVendorSku: ConnectedVariant[]; stocked: number; units: number }> {
  const withVendorSku: ConnectedVariant[] = [];
  let all = 0;
  let stocked = 0;
  let units = 0;
  let cursor: string | null = null;
  do {
    throwIfCancelled();
    const data: Page = await shopifyGraphQL<Page>(store, QUERY, {
      cursor,
      ns: match.namespace,
      key: match.key,
      loc: locationId,
      onProduct: match.owner === "product",
      onVariant: match.owner === "variant",
    });
    for (const n of data.productVariants.nodes) {
      all++;
      const atLocation = n.inventoryItem.inventoryLevel;
      if (atLocation) {
        stocked++;
        units += atLocation.quantities[0]?.quantity ?? 0;
      }
      const vendorSku = (match.owner === "product" ? n.product.metafield : n.metafield)?.value?.trim() || null;
      if (!vendorSku) continue;
      const level = n.inventoryItem.inventoryLevel;
      withVendorSku.push({
        inventoryItemId: n.inventoryItem.id,
        title: n.product.title + (n.title && n.title !== "Default Title" ? ` — ${n.title}` : ""),
        sku: n.sku,
        vendorSku,
        siblingCount: n.product.variantsCount?.count ?? 1,
        tracked: n.inventoryItem.tracked,
        available: level ? (level.quantities[0]?.quantity ?? 0) : null,
      });
    }
    onProgress(all);
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
  } while (cursor);
  return { all, withVendorSku, stocked, units };
}

const LOCATION_SAMPLE = `{
  productVariants(first: 50) { nodes { inventoryItem { inventoryLevels(first: 10) { nodes { location { id } } } } } }
}`;

/**
 * Shopify needs a location to write stock to. Use the active location where most of your products
 * are actually stocked (sampled), so quantities are read and written where the stock really is.
 */
export async function pickStockLocation(
  store: StoreCredentials,
  active: { id: string; name: string }[],
): Promise<{ id: string; name: string }> {
  if (active.length === 0) throw new Error("The connected store has no active location");
  if (active.length === 1) return active[0];
  const data = await shopifyGraphQL<{
    productVariants: { nodes: { inventoryItem: { inventoryLevels: { nodes: { location: { id: string } }[] } } }[] };
  }>(store, LOCATION_SAMPLE);
  const counts = new Map<string, number>();
  for (const v of data.productVariants.nodes) {
    for (const level of v.inventoryItem.inventoryLevels.nodes) {
      counts.set(level.location.id, (counts.get(level.location.id) ?? 0) + 1);
    }
  }
  return active.reduce((best, l) => ((counts.get(l.id) ?? 0) > (counts.get(best.id) ?? 0) ? l : best), active[0]);
}

interface UserErrors {
  userErrors: { field: string[] | null; message: string }[];
}

export interface BatchResult {
  update: PlannedUpdate;
  error: string | null;
}

async function activate(store: StoreCredentials, inventoryItemId: string, locationId: string) {
  const data = await shopifyGraphQL<{ inventoryActivate: UserErrors }>(store, ACTIVATE, {
    item: inventoryItemId,
    loc: locationId,
  });
  const err = data.inventoryActivate.userErrors[0];
  if (err) throw new Error(err.message);
}

/**
 * Absolute "available" quantities. API 2026-04 dropped `ignoreCompareQuantity`; an explicit
 * `changeFromQuantity: null` is how a write skips the compare-and-set check (omitting it is an error).
 */
export function buildSetQuantitiesInput(locationId: string, batch: PlannedUpdate[]) {
  return {
    name: "available",
    reason: "correction",
    quantities: batch.map((u) => ({
      inventoryItemId: u.inventoryItemId,
      locationId,
      quantity: u.quantity,
      changeFromQuantity: null,
    })),
  };
}

async function setQuantities(store: StoreCredentials, locationId: string, batch: PlannedUpdate[]) {
  const data = await shopifyGraphQL<{ inventorySetQuantities: UserErrors }>(store, SET_QUANTITIES, {
    key: crypto.randomUUID(),
    input: buildSetQuantitiesInput(locationId, batch),
  });
  return data.inventorySetQuantities.userErrors;
}

async function applySingle(store: StoreCredentials, locationId: string, update: PlannedUpdate): Promise<BatchResult> {
  try {
    const [err] = await setQuantities(store, locationId, [update]);
    return { update, error: err ? err.message : null };
  } catch (err) {
    return { update, error: (err as Error).message };
  }
}

/**
 * Sets absolute "available" quantities at the location, in batches. A Stop request ends it at the
 * next batch; what was already written is returned so the run record can say exactly what happened.
 */
export async function applyUpdates(
  store: StoreCredentials,
  locationId: string,
  updates: PlannedUpdate[],
  onBatch: (done: number) => void,
): Promise<{ results: BatchResult[]; cancelled: boolean }> {
  const results: BatchResult[] = [];
  const ready: PlannedUpdate[] = [];
  let cancelled = false;

  for (const u of updates) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    if (!u.activate) {
      ready.push(u);
      continue;
    }
    try {
      await activate(store, u.inventoryItemId, locationId);
      ready.push(u);
    } catch (err) {
      results.push({ update: u, error: `could not stock at location: ${(err as Error).message}` });
    }
  }

  for (let i = 0; i < ready.length && !cancelled; i += BATCH_SIZE) {
    if (isCancelled()) {
      cancelled = true;
      break;
    }
    const batch = ready.slice(i, i + BATCH_SIZE);
    try {
      const errors = await setQuantities(store, locationId, batch);
      if (errors.length === 0) {
        batch.forEach((update) => results.push({ update, error: null }));
      } else {
        // A user error rejects the whole batch; retry one by one so one bad item cannot block the rest.
        for (const update of batch) results.push(await applySingle(store, locationId, update));
      }
    } catch (err) {
      batch.forEach((update) => results.push({ update, error: (err as Error).message }));
    }
    onBatch(results.length);
  }
  return { results, cancelled };
}
