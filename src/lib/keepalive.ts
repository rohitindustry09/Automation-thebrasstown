const g = globalThis as unknown as { __keepAliveTimer?: NodeJS.Timeout };

const DEFAULT_MINUTES = 10;

/**
 * Hosts like Render's free plan put an app to sleep after ~15 minutes without inbound traffic.
 * Requesting our own public /api/health on a timer counts as traffic. Active only when a public
 * URL is known: KEEP_ALIVE_URL, or RENDER_EXTERNAL_URL (set automatically by Render).
 */
export function startKeepAlive() {
  if (g.__keepAliveTimer) return;
  const base = process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base) return;

  let target: URL;
  try {
    target = new URL("/api/health", base);
  } catch {
    console.warn(`[keep-alive] ignoring invalid URL "${base}"`);
    return;
  }
  const minutes = Math.max(1, Number(process.env.KEEP_ALIVE_MINUTES) || DEFAULT_MINUTES);

  const ping = async () => {
    try {
      const res = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) console.warn(`[keep-alive] ${target.origin} answered HTTP ${res.status}`);
    } catch (err) {
      console.warn("[keep-alive] ping failed:", err instanceof Error ? err.message : err);
    }
  };

  g.__keepAliveTimer = setInterval(() => void ping(), minutes * 60_000);
  g.__keepAliveTimer.unref();
  console.info(`[keep-alive] pinging ${target.origin} every ${minutes} min`);
}
