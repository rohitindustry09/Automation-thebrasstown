import { describe, expect, it } from "vitest";
import { buildTitleModel, MIN_TITLE_SCORE, rankByTitle, titleScore } from "../src/lib/title-match";

const LANTERN_T = "Bhunes Brass Lantern, Bastar Tribal Art, Vintage Look, 11.5 Inch";
const LANTERN_S = "Brass Lantern – Handcrafted Bastar Tribal Art, Vintage Look for Home Décor & Gifting 11.5 Inch";
const NANDI_T = "Copper Nandi Idol, Handcrafted Nandishwara Murti for Pooja, Home Temple, Vastu Decor & Gifting, Brown, 2.5 Inch, 1 Piece";
const NANDI_S = "Copper Nandi Idol – Handcrafted Nandishwara Murti for Pooja, Home Temple, Vastu Décor & Gifting 2.5 Inch";
const DHOKRA_T = "Brass Dhokra Lady and Child Figurine, Bastar Tribal Art, 8 Inch";
const DHOKRA_S = "Brass Dhokra Lady and Child Figurine – Handcrafted Bastar Tribal Art for Home Décor & Gifting 8 Inch";
const DATTA_T = "Copper Dattatreya Idol, Dattaguru Murti, Handcrafted Traditional Dattatreya for Pooja, Home Decor & Gifting, Brown, 5 Inch, 1 Piece";
const MURA_S = "Brass Dhokra Lady with Mura Sculpture – Handcrafted Bastar Tribal Art for Home Décor & Gifting 3 Inch";

// A catalog where marketing words are everywhere, like the real stores.
const FILLER_TITLES = Array.from({ length: 60 }, (_, i) => `Brass Idol ${i} Handcrafted Pooja Home Decor & Gifting ${i + 2} Inch`);
const model = buildTitleModel([LANTERN_T, LANTERN_S, NANDI_T, NANDI_S, DHOKRA_T, DHOKRA_S, DATTA_T, MURA_S, ...FILLER_TITLES]);

describe("titleScore", () => {
  it("accepts the same product written differently on the two stores", () => {
    expect(titleScore(model, LANTERN_T, LANTERN_S)).toBeGreaterThan(0.7);
    expect(titleScore(model, NANDI_T, NANDI_S)).toBeGreaterThan(0.7);
    expect(titleScore(model, DHOKRA_T, DHOKRA_S)).toBeGreaterThan(0.7);
  });

  it("rejects two different products that share a SKU", () => {
    expect(titleScore(model, NANDI_T, LANTERN_S)).toBeLessThan(MIN_TITLE_SCORE);
    expect(titleScore(model, DATTA_T, MURA_S)).toBeLessThan(MIN_TITLE_SCORE);
  });

  it("treats the same name in another size as a different product", () => {
    expect(titleScore(model, "Brass Lantern, 11.5 Inch", "Brass Lantern Handcrafted Decor 5 Inch")).toBeLessThan(
      titleScore(model, "Brass Lantern, 11.5 Inch", "Brass Lantern Handcrafted Decor 11.5 Inch"),
    );
  });

  it("cannot disprove a match when a title has no usable words", () => {
    expect(titleScore(model, "", LANTERN_S)).toBe(1);
  });
});

describe("rankByTitle", () => {
  it("puts the right product first when two products share a SKU", () => {
    const ranked = rankByTitle(model, LANTERN_S, [
      { title: NANDI_T, value: "nandi" },
      { title: LANTERN_T, value: "lantern" },
    ]);
    expect(ranked[0].value).toBe("lantern");
    expect(ranked[1].score).toBeLessThan(MIN_TITLE_SCORE);
  });
});
