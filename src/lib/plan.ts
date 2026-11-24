import { decideQuantity, normalizeSku } from "./decide";
import { planPrice, priceSkipRow, type PlannedPriceUpdate } from "./price-plan";
import type { PricingSettings } from "./pricing";
import { MIN_TITLE_SCORE, TITLE_AMBIGUITY_MARGIN, rankByTitle, type TitleModel } from "./title-match";
import { emptyCounters, type PriceChange, type RunChange, type RunCounters } from "./types";

export interface TargetVariant {
  sku: string;
  /** null = in stock but the storefront does not publish the number */
  quantity: number | null;
  /** The product's title at the target, used to tell apart different products that share a SKU */
  title?: string;
  /** The target's page says this product is on backorder; its quantity is 0 */
  backorder?: boolean;
  /** The target's selling price and "was" price for this SKU, when known */
  price?: number | null;
  compareAt?: number | null;
}

export interface ConnectedVariant {
  inventoryItemId: string;
  title: string;
  /** The variant's own SKU on your store (not the vendor-SKU metafield) */
  sku?: string | null;
  /** Value of the "vendor sku" metafield, null when empty */
  vendorSku: string | null;
  /** Variants on the owning product, used to reject ambiguous product-level matches */
  siblingCount: number;
  tracked: boolean;
  /** Available quantity at the chosen location, null when not stocked there */
  available: number | null;
  /** Needed to write prices (all optional so quantity-only callers keep working) */
  variantId?: string;
  productId?: string;
  /** Current selling and compare price on your store */
  price?: number | null;
  compareAtPrice?: number | null;
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

export type { PlannedPriceUpdate };

export interface Plan {
  updates: PlannedUpdate[];
  priceUpdates: PlannedPriceUpdate[];
  priceChanges: PriceChange[];
  changes: RunChange[];
  counters: RunCounters;
}

export { normalizeSku };

export function buildTargetIndex(variants: TargetVariant[]) {
  const index = new Map<string, number | null>();
  /** Every target product per SKU, so a SKU used by two products can be settled by title */
  const groups = new Map<string, TargetVariant[]>();
  const conflicts = new Map<string, string>();
  let duplicates = 0;
  for (const v of variants) {
    const key = normalizeSku(v.sku);
    if (!key) continue;
    const quantity = v.quantity === null ? null : Math.max(0, Math.trunc(v.quantity));
    groups.set(key, [...(groups.get(key) ?? []), { ...v, quantity }]);
    if (index.has(key)) {
      duplicates++;
      // Same SKU listed twice with different answers (e.g. sold out on one, in stock on the other): do not guess.
      if (index.get(key) !== quantity) conflicts.set(key, "same SKU appears twice at the target with different quantities");
      continue;
    }
    index.set(key, quantity);
  }
  for (const key of conflicts.keys()) index.delete(key);
  return { index, groups, duplicates, conflicts };
}

export function planUpdates(
  index: ReadonlyMap<string, number | null>,
  connected: ConnectedVariant[],
  options: {
    requireSingleVariant?: boolean;
    fallback?: FallbackOptions | null;
    /** normalized SKU -> reason it must be left alone this run (unreadable page, conflicting duplicate) */
    skipReasons?: ReadonlyMap<string, string>;
    /** When given, a SKU match must also have a matching title; a SKU shared by two products goes to the closer title */
    titles?: { model: TitleModel; groups: ReadonlyMap<string, TargetVariant[]> };
    /** When enabled, also plan selling/compare prices from the target's prices */
    pricing?: PricingSettings | null;
    /** Target variants per SKU, for prices when no `titles` are given */
    priceGroups?: ReadonlyMap<string, TargetVariant[]>;
  } = { requireSingleVariant: true },
): Plan {
  const counters = emptyCounters();
  const changes: RunChange[] = [];
  const updates: PlannedUpdate[] = [];
  const priceUpdates: PlannedPriceUpdate[] = [];
  const priceChanges: PriceChange[] = [];
  const pricing = options.pricing?.enabled ? options.pricing : null;
  const storeCounts = new Map<string, number>();
  for (const v of connected) {
    const k = v.vendorSku ? normalizeSku(v.vendorSku) : "";
    if (k) storeCounts.set(k, (storeCounts.get(k) ?? 0) + 1);
  }

  for (const v of connected) {
    const sku = v.vendorSku?.trim();
    if (!sku) continue;
    const base = { sku, title: v.title, from: v.available };
    const skipPrice = (note: string) => {
      if (pricing) priceChanges.push(priceSkipRow(v, sku, note));
    };

    if (options.requireSingleVariant && v.siblingCount > 1) {
      counters.skipped++;
      changes.push({ ...base, to: null, status: "skipped", note: `product has ${v.siblingCount} variants — use a variant-level metafield` });
      skipPrice(`product has ${v.siblingCount} variants, so it cannot be priced from one target SKU`);
      continue;
    }
    // A quantity-side reason (unreadable page, ...) holds back the quantity only; the price comes from the public catalog.
    const skipReason = options.skipReasons?.get(normalizeSku(sku));
    const key = normalizeSku(sku);
    let target: number | null | undefined;
    let targetVariant: TargetVariant | undefined;
    const group = options.titles?.groups.get(key);
    // The title only decides when the SKU belongs to several products; a single match is trusted (stores retitle a lot).
    const shared = group !== undefined && (group.length > 1 || (storeCounts.get(key) ?? 0) > 1);
    if (options.titles && group && shared) {
      {
        const ranked = rankByTitle(options.titles.model, v.title, group.map((g) => ({ title: g.title ?? "", value: g })));
        const best = ranked[0];
        if (best.score < MIN_TITLE_SCORE) {
          counters.skipped++;
          const note = `a target product has this SKU but a different title ("${best.title.slice(0, 60)}"), so it was not used`;
          changes.push({ ...base, to: null, status: "skipped", note });
          skipPrice(note);
          continue;
        }
        const lookAlike = ranked.slice(1).some(
          (r) => r.score >= MIN_TITLE_SCORE && best.score - r.score < TITLE_AMBIGUITY_MARGIN && r.value.quantity !== best.value.quantity,
        );
        if (lookAlike) {
          counters.skipped++;
          const note = "two target products share this SKU and their titles look equally close, so it was not guessed";
          changes.push({ ...base, to: null, status: "skipped", note });
          skipPrice(note);
          continue;
        }
        target = best.value.quantity;
        targetVariant = best.value;
      }
    } else {
      target = group ? group[0].quantity : index.get(key);
      targetVariant = (options.titles?.groups ?? options.priceGroups)?.get(key)?.[0];
    }
    if (target === undefined) {
      if (skipReason) {
        counters.skipped++;
        changes.push({ ...base, to: null, status: "skipped", note: skipReason });
        continue;
      }
      counters.notInTarget++;
      changes.push({ ...base, to: null, status: "not-in-target", note: "SKU not found in target store" });
      continue;
    }
    // Prices do not depend on stock or on the quantity side: a hidden quantity, untracked inventory or an
    // unreadable product page must not stop a price update.
    if (pricing) {
      const priced = planPrice(v, sku, targetVariant, pricing);
      priceChanges.push(priced.change);
      if (priced.update) priceUpdates.push(priced.update);
    }
    if (skipReason) {
      counters.skipped++;
      changes.push({ ...base, to: null, status: "skipped", note: skipReason });
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
    changes.push({
      ...base,
      to: target,
      status: "updated",
      ...(fallbackUsed ? { note: "fallback quantity (target hides its number)" } : {}),
      ...(targetVariant?.backorder ? { note: "target product is on backorder, so quantity 0", backorder: true } : {}),
    });
  }
  return { updates, priceUpdates, priceChanges, changes, counters };
}
