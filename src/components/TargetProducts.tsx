"use client";

import { useMemo, useRef, useState } from "react";
import { computePrices, samePrice, type PricingSettings } from "@/lib/pricing";
import type { FallbackSettings, TargetItem, TargetState } from "@/lib/types";
import { api } from "./client-types";
import { usePolling } from "./use-polling";

import { decideQuantity } from "@/lib/decide";

type Tab = "all" | "to-update" | "backorder" | TargetState;

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "to-update", label: "To update" },
  { id: "backorder", label: "Backorder" },
  { id: "sold-out", label: "Sold out" },
  { id: "exact", label: "Exact count" },
  { id: "hidden", label: "Hidden" },
  { id: "pending", label: "Not checked yet" },
  { id: "unreadable", label: "Could not read" },
];

const STATE_LABEL: Record<TargetState, string> = {
  "sold-out": "sold out · 0",
  exact: "exact",
  hidden: "number hidden",
  pending: "waiting",
  unreadable: "page could not be read",
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
  if (item.state === "pending" || item.state === "unreadable") return { kind: "none" };
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

/** The price this run would set on your store for this product, or null when prices are off / not applicable. */
function newPriceFor(item: TargetItem, pricing: PricingSettings) {
  if (!pricing.enabled || !item.inYourStore || item.blocked?.startsWith("product has")) return null;
  return computePrices({ price: item.price, compareAt: item.compareAt }, pricing, item.sku);
}

function NewPrice({ item, pricing }: { item: TargetItem; pricing: PricingSettings }) {
  if (!pricing.enabled) return <span className="muted">prices off</span>;
  const next = newPriceFor(item, pricing);
  if (!next) return <span className="muted">–</span>;
  const compare = next.compareAt === undefined ? (item.yourCompareAt ?? null) : next.compareAt;
  if (samePrice(item.yourPrice, next.price) && samePrice(item.yourCompareAt, compare)) return <span className="muted">same</span>;
  return (
    <span>
      <strong>→ {next.price}</strong>
      {compare ? <span className="muted small-note"> (was {compare})</span> : null}
    </span>
  );
}

interface Props {
  running: boolean;
  fallback: FallbackSettings;
  pricing: PricingSettings;
  /** Writes the listed quantities to your store now (works during a scrape too) */
  onUpdateNow: () => void;
  /** Forgets the last completed scrape */
  onClear: () => void;
  busy: boolean;
}

export function TargetProducts({ running, fallback, pricing, onUpdateNow, onClear, busy }: Props) {
  const [items, setItems] = useState<TargetItem[]>([]);
  const [live, setLive] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const version = useRef<number | undefined>(undefined);
  usePolling(
    async () => {
      const since = version.current === undefined ? "" : `?since=${version.current}`;
      const r = await api<{ version: number; live: boolean; items?: TargetItem[] }>(`/api/target${since}`);
      version.current = r.version;
      setLive(r.live);
      if (r.items) setItems(r.items); // only sent when the list actually changed
    },
    running ? 2500 : 15000,
  );

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: items.length, "to-update": 0, backorder: 0, "sold-out": 0, exact: 0, hidden: 0, pending: 0, unreadable: 0 };
    for (const i of items) {
      c[i.state]++;
      if (i.backorder) c.backorder++;
    }
    return c;
  }, [items]);

  const outcomes = useMemo(() => new Map(items.map((i) => [i, outcomeFor(i, fallback)])), [items, fallback]);
  const updatable = useMemo(() => [...outcomes.values()].filter((o) => o.kind === "update").length, [outcomes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const inTab =
        tab === "all" ? true : tab === "to-update" ? outcomes.get(i)?.kind === "update" : tab === "backorder" ? i.backorder === true : i.state === tab;
      return inTab && (!q || i.title.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.yourTitle ?? "").toLowerCase().includes(q) || (i.yourSku ?? "").toLowerCase().includes(q));
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
        {items.length > 0 && !live && !running && (
          <button type="button" className="btn small ghost" disabled={busy} onClick={onClear} title="Forget the last completed scrape">
            Clear last scrape
          </button>
        )}
        {updatable > 0 && (
          <button
            type="button"
            className="btn small primary"
            disabled={busy}
            onClick={onUpdateNow}
            title={running ? "Writes the products read so far; the scrape keeps going" : "Writes these quantities to your store now, without scraping again"}
          >
            Update now ({updatable})
          </button>
        )}
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
              placeholder="Search either store's name or the SKU"
              aria-label="Search target products"
            />
            <div className="table-wrap" style={{ maxHeight: 420 }}>
              <table>
                <thead><tr><th>Product (target store, then your store)</th><th>Target SKU</th><th>Your SKU</th><th>Target qty</th><th>Your qty</th><th>To update</th><th>Target price</th><th>Your price now</th><th>New price</th></tr></thead>
                <tbody>
                  {rows.slice(0, limit).map((i) => (
                    <tr key={`${i.handle}-${i.sku}`}>
                      <td>
                        {i.title}
                        {i.inYourStore && i.yourTitle && <div className="muted small-note">Your store: {i.yourTitle}</div>}
                        {i.titleWarning && <div className="small-note" style={{ color: "var(--warn, #d9a441)" }}>⚠ The titles look very different. Check that this SKU really is the same product.</div>}
                        {i.inYourStore === false && (
                          <div className="muted small-note">
                            {i.titleMismatch ? `Not on your store (this SKU belongs to "${i.titleMismatch}" there, a different product)` : "Not on your store"}
                          </div>
                        )}
                      </td>
                      <td className="mono">{i.sku}</td>
                      <td className="mono">{i.inYourStore ? (i.yourSku ?? "no SKU") : "–"}</td>
                      <td className="mono">
                        {i.quantity ?? "–"}
                        {i.backorder ? <div className="muted small-note">backorder</div> : null}
                      </td>
                      <td className="mono nowrap">{i.inYourStore ? (i.yours ?? "not stocked") : "–"}</td>
                      <td className="mono">
                        <Outcome o={outcomes.get(i) ?? { kind: "none" }} state={STATE_LABEL[i.state]} />
                      </td>
                      <td className="mono nowrap">
                        {i.price ?? "–"}
                        {i.compareAt ? <span className="muted small-note"> (was {i.compareAt})</span> : null}
                      </td>
                      <td className="mono nowrap">
                        {i.inYourStore ? (i.yourPrice ?? "–") : "–"}
                        {i.inYourStore && i.yourCompareAt ? <span className="muted small-note"> (was {i.yourCompareAt})</span> : null}
                      </td>
                      <td className="mono nowrap">
                        <NewPrice item={i} pricing={pricing} />
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
