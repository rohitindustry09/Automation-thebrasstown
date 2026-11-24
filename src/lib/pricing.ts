export type MarkupType = "percent" | "fixed";
/** off: leave your compare price alone · mirror: target's compare price + the same markup · random: target's selling price + a per-product random % */
export type CompareMode = "off" | "mirror" | "random";
export type Rounding = "none" | "whole" | "ends-9";

export interface PricingSettings {
  enabled: boolean;
  /** Added to the target's selling price: a percentage (5 = +5%) or an amount in your store's currency */
  markup: { type: MarkupType; value: number };
  compare: { mode: CompareMode; minPercent: number; maxPercent: number };
  rounding: Rounding;
}

export const DEFAULT_PRICING: PricingSettings = {
  enabled: false,
  markup: { type: "percent", value: 5 },
  compare: { mode: "off", minPercent: 20, maxPercent: 30 },
  rounding: "none",
};

export const MAX_MARKUP_PERCENT = 1000;
export const MAX_MARKUP_FIXED = 1_000_000;
export const MAX_COMPARE_PERCENT = 1000;

/** `undefined` = do not touch the compare price; `null` = clear it. */
export interface ComputedPrices {
  price: number;
  compareAt: number | null | undefined;
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Rounds a price the way a shop would show it. */
export function roundPrice(value: number, rounding: Rounding): number {
  if (rounding === "whole") return Math.round(value);
  if (rounding === "ends-9" && value >= 10) return Math.ceil((value - 9) / 10) * 10 + 9; // up to the next ...9, never down
  if (rounding === "ends-9") return Math.round(value);
  return cents(value);
}

/**
 * A stable number in [0, 1) for one SKU (FNV-1a). Using it instead of Math.random() gives every product its
 * own compare price, but the same product keeps the same one on every run, so a scheduled run never churns prices.
 */
export function skuFraction(sku: string): number {
  let h = 0x811c9dc5;
  for (const ch of sku.trim().toLowerCase()) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x1_0000_0000;
}

const markUp = (value: number, markup: PricingSettings["markup"]) =>
  markup.type === "percent" ? value * (1 + markup.value / 100) : value + markup.value;

const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Your selling and compare prices for one product, from the target's. Null when the target's price cannot be
 * trusted (missing, zero, not a number): such a product is left alone rather than guessed.
 */
export function computePrices(
  target: { price: number | null | undefined; compareAt: number | null | undefined },
  settings: PricingSettings,
  sku: string,
): ComputedPrices | null {
  if (!usable(target.price)) return null;
  const price = roundPrice(markUp(target.price, settings.markup), settings.rounding);
  if (!usable(price)) return null;

  const { mode, minPercent, maxPercent } = settings.compare;
  let compareAt: number | null | undefined;
  if (mode === "mirror") {
    compareAt = usable(target.compareAt) && target.compareAt > target.price ? roundPrice(markUp(target.compareAt, settings.markup), settings.rounding) : null;
  } else if (mode === "random") {
    const percent = minPercent + skuFraction(sku) * (maxPercent - minPercent);
    // The increase always goes on the target's selling price; the target's own compare price is not used.
    compareAt = roundPrice(target.price * (1 + percent / 100), settings.rounding);
  }
  // A "was" price at or below the selling price would show nothing or look wrong: drop it.
  if (typeof compareAt === "number" && compareAt <= price) compareAt = null;
  return { price, compareAt };
}

/** Same price to the cent? (Shopify stores money with two decimals.) */
export const samePrice = (a: number | null | undefined, b: number | null | undefined): boolean =>
  (a ?? null) === null || (b ?? null) === null ? (a ?? null) === (b ?? null) : Math.abs((a as number) - (b as number)) < 0.005;
