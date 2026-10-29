import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const USER_AGENT = "Mozilla/5.0 (compatible; QuantitySync/1.0; polite rate-limited reader)";
const BASE_INTERVAL_MS = Number(process.env.SCRAPE_MIN_INTERVAL_MS ?? 150);
const MAX_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 4;
const MAX_REDIRECTS = 3;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export class ScrapeError extends Error {}

/** "https://Shop.com/products/x" -> "shop.com"; null when it is not a plain public hostname. */
export function normalizePublicDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  if (!HOSTNAME_RE.test(host)) return null;
  if (/\.(local|localhost|internal|lan|home|corp)$/.test(host)) return null;
  return host;
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb");
}

/** Refuses hosts that resolve to loopback/private/link-local addresses (SSRF guard). */
async function assertPublicHost(host: string) {
  const addresses = await lookup(host, { all: true }).catch(() => {
    throw new ScrapeError(`Could not resolve ${host}`);
  });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new ScrapeError(`${host} does not resolve to a public address`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;
let intervalMs = BASE_INTERVAL_MS;
let okStreak = 0;

/** Adaptive pacing: back off hard when the store says 429, creep back to full speed while it is happy. */
function noteResponse(status: number) {
  if (status === 429) {
    intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS);
    okStreak = 0;
  } else if (++okStreak >= 25) {
    okStreak = 0;
    intervalMs = Math.max(BASE_INTERVAL_MS, Math.round(intervalMs * 0.7));
  }
}

/** Global throttle: requests start at least `intervalMs` apart, even with parallel workers. */
async function throttle() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + intervalMs;
  if (start > now) await sleep(start - now);
}

/** Public GET with SSRF checks, manual redirects (re-validated), throttling, and retries. */
export async function publicGet(url: string, accept = "*/*"): Promise<{ status: number; text: string }> {
  let current = new URL(url);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:") throw new ScrapeError(`Only https URLs are allowed (${current.host})`);
    if (!normalizePublicDomain(current.hostname)) throw new ScrapeError(`Blocked host ${current.hostname}`);
    await assertPublicHost(current.hostname);

    let res: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await throttle();
      try {
        res = await fetch(current, {
          headers: { "User-Agent": USER_AGENT, Accept: accept },
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) throw new ScrapeError(`${current.host}: ${(err as Error).message}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      noteResponse(res.status);
      if (res.status !== 429 && res.status < 500) break;
      if (attempt === MAX_ATTEMPTS) throw new ScrapeError(`${current.host}: HTTP ${res.status} after ${attempt} attempts`);
      await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
    }
    if (!res) throw new ScrapeError(`${current.host}: no response`);

    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location") as string, current);
      continue;
    }
    return { status: res.status, text: await res.text() };
  }
  throw new ScrapeError("Too many redirects");
}
