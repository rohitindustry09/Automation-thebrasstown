"use client";

import { useState } from "react";

interface Props {
  selected: string[];
  onChange: (dates: string[]) => void;
  /** Today in the schedule timezone, YYYY-MM-DD; earlier days are disabled. */
  today: string;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function CalendarPicker({ selected, onChange, today }: Props) {
  const [ty, tm] = today.split("-").map(Number);
  const [view, setView] = useState({ y: ty, m: tm - 1 });
  const chosen = new Set(selected);

  const first = new Date(Date.UTC(view.y, view.m, 1)).getUTCDay();
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const monthDates = Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1)).filter((d) => d >= today);
  const allChosen = monthDates.length > 0 && monthDates.every((d) => chosen.has(d));

  const shift = (delta: number) =>
    setView(({ y, m }) => {
      const t = new Date(Date.UTC(y, m + delta, 1));
      return { y: t.getUTCFullYear(), m: t.getUTCMonth() };
    });

  const toggle = (date: string) =>
    onChange(chosen.has(date) ? selected.filter((d) => d !== date) : [...selected, date].sort());

  const toggleMonth = () => {
    const rest = selected.filter((d) => !monthDates.includes(d));
    onChange(allChosen ? rest : [...rest, ...monthDates].sort());
  };

  const label = new Date(Date.UTC(view.y, view.m, 1)).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="cal">
        <div className="cal-head">
          <button type="button" className="btn small ghost" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <strong>{label}</strong>
          <button type="button" className="btn small ghost" onClick={() => shift(1)} aria-label="Next month">›</button>
        </div>
        <div className="cal-grid">
          {DOW.map((d, i) => <div key={i} className="cal-dow">{d}</div>)}
          {Array.from({ length: first }, (_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const date = iso(view.y, view.m, i + 1);
            return (
              <button
                key={date}
                type="button"
                className={`cal-day${date === today ? " today" : ""}`}
                aria-pressed={chosen.has(date)}
                aria-label={date}
                disabled={date < today}
                onClick={() => toggle(date)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn small" onClick={toggleMonth}>
          {allChosen ? "Clear this month" : "Select rest of this month"}
        </button>
        <button type="button" className="btn small ghost" onClick={() => onChange([])} disabled={selected.length === 0}>
          Clear all ({selected.length})
        </button>
      </div>
    </div>
  );
}
