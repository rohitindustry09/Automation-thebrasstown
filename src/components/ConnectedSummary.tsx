import type { ConnectedSummary as Summary } from "@/lib/types";

const n = (v: number) => v.toLocaleString("en-US");

/** How much of your store was read on the last run, and the stock found at the location we write to. */
export function ConnectedSummary({ summary }: { summary: Summary | null }) {
  if (!summary) {
    return <p className="muted small-note">Your store&apos;s quantities appear here after the first run (a Dry run is fine).</p>;
  }
  return (
    <div className="stats" aria-label="Your store, as read on the last run">
      <div className="stat">
        <b>{n(summary.variants)}</b>
        <span>Products (variants) on your store</span>
      </div>
      <div className="stat">
        <b>{n(summary.withVendorSku)}</b>
        <span>Have a vendor SKU</span>
      </div>
      <div className="stat highlight">
        <b>{n(summary.stocked)}</b>
        <span>Have a quantity at {summary.location}</span>
      </div>
      <div className="stat highlight">
        <b>{n(summary.units)}</b>
        <span>Total units at {summary.location}</span>
      </div>
    </div>
  );
}
