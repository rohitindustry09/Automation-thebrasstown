import type { ConnectedVariant, FallbackOptions } from "./plan";
import type { RunRecord, TargetItem } from "./types";

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

/** A finished "check only" run whose saved scrape can be applied without scraping the target again. */
export const isUsableCheck = (
  run: Pick<RunRecord, "dryRun" | "status" | "startedAt" | "finishedAt" | "scrape" | "targetDomain">,
  now: number,
  maxHours: number,
  targetDomain: string,
): boolean =>
  run.dryRun &&
  run.status === "success" &&
  !!run.scrape &&
  !!run.finishedAt &&
  run.targetDomain === targetDomain && // never apply one store's numbers after the target was changed
  now - Date.parse(run.startedAt) < maxHours * 3_600_000; // age counts from when the pages were read, not when the run ended

/** Saved scrape progress is reused only on purpose: an explicit "Resume", an automatic retry, or a restart. */
export const mayResumeCheckpoint = (run: { resume?: boolean; attempt?: number }): boolean =>
  run.resume === true || (run.attempt ?? 0) > 0;

/**
 * Whether a run only previews. While "update quantities" is switched off, scheduled runs just check;
 * a manual real run (the "Update products" button) still writes because the user asked for it.
 */
export const effectiveDryRun = (trigger: "schedule" | "manual", dryRun: boolean, updatesEnabled: boolean): boolean =>
  dryRun || (trigger === "schedule" && !updatesEnabled);

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
    item.yourTitle = v?.title;
    item.yourSku = v?.sku?.trim() || undefined;
    item.blocked = !v
      ? undefined
      : options.requireSingleVariant && v.siblingCount > 1
        ? `product has ${v.siblingCount} variants`
        : !v.tracked
          ? "inventory tracking is off"
          : undefined;
  }
}
