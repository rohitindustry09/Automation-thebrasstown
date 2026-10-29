import type { StoreCredentials } from "./types";

const API_VERSION = process.env.SHOPIFY_API_VERSION ?? "2026-04";
const DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const MAX_ATTEMPTS = 5;

export class ShopifyError extends Error {}

/** Accepts "https://Shop.myshopify.com/admin" style input; returns the bare domain or null. */
export function normalizeDomain(input: string): string | null {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  return DOMAIN_RE.test(host) ? host : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: { currentlyAvailable: number; restoreRate: number };
    };
  };
}

export async function shopifyGraphQL<T>(
  store: StoreCredentials,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const domain = normalizeDomain(store.domain);
  if (!domain) throw new ShopifyError(`Invalid store domain "${store.domain}" — expected your-store.myshopify.com`);
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": store.token },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw new ShopifyError(`${domain}: network error — ${(err as Error).message}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) throw new ShopifyError(`${domain}: HTTP ${res.status} after ${attempt} attempts`);
      const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
      await sleep(retryAfter * 1000);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyError(`${domain}: access token rejected (HTTP ${res.status}) — check the token and its scopes`);
    }
    if (!res.ok) throw new ShopifyError(`${domain}: HTTP ${res.status}`);

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < MAX_ATTEMPTS) {
        await sleep(2000 * attempt);
        continue;
      }
      throw new ShopifyError(`${domain}: ${body.errors.map((e) => e.message).join("; ")}`);
    }
    if (!body.data) throw new ShopifyError(`${domain}: empty response`);

    // Stay under the leaky-bucket limit: wait if the next query might not fit.
    const status = body.extensions?.cost?.throttleStatus;
    const cost = body.extensions?.cost?.requestedQueryCost ?? 0;
    if (status && status.currentlyAvailable < cost * 1.2) {
      await sleep(((cost * 1.2 - status.currentlyAvailable) / status.restoreRate) * 1000);
    }
    return body.data;
  }
}

export interface ShopInfo {
  name: string;
  domain: string;
  locations: { id: string; name: string; active: boolean }[];
  /** Product metafield definitions the store has created (the ones selectable as Vendor SKU) */
  metafields: { namespace: string; key: string; name: string; type: string }[];
}

/** Verifies the token works and lists locations (needs read_products + read_locations). */
export async function fetchShopInfo(store: StoreCredentials): Promise<ShopInfo> {
  const data = await shopifyGraphQL<{
    shop: { name: string; myshopifyDomain: string };
    locations: { nodes: { id: string; name: string; isActive: boolean }[] };
    metafieldDefinitions: { nodes: { namespace: string; key: string; name: string; type: { name: string } }[] };
  }>(
    store,
    `{
      shop { name myshopifyDomain }
      locations(first: 50) { nodes { id name isActive } }
      metafieldDefinitions(ownerType: PRODUCT, first: 250) { nodes { namespace key name type { name } } }
    }`,
  );
  return {
    name: data.shop.name,
    domain: data.shop.myshopifyDomain,
    locations: data.locations.nodes.map((l) => ({ id: l.id, name: l.name, active: l.isActive })),
    metafields: data.metafieldDefinitions.nodes.map((m) => ({ namespace: m.namespace, key: m.key, name: m.name, type: m.type.name })),
  };
}
