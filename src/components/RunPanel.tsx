"use client";

import { useEffect, useState } from "react";
import type { RunRecord } from "@/lib/types";
import { api, type CheckpointInfo } from "./client-types";
import { usePolling } from "./use-polling";

interface Props {
  runs: RunRecord[];
  running: boolean;
  canRun: boolean;
  updatesEnabled: boolean;
  onToggleUpdates: () => void;
  togglingUpdates: boolean;
  onRun: (dryRun: boolean) => void;
  onStop: () => void;
  checkpoint: CheckpointInfo | null;
  onClearCheckpoint: () => void;
  error: string | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString();

type ChangeTab = "updated" | "failed" | "skipped" | "not-in-target";

function Detail({ run: summary }: { run: RunRecord }) {
  // The list endpoint omits the change rows; fetch the full run once, and keep it fresh while running.
  const [full, setFull] = useState<RunRecord | null>(null);
  const load = () => api<{ run: RunRecord }>(`/api/runs/${summary.id}`).then((r) => setFull(r.run));
  useEffect(() => {
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary.id, summary.status]);
  usePolling(load, 3000, summary.status === "running");
  const run = full ?? summary;
  const loading = full === null && (summary.changeCount ?? 0) > 0;
  const c = run.counters;
  const [tab, setTab] = useState<ChangeTab>("updated");
  const [shown, setShown] = useState(200);
  const tabs: { id: ChangeTab; label: string; total: number }[] = [
    { id: "updated", label: run.dryRun ? "To update" : "Updated", total: c.updated },
    { id: "failed", label: "Failed", total: c.failed },
    { id: "skipped", label: "Skipped", total: c.skipped },
    { id: "not-in-target", label: "Not in target", total: c.notInTarget },
  ];
  const rows = run.changes.filter((ch) => ch.status === tab);
  const shownTotal = tabs.find((t) => t.id === tab)?.total ?? rows.length;
  const stats: [string, number][] = [
    ["Target SKUs", c.targetVariants],
    ["Matched", c.matched],
    [run.dryRun ? "Would update" : "Updated", c.updated],
    ["Unchanged", c.unchanged],
    ["Not in target", c.notInTarget],
    ["Skipped", c.skipped],
    ["Failed", c.failed],
  ];
  // A stopped or still-running run has no final tally; fall back to its live progress.
  const p = run.progress;
  const scrape =
    run.scrape ??
    (p && p.soldOut !== undefined ? { soldOut: p.soldOut, published: p.exact - p.soldOut, hidden: p.hidden } : null);
  const exactAtTarget = scrape ? scrape.soldOut + scrape.published : null;
  const partial = !run.scrape && scrape !== null;
  const toUpdate = c.updated + c.failed;
  const onYourStore = c.unchanged + c.updated + c.failed;
  return (
    <div className="detail">
      <div className="stats">
        <div className="stat highlight">
          <b>{toUpdate}</b>
          <span>{run.dryRun ? "Products to update (would change)" : "Products to update"}</span>
        </div>
      </div>
      {scrape && exactAtTarget !== null && (
        <div className="stats">
          <div className="stat highlight">
            <b>{exactAtTarget}</b>
            <span>Exact at target{partial ? " so far" : ""} ({scrape.soldOut} sold out + {scrape.published} shown counts)</span>
          </div>
          <div className="stat">
            <b>{scrape.hidden}</b>
            <span>Hidden at target (in stock, number not shown)</span>
          </div>
          <div className="stat highlight">
            <b>{onYourStore}</b>
            <span>Your products with an exact quantity ({c.unchanged} equal + {c.updated + c.failed} to change)</span>
          </div>
        </div>
      )}
      <div className="stats">
        {stats.map(([label, n]) => (
          <div className="stat" key={label}><b>{n}</b><span>{label}</span></div>
        ))}
      </div>
      <div className="seg" role="group" aria-label="Product results">
        {tabs.map((t) => (
          <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => { setTab(t.id); setShown(200); }}>
            {t.label} ({t.total})
          </button>
        ))}
      </div>
      {loading && <p className="muted" style={{ margin: 0 }}>Loading products…</p>}
      {!loading && rows.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing in this group.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Your qty → new</th><th>Result</th></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((ch, i) => (
                <tr key={`${ch.sku}-${i}`}>
                  <td>
                    {ch.title}
                    <div className="muted mono">{ch.sku}</div>
                  </td>
                  <td className="mono nowrap">{ch.from ?? "–"} → {ch.to ?? "–"}</td>
                  <td>
                    <span className={`pill ${ch.status}`}>{ch.status}</span>
                    {ch.note && <div className="muted small-note">{ch.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <button type="button" className="btn small" onClick={() => setShown(shown + 200)}>
          Show 200 more ({rows.length - shown} left)
        </button>
      )}
      {rows.length > 0 && rows.length < shownTotal && (
        <p className="muted small-note" style={{ margin: 0 }}>Showing the first {rows.length} of {shownTotal}.</p>
      )}
      <pre className="log">{run.log.join("\n") || "No log yet."}</pre>
    </div>
  );
}

export function RunPanel({ runs, running, canRun, updatesEnabled, onToggleUpdates, togglingUpdates, onRun, onStop, checkpoint, onClearCheckpoint, error }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="panel raised">
      <header className="panel-head">
        <span className="num">4</span>
        <h2>Runs</h2>
      </header>
      <div className="panel-body">
        <button type="button" className="btn small" onClick={onToggleUpdates} disabled={togglingUpdates || running} aria-pressed={!updatesEnabled}>
          {updatesEnabled ? "Don't update quantities now" : "Updates are off — turn back on"}
        </button>
        {!updatesEnabled && (
          <div className="notice" role="status">
            Quantity updates are <strong>off</strong>. Scheduled runs only check and preview, and nothing is written to your store.
            Press <strong>Update products</strong> when you want to write the quantities.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn primary" disabled={!canRun || running} onClick={() => onRun(false)}>
            {running ? "Running…" : updatesEnabled ? "Run now" : "Update products"}
          </button>
          <button type="button" className="btn" disabled={!canRun || running} onClick={() => onRun(true)}>
            {updatesEnabled ? "Dry run" : "Check only"}
          </button>
          <button type="button" className="btn danger" style={{ marginLeft: "auto" }} disabled={!running} onClick={onStop}>
            Stop run
          </button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {updatesEnabled ? "Dry run" : "Check only"} scrapes both stores and shows what would change, without writing anything.
          {!canRun && " Save your settings first."}
        </p>
        {checkpoint && !running && (
          <div className="notice" role="status">
            Saved scrape progress: {checkpoint.checked} product pages already read ({new Date(checkpoint.updatedAt).toLocaleTimeString()}).
            The next run continues from here instead of starting over.{" "}
            <button type="button" className="btn small ghost" onClick={onClearCheckpoint}>Start over</button>
          </div>
        )}
        {error && <div className="notice bad" role="alert">{error}</div>}
      </div>
      <ul className="runs">
        {runs.length === 0 && <li style={{ padding: "12px 20px" }} className="muted">No runs yet.</li>}
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" className="run-btn" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span>
                <span className="mono">{fmt(r.startedAt)}</span>{" "}
                <span className="muted">· {r.trigger}{r.dryRun ? " · dry" : ""}{r.attempt ? ` · retry ${r.attempt}` : ""}</span>
              </span>
              <span className={`status ${r.status} ${r.status === "running" ? "pulse" : ""}`}>{r.status}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {r.status === "running" ? `${r.phase} (${r.counters.targetVariants}/${r.counters.connectedVariants})` : r.phase}
              </span>
            </button>
            {open === r.id && <Detail run={r} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
