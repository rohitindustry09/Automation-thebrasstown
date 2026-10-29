"use client";

import { useCallback, useEffect, useState } from "react";
import type { RunRecord } from "@/lib/types";
import { type ApplicableCheck, api, toDraft, type CheckpointInfo, type Draft, type MetafieldOption, type PublicSettings, type ShopInfoResponse } from "./client-types";
import { ConnectedSummary } from "./ConnectedSummary";
import { usePolling } from "./use-polling";
import { RunPanel } from "./RunPanel";
import { FallbackCard } from "./FallbackCard";
import { SchedulePanel } from "./SchedulePanel";
import { StatusBar } from "./StatusBar";
import { TargetProducts } from "./TargetProducts";
import { StoreCard } from "./StoreCard";

interface SettingsResponse {
  settings: PublicSettings;
  nextRuns: string[];
}

export function Dashboard() {
  const [saved, setSaved] = useState<PublicSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [metafields, setMetafields] = useState<MetafieldOption[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [togglingUpdates, setTogglingUpdates] = useState(false);
  const [checkpoint, setCheckpoint] = useState<CheckpointInfo | null>(null);
  const [check, setCheck] = useState<ApplicableCheck | null>(null);

  const apply = useCallback((res: SettingsResponse) => {
    setSaved(res.settings);
    setDraft(toDraft(res.settings));
    setNextRuns(res.nextRuns);
  }, []);

  /** Takes the connected store's product metafield definitions (for the Vendor SKU dropdown). */
  const applyInfo = useCallback((info: ShopInfoResponse) => {
    setMetafields(info.metafields);
  }, []);

  useEffect(() => {
    api<SettingsResponse>("/api/settings")
      .then((res) => {
        apply(res);
        const store = res.settings.connected;
        if (!store?.hasToken) return;
        // The saved token is reused server-side, so this also works after a reload.
        return api<ShopInfoResponse>("/api/stores/test", { method: "POST", body: JSON.stringify({ domain: store.domain }) }).then(applyInfo);
      })
      .catch((e: Error) => setError(e.message));
  }, [apply, applyInfo]);

  usePolling(
    async () => {
      const r = await api<{ runs: RunRecord[]; running: boolean; checkpoint: CheckpointInfo | null; applicableCheck: ApplicableCheck | null }>("/api/runs");
      setRuns(r.runs);
      setRunning(r.running);
      setCheckpoint(r.checkpoint);
      setCheck(r.applicableCheck);
    },
    running ? 2000 : 6000,
  );

  if (!draft || !saved) {
    return <main className="shell"><p className="muted">{error ?? "Loading…"}</p></main>;
  }

  const dirty =
    JSON.stringify(draft) !== JSON.stringify(toDraft(saved));

  const update = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const store = (domain: string, token: string) => (domain.trim() ? { domain, token } : null);
      apply(
        await api<SettingsResponse>("/api/settings", {
          method: "PUT",
          body: JSON.stringify({
            target: draft.targetDomain.trim() ? { domain: draft.targetDomain } : null,
            connected: store(draft.connectedDomain, draft.connectedToken),
            match: draft.match,
            fallback: draft.fallback,
            schedule: draft.schedule,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule() {
    if (!saved) return;
    setControlBusy(true);
    setError(null);
    try {
      // Applies instantly from the saved schedule, independent of any unsaved edits.
      const res = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ schedule: { ...saved.schedule, enabled: !saved.schedule.enabled } }),
      });
      setSaved(res.settings);
      setNextRuns(res.nextRuns);
      setDraft((d) => d && { ...d, schedule: { ...d.schedule, enabled: res.settings.schedule.enabled } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setControlBusy(false);
    }
  }

  async function toggleUpdates() {
    if (!saved) return;
    setTogglingUpdates(true);
    setError(null);
    try {
      // Saved instantly, independent of any unsaved edits in the forms.
      const res = await api<SettingsResponse>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ updatesEnabled: !saved.updatesEnabled }),
      });
      setSaved(res.settings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingUpdates(false);
    }
  }

  async function stopRun() {
    setControlBusy(true);
    try {
      await api("/api/runs/stop", { method: "POST", body: "{}" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setControlBusy(false);
    }
  }

  async function clearCheckpoint() {
    try {
      await api("/api/runs/checkpoint", { method: "DELETE", body: "{}" });
      setCheckpoint(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function run(dryRun: boolean, resume = false, applyLast = false) {
    setError(null);
    try {
      await api("/api/runs", { method: "POST", body: JSON.stringify({ dryRun, resume, applyLast }) });
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const ready = Boolean(saved.target?.domain && saved.connected?.hasToken) && !dirty;

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="kicker">Shopify · exact inventory</p>
          <h1>Quantity <em>Sync</em></h1>
        </div>
        <p className="muted" style={{ maxWidth: 380, margin: 0 }}>
          Scrape exact stock from a target store, then set the same quantities on your store by matching SKUs.
        </p>
      </header>

      <StatusBar
        scheduleEnabled={saved.schedule.enabled}
        updatesEnabled={saved.updatesEnabled}
        nextRun={nextRuns[0] ?? null}
        activeRun={runs.find((r) => r.status === "running") ?? null}
        busy={controlBusy}
        onToggleSchedule={toggleSchedule}
        onStopRun={stopRun}
      />

      <div className="grid">
        <div className="stack">
          <StoreCard
            num="1"
            title="Target store"
            hint="public storefront · domain only"
            role="target"
            saved={saved.target}
            domain={draft.targetDomain}
            onChange={(targetDomain) => update({ targetDomain })}
          />
          <StoreCard
            num="2"
            title="Connected store"
            hint="receives updates"
            role="connected"
            saved={saved.connected}
            domain={draft.connectedDomain}
            token={draft.connectedToken}
            onChange={(connectedDomain, connectedToken) => {
              if (connectedDomain.trim().toLowerCase() !== draft.connectedDomain.trim().toLowerCase()) setMetafields([]);
              update({ connectedDomain, connectedToken });
            }}
            onInfo={applyInfo}
          >
            <div className="row">
              <label className="field">
                <span>Vendor SKU metafield (product)</span>
                <select
                  value={`${draft.match.namespace}.${draft.match.key}`}
                  onChange={(e) => {
                    const m = metafields.find((o) => `${o.namespace}.${o.key}` === e.target.value);
                    if (m) update({ match: { namespace: m.namespace, key: m.key, owner: "product" } });
                  }}
                >
                  {!metafields.some((m) => m.namespace === draft.match.namespace && m.key === draft.match.key) && (
                    <option value={`${draft.match.namespace}.${draft.match.key}`}>
                      {metafields.length ? "Choose a metafield…" : `${draft.match.namespace}.${draft.match.key} (test connection to list)`}
                    </option>
                  )}
                  {metafields.map((m) => (
                    <option key={`${m.namespace}.${m.key}`} value={`${m.namespace}.${m.key}`}>
                      {m.name} · {m.namespace}.{m.key} · {m.type}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ConnectedSummary summary={runs.find((r) => r.connected)?.connected ?? null} />
          </StoreCard>
          <FallbackCard value={draft.fallback} onChange={(fallback) => update({ fallback })} />
          <SchedulePanel value={draft.schedule} nextRuns={nextRuns} onChange={(schedule) => update({ schedule })} />
          <TargetProducts running={running} fallback={draft.fallback} />
        </div>

        <aside className="aside">
          <RunPanel runs={runs} running={running} canRun={ready} updatesEnabled={saved.updatesEnabled} onToggleUpdates={toggleUpdates} togglingUpdates={togglingUpdates} onRun={run} applicableCheck={check} onStop={stopRun} checkpoint={checkpoint} onClearCheckpoint={clearCheckpoint} error={error} />
        </aside>
      </div>

      {dirty && (
        <div className="savebar" role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes.</span>
          <button type="button" className="btn" onClick={() => saved && setDraft(toDraft(saved))}>Discard</button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}
    </main>
  );
}
