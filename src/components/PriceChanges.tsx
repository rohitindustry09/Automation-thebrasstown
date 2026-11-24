"use client";

import { useState } from "react";
import type { PriceChange, RunRecord } from "@/lib/types";

const PAGE = 200;
const show = (n: number | null) => (n === null ? "–" : String(n));

/** Price results of one run: a tally and the products whose prices changed (or were skipped, and why). */
export function PriceChanges({ run, loading }: { run: RunRecord; loading: boolean }) {
  const [shown, setShown] = useState(PAGE);
  const [tab, setTab] = useState<"updated" | "failed" | "skipped">("updated");
  const counts = run.prices;
  if (!counts) return null;

  const failedRows = (run.priceChanges ?? []).filter((c) => c.status === "failed");
  const rows: PriceChange[] = (run.priceChanges ?? []).filter((c) => c.status === tab);
  const tabs = [
    { id: "updated" as const, label: run.dryRun ? "Prices to update" : "Prices updated", total: counts.updated },
    { id: "failed" as const, label: "Failed", total: counts.failed },
    { id: "skipped" as const, label: "Skipped", total: counts.skipped },
  ];

  return (
    <>
      <div className="stats">
        <div className="stat highlight"><b>{counts.updated + counts.failed}</b><span>{run.dryRun ? "Prices that would change" : "Prices to change"}</span></div>
        <div className="stat"><b>{counts.unchanged}</b><span>Prices already right</span></div>
        <div className="stat"><b>{counts.skipped}</b><span>Prices skipped</span></div>
        <div className="stat"><b>{counts.failed || failedRows.length}</b><span>Prices failed</span></div>
      </div>
      <div className="seg" role="group" aria-label="Price results">
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setShown(PAGE); }}>
            {t.label} ({t.total})
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{loading ? "Loading prices…" : "Nothing in this group."}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Price</th><th>Compare-at</th><th>Result</th></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((c, i) => (
                <tr key={`${c.sku}-${i}`}>
                  <td>
                    {c.title}
                    <div className="muted mono">{c.sku}</div>
                  </td>
                  <td className="mono nowrap">{show(c.fromPrice)} → {show(c.toPrice)}</td>
                  <td className="mono nowrap">{show(c.fromCompare)} → {show(c.toCompare)}</td>
                  <td>
                    <span className={`pill ${c.status}`}>{run.dryRun && c.status === "updated" ? "would update" : c.status}</span>
                    {c.note && <div className="muted small-note">{c.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <button type="button" className="btn small" onClick={() => setShown(shown + PAGE)}>Show {PAGE} more ({rows.length - shown} left)</button>
      )}
    </>
  );
}
