import * as cheerio from "cheerio";

/** Only an explicit inventory count counts; generic keys like "quantity" are cart/line data. */
const INVENTORY_KEY = /^(inventory_quantity|inventoryquantity)$/i;
const MAX_DEPTH = 8;
const PRODUCT_SCOPES = [".product__content", ".product-single", "main"];
const STOCK_TEXT =
  /\bonly\s+(\d+)\s+(?:items?\s+|units?\s+)?(?:left|in\s+stock)\b|\b(\d+)\s+(?:items?\s+|units?\s+)?left(?:\s+in\s+stock)?\b|\b(\d+)\s+in\s+stock\b/i;

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function findInventoryKey(value: unknown, depth = 0): number | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findInventoryKey(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, val] of entries) if (INVENTORY_KEY.test(key) && isCount(val)) return val;
  for (const [, val] of entries) {
    const found = findInventoryKey(val, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

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
export function extractQuantityFromHtml(html: string): number | null {
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"], script[type="application/json"]').toArray()) {
    const found = findInventoryKey(parseJson($(el).contents().text()));
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
