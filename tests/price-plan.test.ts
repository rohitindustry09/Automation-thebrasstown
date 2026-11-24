import { describe, expect, it } from "vitest";
import { buildTargetIndex, planUpdates, type ConnectedVariant, type TargetVariant } from "../src/lib/plan";
import { buildProductVariantsBulkUpdate } from "../src/lib/price-destination";
import { reconcilePriceRows, type PlannedPriceUpdate } from "../src/lib/price-plan";
import type { PriceChange } from "../src/lib/types";
import type { PricingSettings } from "../src/lib/pricing";
import { buildTitleModel } from "../src/lib/title-match";

const pricing: PricingSettings = {
  enabled: true,
  markup: { type: "percent", value: 5 },
  compare: { mode: "random", minPercent: 20, maxPercent: 30 },
  rounding: "none",
};

const cv = (o: Partial<ConnectedVariant> = {}): ConnectedVariant => ({
  inventoryItemId: "gid://shopify/InventoryItem/1",
  variantId: "gid://shopify/ProductVariant/1",
  productId: "gid://shopify/Product/1",
  title: "Brass Diya",
  vendorSku: "VS-1",
  siblingCount: 1,
  tracked: true,
  available: 5,
  price: 1000,
  compareAtPrice: null,
  ...o,
});

// Target prices travel with the grouped target variants, the same input the sync passes in.
const planWithGroups = (targets: TargetVariant[], connected: ConnectedVariant[], p: PricingSettings | null = pricing) => {
  const { index, groups } = buildTargetIndex(targets);
  return planUpdates(index, connected, { requireSingleVariant: true, pricing: p, priceGroups: groups });
};

describe("planUpdates pricing", () => {
  const target: TargetVariant = { sku: "VS-1", quantity: 12, title: "Brass Diya", price: 2000, compareAt: 3000 };

  it("plans a price update from the target's selling price", () => {
    const r = planWithGroups([target], [cv()]);
    expect(r.priceUpdates).toHaveLength(1);
    expect(r.priceUpdates[0]).toMatchObject({ sku: "VS-1", variantId: "gid://shopify/ProductVariant/1", productId: "gid://shopify/Product/1", price: 2100 });
    expect(r.priceUpdates[0].compareAt).toBeGreaterThan(2100);
    expect(r.priceChanges[0]).toMatchObject({ status: "updated", fromPrice: 1000, toPrice: 2100 });
  });

  it("does nothing when pricing is off", () => {
    const r = planWithGroups([target], [cv()], null);
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges).toHaveLength(0);
  });

  it("leaves a product unchanged when the new prices equal the current ones", () => {
    const first = planWithGroups([target], [cv()]);
    const { price, compareAt } = first.priceUpdates[0];
    const r = planWithGroups([target], [cv({ price, compareAtPrice: compareAt })]);
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges[0].status).toBe("unchanged");
  });

  it("still plans the price when the quantity is hidden or tracking is off", () => {
    const hidden = planWithGroups([{ ...target, quantity: null }], [cv({ tracked: false })]);
    expect(hidden.updates).toHaveLength(0);
    expect(hidden.priceUpdates).toHaveLength(1);
  });

  it("skips a target with no usable price and says why", () => {
    const r = planWithGroups([{ ...target, price: null }], [cv()]);
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges[0]).toMatchObject({ status: "skipped" });
  });

  it("skips a product on your store that cannot be addressed", () => {
    const r = planWithGroups([target], [cv({ variantId: undefined })]);
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges[0].status).toBe("skipped");
  });

  it("does not price a product with several variants when matching at product level", () => {
    const r = planWithGroups([target], [cv({ siblingCount: 3 })]);
    expect(r.priceUpdates).toHaveLength(0);
  });

  it("keeps quantity planning exactly as before when pricing is on", () => {
    const withPricing = planWithGroups([target], [cv()]);
    const without = planWithGroups([target], [cv()], null);
    expect(withPricing.updates).toEqual(without.updates);
    expect(withPricing.counters).toEqual(without.counters);
  });
});

