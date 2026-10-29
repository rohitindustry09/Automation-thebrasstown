import type { ScheduleSettings } from "./types";

/** A run that is this many minutes late (e.g. server was busy) still fires. */
export const GRACE_MINUTES = 5;

export function localNow(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

const runsOn = (s: ScheduleSettings, date: string) =>
  s.mode === "daily" || s.dates.includes(date);

/** Slot keys ("YYYY-MM-DD HH:mm") that should fire right now and haven't yet. */
export function dueSlots(s: ScheduleSettings, now: Date, fired: ReadonlySet<string>): string[] {
  if (!s.enabled) return [];
  const { date, time } = localNow(now, s.timezone);
  const nowMin = toMinutes(time);
  // Yesterday is checked too, so a 23:58 slot still fires if the tick lands at 00:01.
  const days = [
    { day: addDays(date, -1), offset: 1440 },
    { day: date, offset: 0 },
  ];
  return days.flatMap(({ day, offset }) =>
    runsOn(s, day)
      ? [...s.times]
          .sort()
          .filter((t) => {
            const age = nowMin + offset - toMinutes(t);
            return age >= 0 && age <= GRACE_MINUTES;
          })
          .map((t) => `${day} ${t}`)
      : [],
  ).filter((slot) => !fired.has(slot));
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Upcoming slot keys (local to the schedule timezone), soonest first. */
export function nextRuns(s: ScheduleSettings, now: Date, count: number): string[] {
  if (!s.enabled || s.times.length === 0) return [];
  const { date, time } = localNow(now, s.timezone);
  const current = `${date} ${time}`;
  const times = [...s.times].sort();
  const out: string[] = [];
  for (let offset = 0; offset <= 800 && out.length < count; offset++) {
    const day = addDays(date, offset);
    if (!runsOn(s, day)) continue;
    for (const t of times) {
      const slot = `${day} ${t}`;
      if (slot > current) out.push(slot);
      if (out.length >= count) break;
    }
  }
  return out;
}
