"use client";

import type { ScheduleSettings } from "@/lib/types";
import { localNow } from "@/lib/schedule";
import { CalendarPicker } from "./CalendarPicker";

interface Props {
  value: ScheduleSettings;
  nextRuns: string[];
  onChange: (next: ScheduleSettings) => void;
}

const PRESETS = [
  { label: "Morning", time: "09:00" },
  { label: "Noon", time: "12:30" },
  { label: "Evening", time: "18:00" },
  { label: "Night", time: "23:00" },
];

const ZONES = ["Asia/Kolkata", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

export function SchedulePanel({ value, nextRuns, onChange }: Props) {
  const set = (patch: Partial<ScheduleSettings>) => onChange({ ...value, ...patch });
  const today = localNow(new Date(), value.timezone).date;
  const zones = ZONES.includes(value.timezone) ? ZONES : [value.timezone, ...ZONES];

  const setTime = (i: number, time: string) => set({ times: value.times.map((t, idx) => (idx === i ? time : t)) });
  const addTime = (time = "12:00") => !value.times.includes(time) && set({ times: [...value.times, time] });

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="num">3</span>
        <h2>Schedule</h2>
        <label className="switch" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {value.enabled ? "Armed" : "Paused"}
        </label>
      </header>
      <div className="panel-body">
        <div className="field">
          <span>Which days</span>
          <div className="seg" role="group" aria-label="Day selection">
            <button type="button" aria-pressed={value.mode === "daily"} onClick={() => set({ mode: "daily" })}>Every day</button>
            <button type="button" aria-pressed={value.mode === "dates"} onClick={() => set({ mode: "dates" })}>Pick dates</button>
          </div>
        </div>

        {value.mode === "dates" && (
          <div className="field">
            <span>Dates — browse months ahead</span>
            <CalendarPicker selected={value.dates} onChange={(dates) => set({ dates })} today={today} />
          </div>
        )}

        <div className="field">
          <span>Run times ({value.times.length} per day)</span>
          {value.times.map((t, i) => (
            <div key={i} className="time-row">
              <input type="time" value={t} onChange={(e) => e.target.value && setTime(i, e.target.value)} aria-label={`Run time ${i + 1}`} />
              <button type="button" className="btn small ghost" onClick={() => set({ times: value.times.filter((_, idx) => idx !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <div className="chips">
            {PRESETS.map((p) => (
              <button key={p.time} type="button" className="btn small ghost" onClick={() => addTime(p.time)}>
                + {p.label} {p.time}
              </button>
            ))}
            <button type="button" className="btn small" onClick={() => addTime()}>+ Custom time</button>
          </div>
        </div>

        <label className="field" style={{ maxWidth: 280 }}>
          <span>Time zone</span>
          <select value={value.timezone} onChange={(e) => set({ timezone: e.target.value })}>
            {zones.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>

        <div className="field">
          <span>Next runs ({value.timezone})</span>
          {nextRuns.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              {value.enabled ? "Nothing upcoming — pick dates and times, then save." : "Schedule is paused."}
            </p>
          ) : (
            <ul className="next-list">
              {nextRuns.map((r) => (
                <li key={r}><span>{r.slice(0, 10)}</span><span>{r.slice(11)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
