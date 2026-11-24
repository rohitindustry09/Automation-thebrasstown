"use client";

import { MAX_COMPARE_PERCENT, MAX_MARKUP_FIXED, MAX_MARKUP_PERCENT, computePrices, roundPrice, type CompareMode, type PricingSettings, type Rounding } from "@/lib/pricing";

interface Props {
  value: PricingSettings;
  onChange: (next: PricingSettings) => void;
}

const EXAMPLE = { price: 2000, compareAt: 3000 };

const COMPARE_HELP: Record<CompareMode, string> = {
  off: "Your compare price is left exactly as it is.",
  mirror: "The target's compare price gets the same markup. If the target shows none, yours is cleared.",
  random: "Every product gets its own compare price: the target's selling price plus a random percentage (the target's own compare price is not used). A product keeps the same one on every run.",
};

const num = (raw: string, max: number) => Math.min(max, Math.max(0, Number(raw) || 0));

/** Selling and compare prices for matched products, worked out from the target's prices. */
export function PricingCard({ value, onChange }: Props) {
  const set = (patch: Partial<PricingSettings>) => onChange({ ...value, ...patch });
  const off = !value.enabled;
  const isPercent = value.markup.type === "percent";
  const { mode, minPercent, maxPercent } = value.compare;

  const sample = computePrices(EXAMPLE, value, "EXAMPLE-SKU");
  const lowest = roundPrice(EXAMPLE.price * (1 + minPercent / 100), value.rounding);
  const highest = roundPrice(EXAMPLE.price * (1 + maxPercent / 100), value.rounding);
  const compareText =
    mode === "off" ? "compare price unchanged" : mode === "random" ? `compare ${lowest}–${highest}` : sample?.compareAt != null ? `compare ${sample.compareAt}` : "compare cleared";

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="num">2c</span>
        <h2>Prices</h2>
        <label className="switch" style={{ marginLeft: "auto" }}>
          <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          {value.enabled ? "On" : "Off"}
        </label>
      </header>
      <div className="panel-body">
        <p className="muted" style={{ margin: 0 }}>
          Sets the selling price (and optionally the compare-at price) on your matched products from the target store&apos;s price.
          Needs the <strong>write_products</strong> permission on your store&apos;s token. Use Dry run first to see every change.
        </p>

        <div className="row">
          <label className="field">
            <span>Add to the target&apos;s selling price</span>
            <select
              value={value.markup.type}
              disabled={off}
              onChange={(e) => set({ markup: { type: e.target.value as "percent" | "fixed", value: Math.min(value.markup.value, e.target.value === "percent" ? MAX_MARKUP_PERCENT : MAX_MARKUP_FIXED) } })}
            >
              <option value="percent">A percentage (e.g. 5%)</option>
              <option value="fixed">A fixed amount (e.g. 5)</option>
            </select>
          </label>
          <label className="field">
            <span>{isPercent ? "Percent" : "Amount"}</span>
            <input
              type="number"
              min={0}
              max={isPercent ? MAX_MARKUP_PERCENT : MAX_MARKUP_FIXED}
              step={isPercent ? 0.5 : 1}
              value={value.markup.value}
              disabled={off}
              onChange={(e) => set({ markup: { ...value.markup, value: num(e.target.value, isPercent ? MAX_MARKUP_PERCENT : MAX_MARKUP_FIXED) } })}
            />
          </label>
        </div>

        <label className="field">
          <span>Compare-at price (the struck-through &quot;was&quot; price)</span>
          <select value={mode} disabled={off} onChange={(e) => set({ compare: { ...value.compare, mode: e.target.value as CompareMode } })}>
            <option value="off">Don&apos;t change it</option>
            <option value="mirror">Copy the target&apos;s, with the same markup</option>
            <option value="random">Random increase over the target&apos;s selling price</option>
          </select>
          <small className="muted">{COMPARE_HELP[mode]}</small>
        </label>

        {mode === "random" && (
          <div className="row">
            <label className="field">
              <span>From (% above target selling price)</span>
              <input
                type="number"
                min={0.1}
                max={MAX_COMPARE_PERCENT}
                step={1}
                value={minPercent}
                disabled={off}
                onChange={(e) => set({ compare: { ...value.compare, minPercent: num(e.target.value, MAX_COMPARE_PERCENT) } })}
              />
            </label>
            <label className="field">
              <span>To (% above target selling price)</span>
              <input
                type="number"
                min={0.1}
                max={MAX_COMPARE_PERCENT}
                step={1}
                value={maxPercent}
                disabled={off}
                onChange={(e) => set({ compare: { ...value.compare, maxPercent: num(e.target.value, MAX_COMPARE_PERCENT) } })}
              />
            </label>
          </div>
        )}
        {mode === "random" && minPercent > maxPercent && (
          <div className="notice bad" role="alert">&quot;From&quot; cannot be above &quot;To&quot;. Fix it before saving.</div>
        )}

        <label className="field">
          <span>Rounding</span>
          <select value={value.rounding} disabled={off} onChange={(e) => set({ rounding: e.target.value as Rounding })}>
            <option value="none">Keep cents (2100.00)</option>
            <option value="whole">Whole numbers (2100)</option>
            <option value="ends-9">Round up to a price ending in 9 (2109)</option>
          </select>
        </label>

        <div className="notice" role="status">
          Example: target sells at <strong>{EXAMPLE.price}</strong> (was {EXAMPLE.compareAt}) → yours sells at{" "}
          <strong>{sample?.price ?? "–"}</strong>, {compareText}.
        </div>
      </div>
    </section>
  );
}
