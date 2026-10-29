"use client";

import { useEffect, useMemo, useState } from "react";
import type { FallbackSettings, TargetItem, TargetState } from "@/lib/types";
import { api } from "./client-types";

import { decideQuantity } from "@/lib/decide";

type Tab = "all" | "to-update" | TargetState;

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "to-update", label: "To update" },
  { id: "sold-out", label: "Sold out" },
  { id: "exact", label: "Exact count" },
  { id: "hidden", label: "Hidden" },
  { id: "pending", label: "Not checked yet" },
];

const STATE_LABEL: Record<TargetState, string> = {
  "sold-out": "sold out · 0",
  exact: "exact",
  hidden: "number hidden",
  pending: "waiting",
};

const PAGE = 100;

type Outcome =
  | { kind: "loading" }
  | { kind: "not-in-your-store" }
  | { kind: "blocked"; why: string }
  | { kind: "same"; value: number; note?: string }
  | { kind: "update"; from: number | null; value: number; note?: string }
  | { kind: "none" };

/** What this run will do on your store for this target product. */
function outcomeFor(item: TargetItem, fallback: FallbackSettings): Outcome {
  if (item.inYourStore === undefined) return { kind: "loading" };
  if (!item.inYourStore) return { kind: "not-in-your-store" };
  if (item.blocked) return { kind: "blocked", why: item.blocked };
  if (item.state === "pending") return { kind: "none" };
  const target = item.state === "sold-out" ? 0 : item.state === "exact" ? item.quantity : null;
  const yours = item.yours ?? null;
  const d = decideQuantity(target, yours, fallback.enabled ? fallback : null);
  if (d.kind === "keep") return d.reason === "kept-current" ? { kind: "same", value: yours ?? 0, note: "kept" } : { kind: "none" };
  if (d.value === yours) return { kind: "same", value: d.value };
  return { kind: "update", from: yours, value: d.value, note: d.viaFallback ? "default" : undefined };
}

function Outcome({ o, state }: { o: Outcome; state: string }) {
  switch (o.kind) {
    case "loading":
      return <span className="muted">reading your store…</span>;
    case "not-in-your-store":
      return <span className="muted">not in your store</span>;
    case "blocked":
      return <span className="muted small-note">skipped · {o.why}</span>;
    case "same":
      return <span className="muted">same ({o.value}){o.note ? ` · ${o.note}` : ""}</span>;
    case "update":
      return (
        <span>
          <strong>→ {o.value}</strong>
          {o.note && <span className="muted small-note"> {o.note}</span>}
        </span>
      );
    default:
      return <span className="muted">{state}</span>;
  }
}

export function TargetProducts({ running, fallback }: { running: boolean; fallback: FallbackSettings }) {
  const [items, setItems] = useState<TargetItem[]>([]);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ items: TargetItem[]; live: boolean }>("/api/target")
        .then((r) => alive && (setItems(r.items), setLive(r.live)))
        .catch(() => undefined);
    void load();
    const id = running ? setInterval(load, 3000) : undefined;
    return () => {
      alive = false;
      if (id) clearInterval(id);
    };
  }, [running]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: items.length, "to-update": 0, "sold-out": 0, exact: 0, hidden: 0, pending: 0 };
    for (const i of items) c[i.state]++;
    return c;
  }, [items]);

  const outcomes = useMemo(() => new Map(items.map((i) => [i, outcomeFor(i, fallback)])), [items, fallback]);
  const updatable = useMemo(() => [...outcomes.values()].filter((o) => o.kind === "update").length, [outcomes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const inTab = tab === "all" ? true : tab === "to-update" ? outcomes.get(i)?.kind === "update" : i.state === tab;
      return inTab && (!q || i.title.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    });
  }, [items, tab, query, outcomes]);

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="num">5</span>
        <h2>Target products</h2>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>
          {live ? "live while scraping" : items.length ? "last completed scrape" : ""}
        </span>
      </header>
      <div className="panel-body">
        {items.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Run a scrape (Dry run is fine) and every target product will be listed here.</p>
        ) : (
          <>
            <div className="seg" role="group" aria-label="Filter products" style={{ flexWrap: "wrap" }}>
              {TABS.map((t) => (
                <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setLimit(PAGE); }}>
                  {t.label} ({t.id === "to-update" ? updatable : counts[t.id]})
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }}
              placeholder="Search name or SKU"
              aria-label="Search target products"
            />
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>Product</th><th>SKU</th><th>Target qty</th><th>Your qty</th><th>To update</th></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((i) => (
                    <tr key={`${i.handle}-${i.sku}`}>
                      <td>{i.title}</td>
                      <td className="mono">{i.sku}</td>
                      <td className="mono">{i.quantity ?? "–"}</td>
                      <td className="mono nowrap">{i.inYourStore ? (i.yours ?? "–") : "–"}</td>
                      <td className="mono">
                        <Outcome o={outcomes.get(i) ?? { kind: "none" }} state={STATE_LABEL[i.state]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span className="muted mono">showing {Math.min(limit, rows.length)} of {rows.length} · {updatable} need an update on your store</span>
              {rows.length > limit && (
                <button type="button" className="btn small" onClick={() => setLimit(limit + PAGE)}>Show 100 more</button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
