import type { ConnectedVariant, TargetVariant } from "./plan";
import { computePrices, samePrice, type PricingSettings } from "./pricing";
import type { PriceChange } from "./types";

export interface PlannedPriceUpdate {
  sku: string;
  productId: string;
  variantId: string;
  price: number;
  /** undefined = leave the compare price as it is, null = clear it */
  compareAt: number | null | undefined;
}

/** A price row for a product whose price is deliberately left alone, with the reason (so nothing is dropped silently). */
export const priceSkipRow = (v: ConnectedVariant, sku: string, note: string): PriceChange => ({
  sku,
  variantId: v.variantId,
  title: v.title,
  fromPrice: v.price ?? null,
  toPrice: null,
  fromCompare: v.compareAtPrice ?? null,
  toCompare: v.compareAtPrice ?? null,
  status: "skipped",
  note,
});

/**
 * Turns the write results back into the run's price rows: failed writes become "failed" with the error, rows that
 * were never attempted (the run was stopped) become "skipped". Matched per variant, not per SKU, because two of
 * your products can share a vendor SKU. Returns new rows; the input is left alone.
 */
export function reconcilePriceRows(rows: PriceChange[], results: { update: PlannedPriceUpdate; error: string | null }[]): PriceChange[] {
  const byVariant = new Map(results.map((r) => [r.update.variantId, r]));
  return rows.map((c) => {
    if (c.status !== "updated") return c;
    const r = c.variantId ? byVariant.get(c.variantId) : undefined;
    if (!r) return { ...c, status: "skipped" as const, note: "stopped before this was written" };
    return r.error ? { ...c, status: "failed" as const, note: r.error } : c;
  });
}

/** What to do with one matched product's prices: a write to make (or not) and the row to show for it. */
export function planPrice(
  v: ConnectedVariant,
  sku: string,
  target: TargetVariant | undefined,
  pricing: PricingSettings,
): { update: PlannedPriceUpdate | null; change: PriceChange } {
  const fromPrice = v.price ?? null;
  const fromCompare = v.compareAtPrice ?? null;
  const row = (status: PriceChange["status"], toPrice: number | null, toCompare: number | null, note?: string): PriceChange => ({
    sku,
    variantId: v.variantId,
    title: v.title,
    fromPrice,
    toPrice,
    fromCompare,
    toCompare,
    status,
    ...(note ? { note } : {}),
  });

  if (!v.variantId || !v.productId || v.price === undefined) {
    return { update: null, change: row("skipped", null, fromCompare, "your store's price could not be read for this product") };
  }
  const next = computePrices({ price: target?.price, compareAt: target?.compareAt }, pricing, sku);
  if (!next) return { update: null, change: row("skipped", null, fromCompare, "target price is missing or not usable") };

  const toCompare = next.compareAt === undefined ? fromCompare : next.compareAt;
  if (samePrice(fromPrice, next.price) && samePrice(fromCompare, toCompare)) {
    return { update: null, change: row("unchanged", next.price, toCompare) };
  }
  return {
    update: { sku, productId: v.productId, variantId: v.variantId, price: next.price, compareAt: next.compareAt },
    change: row("updated", next.price, toCompare),
  };
}
