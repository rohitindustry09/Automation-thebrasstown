import { describe, expect, it } from "vitest";
import { buildTargetIndex, planUpdates, type ConnectedVariant } from "../src/lib/plan";

const cv = (o: Partial<ConnectedVariant>): ConnectedVariant => ({
  inventoryItemId: "gid://shopify/InventoryItem/1",
  title: "Brass Diya",
  vendorSku: "VS-1",
  siblingCount: 1,
  tracked: true,
  available: 5,
  ...o,
});

describe("buildTargetIndex", () => {
  it("normalises SKUs, clamps negatives, and tolerates identical duplicates", () => {
    const { index, duplicates, conflicts } = buildTargetIndex([
      { sku: " VS-1 ", quantity: 7 },
      { sku: "vs-1", quantity: 7 },
      { sku: "VS-2", quantity: -3 },
      { sku: "", quantity: 4 },
    ]);
    expect(index.get("vs-1")).toBe(7);
    expect(index.get("vs-2")).toBe(0);
    expect(index.size).toBe(2);
    expect(duplicates).toBe(1);
    expect(conflicts.size).toBe(0);
  });

  it("drops a SKU listed twice with different quantities instead of guessing", () => {
    const { index, conflicts } = buildTargetIndex([
      { sku: "VS-1", quantity: 0 },
      { sku: "vs-1", quantity: 5 },
    ]);
    expect(index.has("vs-1")).toBe(false);
    expect(conflicts.has("vs-1")).toBe(true);
  });
});

describe("planUpdates", () => {
  const index = new Map<string, number | null>([["vs-1", 12], ["vs-2", 5]]);

  it("queues an update when quantities differ", () => {
    const plan = planUpdates(index, [cv({})]);
    expect(plan.updates).toEqual([
      { sku: "VS-1", inventoryItemId: "gid://shopify/InventoryItem/1", quantity: 12, activate: false },
    ]);
    expect(plan.changes[0]).toMatchObject({ sku: "VS-1", from: 5, to: 12, status: "updated" });
  });

  it("marks equal quantities unchanged", () => {
    const plan = planUpdates(index, [cv({ available: 12 })]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.counters.unchanged).toBe(1);
  });

  it("flags SKUs missing from the target without touching them", () => {
    const plan = planUpdates(index, [cv({ vendorSku: "NOPE" })]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.counters.notInTarget).toBe(1);
  });

  it("ignores variants with no vendor sku", () => {
    const plan = planUpdates(index, [cv({ vendorSku: null })]);
    expect(plan.changes).toHaveLength(0);
  });

  it("skips targets whose exact quantity is hidden instead of guessing", () => {
    const hidden = new Map<string, number | null>([["vs-1", null]]);
    const plan = planUpdates(hidden, [cv({})]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.counters.skipped).toBe(1);
    expect(plan.counters.notInTarget).toBe(0);
    expect(plan.changes[0].note).toMatch(/exact quantity/);
  });

  describe("fallback quantity for hidden targets", () => {
    const hidden = new Map<string, number | null>([["vs-1", null]]);

    it("sets the global quantity when the target hides its number", () => {
      const plan = planUpdates(hidden, [cv({ available: 2 })], { requireSingleVariant: true, fallback: { quantity: 10, onlyWhenZero: false } });
      expect(plan.updates).toEqual([{ sku: "VS-1", inventoryItemId: "gid://shopify/InventoryItem/1", quantity: 10, activate: false }]);
      expect(plan.changes[0]).toMatchObject({ from: 2, to: 10, status: "updated" });
      expect(plan.changes[0].note).toMatch(/fallback/);
    });

    it("with onlyWhenZero, keeps a positive count so sales are not overwritten", () => {
      const plan = planUpdates(hidden, [cv({ available: 4 })], { requireSingleVariant: true, fallback: { quantity: 10, onlyWhenZero: true } });
      expect(plan.updates).toHaveLength(0);
      expect(plan.counters.unchanged).toBe(1);
    });

    it("with onlyWhenZero, refills when the store is at 0", () => {
      const plan = planUpdates(hidden, [cv({ available: 0 })], { requireSingleVariant: true, fallback: { quantity: 10, onlyWhenZero: true } });
      expect(plan.updates[0].quantity).toBe(10);
    });

    it("never overrides an exact target quantity", () => {
      const exact = new Map<string, number | null>([["vs-1", 3]]);
      const plan = planUpdates(exact, [cv({ available: 9 })], { requireSingleVariant: true, fallback: { quantity: 10, onlyWhenZero: false } });
      expect(plan.updates[0].quantity).toBe(3);
    });
  });

  it("leaves products alone when told to (unreadable page, conflicting duplicate)", () => {
    const plan = planUpdates(index, [cv({})], {
      requireSingleVariant: true,
      fallback: { quantity: 10, onlyWhenZero: false },
      skipReasons: new Map([["vs-1", "target page could not be read this run"]]),
    });
    expect(plan.updates).toHaveLength(0);
    expect(plan.counters.skipped).toBe(1);
    expect(plan.changes[0].note).toMatch(/could not be read/);
  });

  it("skips untracked inventory", () => {
    const plan = planUpdates(index, [cv({ tracked: false })]);
    expect(plan.counters.skipped).toBe(1);
    expect(plan.updates).toHaveLength(0);
  });

  it("skips multi-variant products when matching on a product metafield", () => {
    const plan = planUpdates(index, [cv({ siblingCount: 3 })]);
    expect(plan.counters.skipped).toBe(1);
    expect(plan.changes[0].note).toMatch(/variants/);
  });

  it("activates inventory not yet stocked at the location", () => {
    const plan = planUpdates(index, [cv({ available: null })]);
    expect(plan.updates[0]).toMatchObject({ quantity: 12, activate: true });
  });
});
