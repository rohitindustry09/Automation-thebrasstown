"use client";

import { useState } from "react";
import { api, type PublicStore, type ShopInfoResponse } from "./client-types";

interface Props {
  num: string;
  title: string;
  hint: string;
  /** "target" is a public storefront: domain only, nothing to authenticate or test. */
  role: "target" | "connected";
  saved: PublicStore | { domain: string } | null;
  domain: string;
  token?: string;
  onChange: (domain: string, token: string) => void;
  /** Called with the store's locations and product metafields after a successful connection test. */
  onInfo?: (info: ShopInfoResponse) => void;
  children?: React.ReactNode;
}

export function StoreCard({ num, title, hint, role, saved, domain, token = "", onChange, onInfo, children }: Props) {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "ok" | "bad"; text: string }>({ kind: "idle", text: "" });
  const sameAsSaved = saved?.domain === domain.trim().toLowerCase();
  const isTarget = role === "target";
  const savedStore = saved && "hasToken" in saved ? saved : null;

  async function test() {
    setState({ kind: "busy", text: "Connecting…" });
    try {
      const info = await api<ShopInfoResponse>("/api/stores/test", {
        method: "POST",
        body: JSON.stringify({ domain, token }),
      });
      setState({ kind: "ok", text: `Connected to “${info.name}”.` });
      onInfo?.(info);
    } catch (err) {
      setState({ kind: "bad", text: (err as Error).message });
    }
  }

  return (
    <section className="panel">
      <header className="panel-head">
        <span className="num">{num}</span>
        <h2>{title}</h2>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 13 }}>{hint}</span>
      </header>
      <div className="panel-body">
        <div className="row">
          <label className="field">
            <span>Store domain</span>
            <input
              value={domain}
              placeholder={isTarget ? "target-store.com (or .myshopify.com)" : "your-store.myshopify.com"}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => onChange(e.target.value, token)}
            />
          </label>
          {!isTarget && (
          <label className="field">
            <span>Admin API access token</span>
            <input
              type="password"
              value={token}
              autoComplete="new-password"
              placeholder={savedStore?.hasToken && sameAsSaved ? `saved · ends …${savedStore.tokenHint}` : "shpat_…"}
              onChange={(e) => onChange(domain, e.target.value)}
            />
          </label>
          )}
        </div>
        {children}
        {isTarget ? (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Public storefront only — no access token. Exact counts come from out-of-stock items (0) and any number the store publishes.
          </p>
        ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn small" onClick={test} disabled={state.kind === "busy" || !domain.trim()}>
            Test connection
          </button>
          {state.text && (
            <span className={`notice ${state.kind === "ok" ? "ok" : state.kind === "bad" ? "bad" : ""}`} role="status">
              {state.text}
            </span>
          )}
        </div>
        )}
      </div>
    </section>
  );
}
