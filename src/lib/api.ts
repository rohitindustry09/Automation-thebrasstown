import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Settings } from "./types";

export class ValidationError extends Error {}

export const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export function errorResponse(err: unknown) {
  if (err instanceof ValidationError) return fail(err.message);
  if (err instanceof ZodError) return fail(err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return fail(err instanceof Error ? err.message : "Unexpected error", 500);
}

const mask = (c: { domain: string; token: string } | null) =>
  c ? { domain: c.domain, hasToken: c.token.length > 0, tokenHint: c.token.slice(-4) } : null;

/** Settings safe to send to the browser: tokens never leave the server. */
export const publicSettings = (s: Settings) => ({
  ...s,
  target: s.target,
  connected: mask(s.connected),
});
