import type { ConnectedVariant, FallbackOptions } from "./plan";
import { MIN_TITLE_SCORE, WARN_TITLE_SCORE, buildTitleModel, rankByTitle } from "./title-match";
import type { RunChange, RunRecord, TargetItem } from "./types";

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

/**
 * Products that would drop from stock to 0 on the strength of the scrape alone. A confirmed backorder is excluded:
 * the target said so in words, so it cannot be the flaky-scrape / maintenance-page case the zero guard protects against.
 */
export const countUnconfirmedZeros = (changes: RunChange[]): number =>
  changes.filter((c) => c.status === "updated" && c.to === 0 && (c.from ?? 0) > 0 && !c.backorder).length;

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

/** The saved target list may be written to your store only while it is recent and from the current target. */
export const isUsableList = (meta: { domain: string; scrapedAt: string } | null, now: number, maxHours: number, domain: string): boolean =>
  !!meta && meta.domain === domain && now - Date.parse(meta.scrapedAt) < maxHours * 3_600_000;

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
  const bySku = new Map<string, ConnectedVariant[]>();
  for (const v of connected) {
    const key = v.vendorSku ? normalizeSku(v.vendorSku) : "";
    if (key) bySku.set(key, [...(bySku.get(key) ?? []), v]);
  }
  const model = buildTitleModel([...items.map((i) => i.title), ...connected.map((c) => c.title)]);
  const targetCounts = new Map<string, number>();
  for (const i of items) targetCounts.set(normalizeSku(i.sku), (targetCounts.get(normalizeSku(i.sku)) ?? 0) + 1);
  for (const item of items) {
    // The SKU finds the candidates; the title says which one is really this product.
    const key = normalizeSku(item.sku);
    const ranked = rankByTitle(model, item.title, (bySku.get(key) ?? []).map((c) => ({ title: c.title, value: c })));
    const best = ranked[0];
    // Only a SKU shared by several products needs the title to decide; a single match is trusted (stores retitle a lot).
    const shared = ranked.length > 1 || (targetCounts.get(key) ?? 0) > 1;
    const v = best && (!shared || best.score >= MIN_TITLE_SCORE) ? best.value : undefined;
    item.titleMismatch = best && !v ? best.title : undefined;
    item.titleWarning = Boolean(v) && !shared && best.score < WARN_TITLE_SCORE;
    item.inYourStore = Boolean(v);
    item.yours = v ? v.available : undefined;
    item.yourTitle = v?.title;
    item.yourSku = v?.sku?.trim() || undefined;
    item.yourPrice = v?.price;
    item.yourCompareAt = v?.compareAtPrice;
    item.blocked = !v
      ? undefined
      : options.requireSingleVariant && v.siblingCount > 1
        ? `product has ${v.siblingCount} variants`
        : !v.tracked
          ? "inventory tracking is off"
          : undefined;
  }
}