describe("buildProductVariantsBulkUpdate", () => {
  it("formats prices as two-decimal strings and clears a compare price with null", () => {
    const input = buildProductVariantsBulkUpdate([
      { sku: "A", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", price: 2100, compareAt: 2520.5 },
      { sku: "B", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/2", price: 99, compareAt: null },
    ]);
    expect(input).toEqual([
      {
        productId: "gid://shopify/Product/1",
        variants: [
          { id: "gid://shopify/ProductVariant/1", price: "2100.00", compareAtPrice: "2520.50" },
          { id: "gid://shopify/ProductVariant/2", price: "99.00", compareAtPrice: null },
        ],
      },
    ]);
  });

  it("leaves compareAtPrice out entirely when it must not be touched", () => {
    const [group] = buildProductVariantsBulkUpdate([
      { sku: "A", productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/1", price: 10, compareAt: undefined },
    ]);
    expect(group.variants[0]).not.toHaveProperty("compareAtPrice");
  });
});

describe("planUpdates backorder", () => {
  const backordered: TargetVariant = { sku: "VS-1", quantity: 0, title: "Brass Diya", price: 2000, compareAt: null, backorder: true };

  it("sets a matched product on backorder at the target to 0 and flags the change", () => {
    const { index, groups } = buildTargetIndex([backordered]);
    const r = planUpdates(index, [cv({ available: 5 })], { requireSingleVariant: true, priceGroups: groups });
    expect(r.updates).toEqual([{ sku: "VS-1", inventoryItemId: "gid://shopify/InventoryItem/1", quantity: 0, activate: false }]);
    expect(r.changes[0]).toMatchObject({ status: "updated", to: 0, backorder: true });
    expect(r.changes[0].note).toMatch(/backorder/i);
  });

  it("does nothing for a backordered target SKU that is not on your store", () => {
    const { index, groups } = buildTargetIndex([{ ...backordered, sku: "OTHER" }]);
    const r = planUpdates(index, [cv()], { requireSingleVariant: true, priceGroups: groups });
    expect(r.updates).toHaveLength(0);
  });
});

describe("prices do not depend on the quantity side", () => {
  const t = (o: Partial<TargetVariant> = {}): TargetVariant => ({ sku: "VS-1", quantity: null, title: "Brass Diya", price: 2000, compareAt: 3000, ...o });

  it("still prices a product whose target page could not be read (quantity skipped, price not)", () => {
    const { index, groups } = buildTargetIndex([t()]);
    const r = planUpdates(index, [cv()], {
      requireSingleVariant: true,
      pricing,
      priceGroups: groups,
      skipReasons: new Map([["vs-1", "target page could not be read this run"]]),
    });
    expect(r.updates).toHaveLength(0);
    expect(r.changes[0]).toMatchObject({ status: "skipped", note: "target page could not be read this run" });
    expect(r.priceUpdates).toHaveLength(1);
    expect(r.counters.matched).toBe(0); // quantity counters are unchanged by pricing
  });

  it("lists a multi-variant product as a skipped price with the reason, instead of silently dropping it", () => {
    const { index, groups } = buildTargetIndex([t({ quantity: 4 })]);
    const r = planUpdates(index, [cv({ siblingCount: 3 })], { requireSingleVariant: true, pricing, priceGroups: groups });
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges).toEqual([expect.objectContaining({ status: "skipped", note: expect.stringMatching(/3 variants/) })]);
  });

  it("lists a SKU that belongs to a different product at the target as a skipped price with the reason", () => {
    const lantern = "Bhunes Brass Lantern, Bastar Tribal Art, Vintage Look, 11.5 Inch";
    const nandi = "Copper Nandi Idol, Handcrafted Nandishwara Murti for Pooja, Home Temple, Vastu Decor & Gifting, Brown, 2.5 Inch, 1 Piece";
    const targets = [t({ title: lantern, quantity: 3 }), t({ title: nandi, quantity: 0 })];
    const { index, groups } = buildTargetIndex(targets);
    const connected = [cv({ title: "Brass Diya Oil Lamp Traditional Pooja Lamp 4 Inch" })];
    const model = buildTitleModel([...targets.map((x) => x.title ?? ""), ...connected.map((c) => c.title)]);
    const r = planUpdates(index, connected, { requireSingleVariant: true, pricing, titles: { model, groups } });
    expect(r.priceUpdates).toHaveLength(0);
    expect(r.priceChanges).toEqual([expect.objectContaining({ status: "skipped", note: expect.stringMatching(/different title/) })]);
  });
});

describe("reconcilePriceRows", () => {
  const row = (variant: number, sku = "SHARED"): PriceChange => ({ sku, variantId: `gid://shopify/ProductVariant/${variant}`, title: `P${variant}`, fromPrice: 1, toPrice: 2, fromCompare: null, toCompare: null, status: "updated" });
  const upd = (variant: number, sku = "SHARED"): PlannedPriceUpdate => ({ sku, productId: `gid://shopify/Product/${variant}`, variantId: `gid://shopify/ProductVariant/${variant}`, price: 2, compareAt: undefined });

  it("matches each outcome to its own product even when two products share a vendor SKU", () => {
    const rows = reconcilePriceRows([row(1), row(2)], [{ update: upd(1), error: null }, { update: upd(2), error: "Price is invalid" }]);
    expect(rows[0].status).toBe("updated");
    expect(rows[1]).toMatchObject({ status: "failed", note: "Price is invalid" });
  });

  it("marks a row that was never attempted (run stopped) as skipped", () => {
    const rows = reconcilePriceRows([row(1), row(2)], [{ update: upd(1), error: null }]);
    expect(rows[1]).toMatchObject({ status: "skipped", note: "stopped before this was written" });
  });

  it("leaves rows that were not meant to be written alone, and does not modify its input", () => {
    const original = [{ ...row(3), status: "skipped" as const, note: "x" }, row(1)];
    const copy = JSON.parse(JSON.stringify(original));
    const rows = reconcilePriceRows(original, [{ update: upd(1), error: null }]);
    expect(rows[0]).toEqual(original[0]);
    expect(original).toEqual(copy);
  });
});
