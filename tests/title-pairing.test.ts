import { describe, expect, it } from "vitest";
import { annotateItems } from "../src/lib/decide";
import { buildTargetIndex, planUpdates, type ConnectedVariant } from "../src/lib/plan";
import { buildTitleModel } from "../src/lib/title-match";
import type { TargetItem } from "../src/lib/types";

const LANTERN_T = "Bhunes Brass Lantern, Bastar Tribal Art, Vintage Look, 11.5 Inch";
const LANTERN_S = "Brass Lantern – Handcrafted Bastar Tribal Art, Vintage Look for Home Décor & Gifting 11.5 Inch";
const NANDI_T = "Copper Nandi Idol, Handcrafted Nandishwara Murti for Pooja, Home Temple, Vastu Decor & Gifting, Brown, 2.5 Inch, 1 Piece";
const NANDI_S = "Copper Nandi Idol – Handcrafted Nandishwara Murti for Pooja, Home Temple, Vastu Décor & Gifting 2.5 Inch";
const FILLER = Array.from({ length: 40 }, (_, i) => `Brass Idol ${i} Handcrafted Pooja Home Decor & Gifting ${i + 2} Inch`);

const cv = (title: string, available: number | null, vendorSku = "BHU5725A"): ConnectedVariant => ({
  inventoryItemId: `gid://${title}`,
  title,
  vendorSku,
  siblingCount: 1,
  tracked: true,
  available,
});
const item = (title: string, quantity: number | null, state: TargetItem["state"]): TargetItem => ({ title, sku: "BHU5725A", handle: title, quantity, state });

function plan(targets: { title: string; quantity: number | null }[], connected: ConnectedVariant[]) {
  const variants = targets.map((t) => ({ sku: "BHU5725A", ...t }));
  const { index, groups } = buildTargetIndex(variants);
  const model = buildTitleModel([...variants.map((v) => v.title), ...connected.map((c) => c.title), ...FILLER]);
  return planUpdates(index, connected, { requireSingleVariant: true, titles: { model, groups } });
}

describe("two target products that share one SKU", () => {
  it("each of your products gets its own target's quantity, not the other's", () => {
    const result = plan(
      [{ title: LANTERN_T, quantity: 3 }, { title: NANDI_T, quantity: 0 }],
      [cv(LANTERN_S, 1), cv(NANDI_S, 5)],
    );
    expect(result.updates.map((u) => [u.inventoryItemId.slice(6, 16), u.quantity])).toEqual([
      ["Brass Lant", 3],
      ["Copper Nan", 0],
    ]);
  });

  it("your Lantern gets the Lantern's quantity even though the Nandi shares its SKU", () => {
    const result = plan([{ title: NANDI_T, quantity: 0 }, { title: LANTERN_T, quantity: 3 }], [cv(LANTERN_S, 1)]);
    expect(result.updates).toEqual([expect.objectContaining({ quantity: 3 })]);
  });

  it("leaves your product alone when the target's only product with that SKU is a different one, and the SKU is shared on your side", () => {
    const result = plan([{ title: NANDI_T, quantity: 0 }], [cv(LANTERN_S, 4), cv("Totally Other Thing 7 Inch", 2)]);
    expect(result.updates).toHaveLength(0);
    expect(result.changes.every((c) => /different title|equally close/i.test(c.note ?? ""))).toBe(true);
  });

  it("trusts a lone SKU match even when the store retitled the product completely", () => {
    const result = plan([{ title: "Brass Pooja Chowki with Prabhavali, Handcrafted Singhasan", quantity: 2 }], [cv("Ornate Brass Arch-Style Pedestal Stand 7 Inch", 9)]);
    expect(result.updates).toEqual([expect.objectContaining({ quantity: 2 })]);
  });

  it("still updates when the titles are just worded differently", () => {
    const result = plan([{ title: LANTERN_T, quantity: 2 }], [cv(LANTERN_S, 9)]);
    expect(result.updates).toEqual([expect.objectContaining({ quantity: 2 })]);
  });
});

describe("annotateItems with titles", () => {
  it("pairs each target product with the store product that has the same name", () => {
    const items = [item(LANTERN_T, 3, "exact"), item(NANDI_T, null, "hidden")];
    annotateItems(items, [cv(LANTERN_S, 1), cv(NANDI_S, 5)]);
    expect(items[0]).toMatchObject({ inYourStore: true, yours: 1, yourTitle: LANTERN_S });
    expect(items[1]).toMatchObject({ inYourStore: true, yours: 5, yourTitle: NANDI_S });
  });

  it("does not link the Nandi to the Lantern when the target lists both under one SKU", () => {
    // The rest of the catalog makes words like "handcrafted" and "decor" common, as in the real stores.
    const rest = FILLER.map((t, n) => ({ ...item(t, 1, "exact"), sku: `OTHER-${n}` }));
    const items = [item(LANTERN_T, 3, "exact"), item(NANDI_T, null, "hidden"), ...rest];
    annotateItems(items, [cv(LANTERN_S, 1)]);
    expect(items[0]).toMatchObject({ inYourStore: true, yours: 1 });
    expect(items[1].inYourStore).toBe(false);
    expect(items[1].titleMismatch).toBe(LANTERN_S);
  });

  it("trusts a lone match but warns when the titles look very different", () => {
    const items = [item("Brass Lakshmi Idol", 3, "exact")];
    annotateItems(items, [cv("Quartz Meditation Bowl Set", 1)]);
    expect(items[0]).toMatchObject({ inYourStore: true, titleWarning: true });
  });
});
