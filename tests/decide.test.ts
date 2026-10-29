import { describe, expect, it } from "vitest";
import { annotateItems, decideQuantity, effectiveDryRun } from "../src/lib/decide";
import type { ConnectedVariant } from "../src/lib/plan";
import type { TargetItem } from "../src/lib/types";

const fb = (onlyWhenZero: boolean) => ({ quantity: 10, onlyWhenZero });

describe("decideQuantity", () => {
  it("uses an exact target quantity", () => {
    expect(decideQuantity(3, 9, fb(false))).toEqual({ kind: "set", value: 3, viaFallback: false });
  });
  it("uses the fallback when the target hides its number", () => {
    expect(decideQuantity(null, 4, fb(false))).toEqual({ kind: "set", value: 10, viaFallback: true });
  });
  it("keeps a positive count when onlyWhenZero", () => {
    expect(decideQuantity(null, 4, fb(true))).toEqual({ kind: "keep", reason: "kept-current" });
  });
  it("fills at zero when onlyWhenZero", () => {
    expect(decideQuantity(null, 0, fb(true))).toEqual({ kind: "set", value: 10, viaFallback: true });
  });
  it("keeps everything alone when there is no fallback", () => {
    expect(decideQuantity(null, 4, null)).toEqual({ kind: "keep", reason: "hidden" });
  });
});

describe("annotateItems", () => {
  const item = (sku: string): TargetItem => ({ title: "T", sku, handle: sku, quantity: null, state: "hidden" });
  const cv = (o: Partial<ConnectedVariant>): ConnectedVariant => ({
    inventoryItemId: "i",
    title: "x",
    vendorSku: "A-1",
    siblingCount: 1,
    tracked: true,
    available: 5,
    ...o,
  });

  it("attaches your current quantity by vendor SKU, ignoring case and spaces", () => {
    const items = [item("a-1"), item("B-2")];
    annotateItems(items, [cv({ vendorSku: " A-1 ", available: 7 })]);
    expect(items[0]).toMatchObject({ inYourStore: true, yours: 7 });
    expect(items[1]).toMatchObject({ inYourStore: false });
  });

  it("flags products your store cannot update", () => {
    const items = [item("A-1"), item("A-2")];
    annotateItems(items, [cv({ siblingCount: 3 }), cv({ vendorSku: "A-2", tracked: false })]);
    expect(items[0].blocked).toMatch(/variants/);
    expect(items[1].blocked).toMatch(/tracking/);
  });
});

describe("effectiveDryRun", () => {
  it("lets a manual real run write even while updates are off (it is the explicit Update button)", () => {
    expect(effectiveDryRun("manual", false, false)).toBe(false);
  });
  it("turns a scheduled run into a check-only run while updates are off", () => {
    expect(effectiveDryRun("schedule", false, false)).toBe(true);
  });
  it("writes on schedule when updates are on", () => {
    expect(effectiveDryRun("schedule", false, true)).toBe(false);
  });
  it("never upgrades a dry run into a real one", () => {
    expect(effectiveDryRun("manual", true, true)).toBe(true);
    expect(effectiveDryRun("schedule", true, true)).toBe(true);
  });
});
