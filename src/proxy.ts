import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const digest = (s: string) => createHash("sha256").update(s).digest();

const deny = (status: number, message: string, headers?: Record<string, string>) =>
  new NextResponse(message, { status, headers });

function passwordMatches(header: string, password: string): boolean {
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  return timingSafeEqual(digest(decoded.slice(sep + 1)), digest(password));
}

/** State-changing calls must come from this app's own pages (blocks cross-site form posts). */
function isSameOriginWrite(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  if (!request.headers.get("content-type")?.startsWith("application/json")) return false;
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin";
}

/**
 * - APP_PASSWORD set: HTTP Basic auth (any username) for pages and API.
 * - APP_PASSWORD unset: only local access (localhost Host header) is allowed.
 */
export function proxy(request: NextRequest) {
  // Liveness endpoint for keep-alive pings and uptime monitors: open, read-only, nothing sensitive.
  if (request.method === "GET" && request.nextUrl.pathname === "/api/health") return NextResponse.next();

  if (!isSameOriginWrite(request)) return deny(403, "Cross-site request blocked");

  const password = process.env.APP_PASSWORD;
  if (!password) {
    const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "");
    return LOCAL_HOSTS.has(host) ? NextResponse.next() : deny(403, "Set APP_PASSWORD to allow remote access");
  }

  if (passwordMatches(request.headers.get("authorization") ?? "", password)) return NextResponse.next();
  return deny(401, "Authentication required", { "WWW-Authenticate": 'Basic realm="Quantity Sync"' });
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
