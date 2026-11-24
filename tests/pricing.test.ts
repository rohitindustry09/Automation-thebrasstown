import { describe, expect, it } from "vitest";
import { computePrices, roundPrice, skuFraction, type PricingSettings } from "../src/lib/pricing";

const base: PricingSettings = {
  enabled: true,
  markup: { type: "percent", value: 5 },
  compare: { mode: "random", minPercent: 20, maxPercent: 30 },
  rounding: "none",
};
const withSettings = (o: Partial<PricingSettings>): PricingSettings => ({ ...base, ...o });

describe("roundPrice", () => {
  it("none keeps two decimals", () => expect(roundPrice(2099.996, "none")).toBe(2100));
  it("whole rounds to a whole number", () => expect(roundPrice(2100.5, "whole")).toBe(2101));
  it("ends-9 rounds up to the next price ending in 9, never down", () => {
    expect(roundPrice(2100, "ends-9")).toBe(2109);
    expect(roundPrice(2103, "ends-9")).toBe(2109);
    expect(roundPrice(2109, "ends-9")).toBe(2109);
    expect(roundPrice(2109.5, "ends-9")).toBe(2119);
    expect(roundPrice(2110, "ends-9")).toBe(2119);
  });
  it("ends-9 falls back to a whole number for very small prices", () => expect(roundPrice(4.4, "ends-9")).toBe(4));
});

describe("skuFraction", () => {
  it("is stable for the same SKU and ignores case and spaces", () => {
    expect(skuFraction("BHU-1")).toBe(skuFraction(" bhu-1 "));
  });
  it("stays inside [0, 1) and differs between SKUs", () => {
    const a = skuFraction("A");
    const b = skuFraction("B");
    for (const f of [a, b]) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
    expect(a).not.toBe(b);
  });
});

describe("computePrices", () => {
  it("adds a percentage to the target's selling price", () => {
    const r = computePrices({ price: 2000, compareAt: 3000 }, withSettings({ compare: { mode: "off", minPercent: 20, maxPercent: 30 } }), "S1");
    expect(r).toEqual({ price: 2100, compareAt: undefined });
  });

  it("adds a fixed amount to the target's selling price", () => {
    const r = computePrices({ price: 2000, compareAt: null }, withSettings({ markup: { type: "fixed", value: 5 }, compare: { mode: "off", minPercent: 20, maxPercent: 30 } }), "S1");
    expect(r?.price).toBe(2005);
  });

  it("random compare price lands 20-30% above the target's SELLING price, whatever its own compare price is", () => {
    for (const sku of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      const r = computePrices({ price: 2000, compareAt: 3000 }, base, sku);
      expect(r?.price).toBe(2100);
      const uplift = (r?.compareAt as number) / 2000;
      expect(uplift).toBeGreaterThanOrEqual(1.2 - 0.001);
      expect(uplift).toBeLessThanOrEqual(1.3 + 0.001);
    }
  });

  it("random works the same when the target shows no compare price", () => {
    for (const sku of ["A", "B", "C", "D"]) {
      const r = computePrices({ price: 2000, compareAt: null }, base, sku);
      expect(r?.price).toBe(2100);
      const uplift = (r?.compareAt as number) / 2000;
      expect(uplift).toBeGreaterThanOrEqual(1.2 - 0.001);
      expect(uplift).toBeLessThanOrEqual(1.3 + 0.001);
    }
  });

  it("drops the compare price when the markup is so big it ends up at or below the selling price", () => {
    const r = computePrices({ price: 2000, compareAt: null }, withSettings({ markup: { type: "percent", value: 50 } }), "A");
    expect(r?.price).toBe(3000);
    expect(r?.compareAt).toBeNull();
  });

  it("matches the worked example: target 2000 -> selling 2109, compare 20-30% over 2000", () => {
    const r = computePrices({ price: 2000, compareAt: null }, withSettings({ rounding: "ends-9" }), "BHU5288A");
    expect(r?.price).toBe(2109);
    expect(r?.compareAt as number).toBeGreaterThanOrEqual(2000 * 1.2);
    expect(r?.compareAt as number).toBeLessThanOrEqual(2000 * 1.3 + 9);
    expect((r?.compareAt as number) % 10).toBe(9);
  });

  it("gives different products different compare prices, but the same product the same one every run", () => {
    const a1 = computePrices({ price: 2000, compareAt: null }, base, "SKU-A");
    const a2 = computePrices({ price: 2000, compareAt: null }, base, "SKU-A");
    const b = computePrices({ price: 2000, compareAt: null }, base, "SKU-B");
    expect(a1).toEqual(a2);
    expect(a1?.compareAt).not.toBe(b?.compareAt);
  });

  it("mirror scales the target's compare price by the same markup", () => {
    const r = computePrices({ price: 2000, compareAt: 3000 }, withSettings({ compare: { mode: "mirror", minPercent: 20, maxPercent: 30 } }), "S1");
    expect(r).toEqual({ price: 2100, compareAt: 3150 });
  });

  it("mirror clears the compare price when the target shows none", () => {
    const r = computePrices({ price: 2000, compareAt: null }, withSettings({ compare: { mode: "mirror", minPercent: 20, maxPercent: 30 } }), "S1");
    expect(r?.compareAt).toBeNull();
  });

  it("mirror ignores a target compare price that is not above its selling price", () => {
    const r = computePrices({ price: 2000, compareAt: 1500 }, withSettings({ compare: { mode: "mirror", minPercent: 20, maxPercent: 30 } }), "S1");
    expect(r?.compareAt).toBeNull();
  });

  it("never leaves a compare price at or below the selling price after rounding", () => {
    const r = computePrices({ price: 3, compareAt: null }, withSettings({ rounding: "whole", markup: { type: "fixed", value: 0 }, compare: { mode: "random", minPercent: 1, maxPercent: 2 } }), "S1");
    expect(r?.compareAt).toBeNull();
  });

  it("applies rounding to both prices", () => {
    const r = computePrices({ price: 2000, compareAt: null }, withSettings({ rounding: "ends-9" }), "S1");
    expect(r?.price).toBe(2109);
    expect((r?.compareAt as number) % 10).toBe(9);
  });

  it.each([null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY])("returns null for an unusable target price (%s)", (price) => {
    expect(computePrices({ price: price as number, compareAt: null }, base, "S1")).toBeNull();
  });
});
