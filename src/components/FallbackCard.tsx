"use client";

import type { FallbackSettings } from "@/lib/types";

interface Props {
  value: FallbackSettings;
  onChange: (next: FallbackSettings) => void;
}

/** Quantity for in-stock products whose exact number the target store does not publish. */
export function FallbackCard({ value, onChange }: Props) {
  const set = (patch: Partial<FallbackSettings>) => onChange({ ...value, ...patch });

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="num">2b</span>
        <h2>Hidden quantities</h2>
        <label className="switch" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {value.enabled ? "On" : "Off"}
        </label>
      </header>
      <div className="panel-body">
        <p className="muted" style={{ margin: 0 }}>
          The target store hides the number for most in-stock products. Choose a quantity to set on your store for those,
          so they are not left unchanged. Exact counts and sold-out (0) products are never affected.
        </p>
        <div className="row">
          <label className="field">
            <span>Quantity for in-stock products with a hidden count</span>
            <input
              type="number"
              min={0}
              max={1000000}
              step={1}
              value={value.quantity}
              disabled={!value.enabled}
              onChange={(e) => set({ quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
            />
          </label>
        </div>
        <label className="switch" style={{ fontWeight: 400 }}>
          <input
            type="checkbox"
            checked={value.onlyWhenZero}
            disabled={!value.enabled}
            onChange={(e) => set({ onlyWhenZero: e.target.checked })}
          />
          Only fill when my store is at 0 (keeps counts that dropped after sales)
        </label>
      </div>
    </section>
  );
}
