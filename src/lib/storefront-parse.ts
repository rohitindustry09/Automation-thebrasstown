import * as cheerio from "cheerio";

/** Only an explicit inventory count counts; generic keys like "quantity" are cart/line data. */
const INVENTORY_KEY = /^(inventory_quantity|inventoryquantity)$/i;
const MAX_DEPTH = 8;
const PRODUCT_SCOPES = [".product__content", ".product-single", "main"];
const STOCK_TEXT =
  /\bonly\s+(\d+)\s+(?:items?\s+|units?\s+)?(?:left|in\s+stock)\b|\b(\d+)\s+(?:items?\s+|units?\s+)?left(?:\s+in\s+stock)?\b|\b(\d+)\s+in\s+stock\b/i;

const GAP = String.raw`(?:\s|&nbsp;|&#160;|<[^>]*>)*`;
/** Superset of what STOCK_TEXT can match once tags are removed, so most pages skip the DOM parse. */
const MAYBE_STOCK = new RegExp(
  String.raw`inventory_quantity|only${GAP}\d|\d${GAP}(?:items?${GAP}|units?${GAP})?(?:left|in${GAP}stock)\b`,
  "i",
);

/** Fast text check: false means the page cannot hold an exact count, so parsing it would be wasted CPU. */
export const mayContainQuantity = (html: string): boolean => MAYBE_STOCK.test(html);

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function findInventoryKey(value: unknown, expectedSku: string | undefined, depth = 0): number | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInventoryKey(item, expectedSku, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  // A count that sits next to a different SKU belongs to another product (related items, recommendations).
  const ownSku = typeof record.sku === "string" ? record.sku.trim().toLowerCase() : null;
  const isOther = expectedSku !== undefined && ownSku !== null && ownSku !== expectedSku;
  if (!isOther) for (const [key, val] of entries) if (INVENTORY_KEY.test(key) && isCount(val)) return val;
  for (const [, val] of entries) {
    const found = findInventoryKey(val, expectedSku, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** An element whose class says backorder (a notice box). CSS rules and scripts are not tags, so they never match. */
const BACKORDER_ELEMENT = /<[a-z][^>]*\bclass\s*=\s*["'][^"']*back-?order[^"']*["']/i;
/** Visible wording such as "This product is currently on backorder". */
const BACKORDER_TEXT = /currently\s+on\s+(?:<[^>]*>|\s|&nbsp;|&#160;)*back-?order/i;

/**
 * Does this product page say the product is on backorder (made to order, in production)? Such a product has
 * no stock to count, so its quantity is 0. A bare "backorder" in a stylesheet or a filter script must not count:
 * many in-stock pages carry the notice's CSS.
 */
export const isBackorderPage = (html: string): boolean => BACKORDER_ELEMENT.test(html) || BACKORDER_TEXT.test(html);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Looks for an exact stock count a store chooses to publish on a product page:
 * embedded JSON (`inventory_quantity`) or a theme's rendered low-stock text ("Only 3 left").
 * Returns null when the page exposes nothing — Shopify never sends counts otherwise.
 */
export function extractQuantityFromHtml(html: string, expect: { sku?: string } = {}): number | null {
  if (!mayContainQuantity(html)) return null;
  const expectedSku = expect.sku?.trim().toLowerCase();
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"], script[type="application/json"]').toArray()) {
    const found = findInventoryKey(parseJson($(el).contents().text()), expectedSku);
    if (found !== null) return found;
  }

  const $scope = PRODUCT_SCOPES.map((s) => $(s)).find(($el) => $el.length > 0) ?? $("body");
  const $clean = $scope.clone();
  $clean.find("script, style, noscript").remove();
  const match = $clean.text().match(STOCK_TEXT);
  if (!match) return null;
  const n = Number.parseInt(match[1] ?? match[2] ?? match[3], 10);
  return Number.isFinite(n) ? n : null;
}
