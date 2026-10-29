const g = globalThis as unknown as { __keepAliveTimer?: NodeJS.Timeout };

const DEFAULT_MINUTES = 10;

/**
 * The app's own public address, read from the environment: APP_URL (your domain, with or without
 * https://), else KEEP_ALIVE_URL, else RENDER_EXTERNAL_URL (set automatically by Render).
 */
export function resolveKeepAliveTarget(env: Record<string, string | undefined>): URL | null {
  const raw = (env.APP_URL || env.KEEP_ALIVE_URL || env.RENDER_EXTERNAL_URL || "").trim();
  if (!raw) return null;
  try {
    const origin = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin;
    return new URL("/api/health", origin);
  } catch {
    return null;
  }
}

/**
 * Hosts like Render's free plan put an app to sleep after ~15 minutes without inbound traffic.
 * Requesting our own public /api/health on a timer counts as traffic. Active only when the app's
 * address is configured (see resolveKeepAliveTarget).
 */
export function startKeepAlive() {
  if (g.__keepAliveTimer) return;
  const target = resolveKeepAliveTarget(process.env);
  if (!target) {
    if (process.env.APP_URL) console.warn(`[keep-alive] ignoring invalid APP_URL "${process.env.APP_URL}"`);
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
