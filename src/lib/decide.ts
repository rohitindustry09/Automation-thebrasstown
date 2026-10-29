import type { ConnectedVariant, FallbackOptions } from "./plan";
import type { TargetItem } from "./types";

export const normalizeSku = (sku: string) => sku.trim().toLowerCase();

export type Decision =
  | { kind: "set"; value: number; viaFallback: boolean }
  | { kind: "keep"; reason: "hidden" | "kept-current" };

/**
 * What your store should hold for one product: the target's exact number, the hidden-quantity
 * fallback, or nothing. `yours` is your store's current quantity (null when not stocked there).
 */
export function decideQuantity(target: number | null, yours: number | null, fallback?: FallbackOptions | null): Decision {
  if (target !== null) return { kind: "set", value: target, viaFallback: false };
  if (!fallback) return { kind: "keep", reason: "hidden" };
  if (fallback.onlyWhenZero && yours !== null && yours > 0) return { kind: "keep", reason: "kept-current" };
  return { kind: "set", value: fallback.quantity, viaFallback: true };
}

/** Attaches your store's current quantity to each target item (matched by vendor SKU), in place. */
export function annotateItems(
  items: TargetItem[],
  connected: ConnectedVariant[],
  options: { requireSingleVariant?: boolean } = { requireSingleVariant: true },
): void {
  const bySku = new Map<string, ConnectedVariant>();
  for (const v of connected) {
    const key = v.vendorSku ? normalizeSku(v.vendorSku) : "";
    if (key && !bySku.has(key)) bySku.set(key, v);
  }
  for (const item of items) {
    const v = bySku.get(normalizeSku(item.sku));
    item.inYourStore = Boolean(v);
    item.yours = v ? v.available : undefined;
    item.blocked = !v
      ? undefined
      : options.requireSingleVariant && v.siblingCount > 1
        ? `product has ${v.siblingCount} variants`
        : !v.tracked
          ? "inventory tracking is off"
          : undefined;
  }
}
