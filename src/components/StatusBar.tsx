"use client";

import type { RunRecord } from "@/lib/types";

interface Props {
  scheduleEnabled: boolean;
  updatesEnabled: boolean;
  nextRun: string | null;
  activeRun: RunRecord | null;
  busy: boolean;
  onToggleSchedule: () => void;
  onStopRun: () => void;
}

/** Always-visible control strip: what is running or armed, with one-click Pause / Stop. */
export function StatusBar({ scheduleEnabled, updatesEnabled, nextRun, activeRun, busy, onToggleSchedule, onStopRun }: Props) {
  return (
    <section className="statusbar" aria-label="Automation status">
      <div className="statusbar-item">
        <span className={`dot ${scheduleEnabled ? "on" : ""}`} aria-hidden="true" />
        <div>
          <strong>{scheduleEnabled ? "Schedule armed" : "Schedule paused"}</strong>
          <div className="muted mono">
            {scheduleEnabled ? (nextRun ? `next run ${nextRun}` : "no upcoming run") : "nothing will run automatically"}
            {scheduleEnabled && !updatesEnabled && " · check only, no updates"}
          </div>
        </div>
        <button type="button" className="btn small" onClick={onToggleSchedule} disabled={busy}>
          {scheduleEnabled ? "Pause schedule" : "Resume schedule"}
        </button>
      </div>

      <div className="statusbar-item">
        <span className={`dot ${activeRun ? "live pulse" : ""}`} aria-hidden="true" />
        <div>
          <strong>{activeRun ? `Running now (${activeRun.trigger}${activeRun.dryRun ? ", dry" : ""})` : "No run in progress"}</strong>
          {activeRun && <div className="muted mono">{activeRun.phase}</div>}
          {activeRun?.progress && (
            <>
              {activeRun.progress.current && (
                <div className="now-scraping" title={activeRun.progress.current}>
                  Scraping: {activeRun.progress.current}
                </div>
              )}
              {activeRun.progress.catalogTotal !== undefined && activeRun.progress.soldOut !== undefined && (
                <div className="muted mono">
                  {activeRun.progress.catalogTotal} products = {activeRun.progress.soldOut} sold out + {activeRun.progress.total} to check
                </div>
              )}
              <div className="mono">
                <strong>{activeRun.progress.exact}</strong> exact quantities
                {activeRun.progress.soldOut !== undefined &&
                  ` (${activeRun.progress.soldOut} sold out · ${activeRun.progress.exact - activeRun.progress.soldOut} published counts)`}{" "}
                · {activeRun.progress.hidden} hidden
              </div>
            </>
          )}
        </div>
        {activeRun && (
          <button type="button" className="btn small danger" onClick={onStopRun} disabled={busy}>
            Stop run
          </button>
        )}
      </div>
    </section>
  );
}
