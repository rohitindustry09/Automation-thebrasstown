import { describe, expect, it } from "vitest";
import { dueSlots, localNow, nextRuns } from "../src/lib/schedule";
import type { ScheduleSettings } from "../src/lib/types";

const base: ScheduleSettings = {
  enabled: true,
  timezone: "Asia/Kolkata",
  mode: "daily",
  dates: [],
  times: ["09:00", "18:30"],
};

describe("localNow", () => {
  it("renders the instant in the schedule timezone", () => {
    // 2026-03-01T04:00Z is 09:30 in Kolkata (UTC+5:30)
    expect(localNow(new Date("2026-03-01T04:00:00Z"), "Asia/Kolkata")).toEqual({
      date: "2026-03-01",
      time: "09:30",
    });
  });
});

describe("dueSlots", () => {
  const now = new Date("2026-03-01T03:33:00Z"); // 09:03 Kolkata

  it("fires a daily time that passed within the grace window", () => {
    expect(dueSlots(base, now, new Set())).toEqual(["2026-03-01 09:00"]);
  });

  it("does not fire a slot already fired", () => {
    expect(dueSlots(base, now, new Set(["2026-03-01 09:00"]))).toEqual([]);
  });

  it("ignores slots older than the grace window", () => {
    const late = new Date("2026-03-01T04:40:00Z"); // 10:10
    expect(dueSlots(base, late, new Set())).toEqual([]);
  });

  it("does not fire a future time", () => {
    const early = new Date("2026-03-01T03:00:00Z"); // 08:30
    expect(dueSlots(base, early, new Set())).toEqual([]);
  });

  it("respects date mode", () => {
    const s = { ...base, mode: "dates" as const, dates: ["2026-03-02"] };
    expect(dueSlots(s, now, new Set())).toEqual([]);
    expect(dueSlots({ ...s, dates: ["2026-03-01"] }, now, new Set())).toEqual(["2026-03-01 09:00"]);
  });

  it("still fires a late-night slot when the tick lands after midnight", () => {
    const s = { ...base, times: ["23:58"] };
    const after = new Date("2026-03-01T18:31:00Z"); // 00:01 on 03-02 Kolkata
    expect(dueSlots(s, after, new Set())).toEqual(["2026-03-01 23:58"]);
  });

  it("never fires when disabled", () => {
    expect(dueSlots({ ...base, enabled: false }, now, new Set())).toEqual([]);
  });
});

describe("nextRuns", () => {
  it("lists upcoming slots in order, across days", () => {
    const now = new Date("2026-03-01T04:00:00Z"); // 09:30 Kolkata
    expect(nextRuns(base, now, 3)).toEqual([
      "2026-03-01 18:30",
      "2026-03-02 09:00",
      "2026-03-02 18:30",
    ]);
  });

  it("only lists selected dates, even months ahead", () => {
    const s = { ...base, mode: "dates" as const, dates: ["2026-05-10", "2026-03-05"], times: ["12:25"] };
    const now = new Date("2026-03-01T04:00:00Z");
    expect(nextRuns(s, now, 5)).toEqual(["2026-03-05 12:25", "2026-05-10 12:25"]);
  });

  it("returns nothing when disabled", () => {
    expect(nextRuns({ ...base, enabled: false }, new Date(), 3)).toEqual([]);
  });
});
