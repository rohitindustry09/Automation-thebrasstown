import { describe, expect, it } from "vitest";
import { summarizeRun } from "../src/lib/sync";
import { emptyCounters, type PriceChange, type RunRecord } from "../src/lib/types";

const priceRow = (i: number): PriceChange => ({ sku: `S${i}`, title: "T", fromPrice: 1, toPrice: 2, fromCompare: null, toCompare: 3, status: "updated" });

const run = (): RunRecord => ({
  id: "r1",
  trigger: "manual",
  dryRun: true,
  status: "success",
  phase: "Done",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:01:00.000Z",
  counters: emptyCounters(),
  changes: [{ sku: "A", title: "T", from: 1, to: 0, status: "updated" }],
  priceChanges: Array.from({ length: 500 }, (_, i) => priceRow(i)),
  prices: { updated: 500, unchanged: 0, skipped: 0, failed: 0 },
  log: [],
});

describe("summarizeRun (the list the page polls every few seconds)", () => {
  it("leaves out both the quantity rows and the price rows, but keeps the counts", () => {
    const s = summarizeRun(run());
    expect(s.changes).toEqual([]);
    expect(s.priceChanges).toEqual([]);
    expect(s.changeCount).toBe(1);
    expect(s.prices).toEqual({ updated: 500, unchanged: 0, skipped: 0, failed: 0 });
  });

  it("does not modify the run it summarizes", () => {
    const r = run();
    summarizeRun(r);
    expect(r.priceChanges).toHaveLength(500);
  });
});
