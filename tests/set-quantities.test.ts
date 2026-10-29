import { describe, expect, it } from "vitest";
import { buildSetQuantitiesInput } from "../src/lib/inventory-destination";

describe("buildSetQuantitiesInput (Admin API 2026-04)", () => {
  const input = buildSetQuantitiesInput("gid://shopify/Location/1", [
    { sku: "A", inventoryItemId: "gid://shopify/InventoryItem/10", quantity: 7, activate: false },
  ]);

  it("no longer sends ignoreCompareQuantity, which 2026-04 rejects", () => {
    expect(input).not.toHaveProperty("ignoreCompareQuantity");
  });

  it("sets absolute quantities with an explicit null changeFromQuantity", () => {
    expect(input.name).toBe("available");
    expect(input.quantities).toEqual([
      { inventoryItemId: "gid://shopify/InventoryItem/10", locationId: "gid://shopify/Location/1", quantity: 7, changeFromQuantity: null },
    ]);
  });
});
