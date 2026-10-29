import { decideQuantity, normalizeSku } from "./decide";
import { emptyCounters, type RunChange, type RunCounters } from "./types";

export interface TargetVariant {
  sku: string;
  /** null = in stock but the storefront does not publish the number */
  quantity: number | null;
}

export interface ConnectedVariant {
  inventoryItemId: string;
  title: string;
  /** Value of the "vendor sku" metafield, null when empty */
  vendorSku: string | null;
  /** Variants on the owning product, used to reject ambiguous product-level matches */
  siblingCount: number;
  tracked: boolean;
  /** Available quantity at the chosen location, null when not stocked there */
  available: number | null;
}

export interface PlannedUpdate {
  sku: string;
  inventoryItemId: string;
  quantity: number;
  activate: boolean;
}

export interface FallbackOptions {
  /** Quantity to set when the target store hides its number */
  quantity: number;
  /** Only fill when your store is at 0 / not stocked, so sales are not overwritten */
  onlyWhenZero: boolean;
}

export interface Plan {
  updates: PlannedUpdate[];
  changes: RunChange[];
  counters: RunCounters;
}

export { normalizeSku };

export function buildTargetIndex(variants: TargetVariant[]) {
  const index = new Map<string, number | null>();
  let duplicates = 0;
  for (const v of variants) {
    const key = normalizeSku(v.sku);
    if (!key) continue;
    if (index.has(key)) {
      duplicates++;
      continue;
    }
    index.set(key, v.quantity === null ? null : Math.max(0, Math.trunc(v.quantity)));
  }
  return { index, duplicates };
}

export function planUpdates(
  index: ReadonlyMap<string, number | null>,
  connected: ConnectedVariant[],
  options: { requireSingleVariant?: boolean; fallback?: FallbackOptions | null } = { requireSingleVariant: true },
): Plan {
  const counters = emptyCounters();
  const changes: RunChange[] = [];
  const updates: PlannedUpdate[] = [];

  for (const v of connected) {
    const sku = v.vendorSku?.trim();
    if (!sku) continue;
    const base = { sku, title: v.title, from: v.available };

    if (options.requireSingleVariant && v.siblingCount > 1) {
      counters.skipped++;
      changes.push({ ...base, to: null, status: "skipped", note: `product has ${v.siblingCount} variants — use a variant-level metafield` });
      continue;
    }
    let target = index.get(normalizeSku(sku));
    if (target === undefined) {
      counters.notInTarget++;
      changes.push({ ...base, to: null, status: "not-in-target", note: "SKU not found in target store" });
      continue;
    }
    counters.matched++;
    const decision = decideQuantity(target, v.available, options.fallback);
    if (decision.kind === "keep") {
      if (decision.reason === "kept-current") {
        counters.unchanged++;
        changes.push({ ...base, to: v.available, status: "unchanged", note: "hidden at target; kept your current count" });
      } else {
        counters.skipped++;
        changes.push({ ...base, to: null, status: "skipped", note: "target store does not publish an exact quantity (in stock)" });
      }
      continue;
    }
    target = decision.value;
    const fallbackUsed = decision.viaFallback;
    if (!v.tracked) {
      counters.skipped++;
      changes.push({ ...base, to: target, status: "skipped", note: "inventory tracking is off for this variant" });
      continue;
    }
    if (v.available === target) {
      counters.unchanged++;
      changes.push({ ...base, to: target, status: "unchanged" });
      continue;
    }
    updates.push({ sku, inventoryItemId: v.inventoryItemId, quantity: target, activate: v.available === null });
    changes.push({ ...base, to: target, status: "updated", ...(fallbackUsed ? { note: "fallback quantity (target hides its number)" } : {}) });
  }
  return { updates, changes, counters };
}
