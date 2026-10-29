import { beforeEach, describe, expect, it, vi } from "vitest";
import { CancelledError, clearCancel, requestCancel } from "../src/lib/cancel";

const catalog = {
  products: ["a", "b", "c", "d"].map((h) => ({
    handle: h,
    title: `Product ${h}`,
    variants: [{ sku: `SKU-${h}`, available: true }],
  })),
};

const fetched: string[] = [];
vi.mock("../src/lib/public-fetch", () => ({
  ScrapeError: class extends Error {},
  normalizePublicDomain: (d: string) => d,
  publicGet: vi.fn(async (url: string) => {
    if (url.includes("/products.json")) return { status: 200, text: JSON.stringify(catalog) };
    const handle = url.split("/products/")[1];
    fetched.push(handle);
    if (fetched.length === 2) requestCancel(); // user stops after two pages
    return { status: 200, text: `<main>Only ${handle.charCodeAt(0) - 96} left</main>` };
  }),
}));

import { scrapeTargetInventory } from "../src/lib/inventory-source";

describe("resumable scrape", () => {
  beforeEach(() => {
    fetched.length = 0;
    clearCancel();
  });

  it("saves page results on stop and skips them on the next attempt", async () => {
    let saved: Record<string, number | null> = {};
    const save = async (r: Record<string, number | null>) => {
      saved = { ...r };
    };

    await expect(scrapeTargetInventory("shop.test", () => undefined, () => undefined, { results: {}, save })).rejects.toBeInstanceOf(
      CancelledError,
    );
    const firstRun = Object.keys(saved);
    expect(firstRun.length).toBeGreaterThanOrEqual(2);

    fetched.length = 0;
    clearCancel();
    const scrape = await scrapeTargetInventory("shop.test", () => undefined, () => undefined, { results: saved, save });

    expect(fetched.some((h) => firstRun.includes(h))).toBe(false); // nothing re-read
    expect(scrape.variants).toHaveLength(4);
    expect(scrape.exposed).toBe(4);
    expect(scrape.variants.find((v) => v.sku === "SKU-c")?.quantity).toBe(3);
  });
});
