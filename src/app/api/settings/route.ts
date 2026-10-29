import { z } from "zod";
import { ValidationError, errorResponse, fail, publicSettings } from "@/lib/api";
import { nextRuns } from "@/lib/schedule";
import { normalizePublicDomain } from "@/lib/public-fetch";
import { normalizeDomain } from "@/lib/shopify";
import { loadSettings, updateSettings } from "@/lib/storage";
import { MAX_SCRAPE_WORKERS, MIN_SCRAPE_WORKERS, type StoreCredentials } from "@/lib/types";

export const dynamic = "force-dynamic";

const store = z.object({ domain: z.string().min(1).max(255), token: z.string().max(512).optional() });
const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

const body = z.object({
  target: z.object({ domain: z.string().min(1).max(255) }).nullable().optional(),
  connected: store.nullable().optional(),
  match: z
    .object({
      namespace: z.string().trim().min(1).max(64),
      key: z.string().trim().min(1).max(64),
      owner: z.enum(["product", "variant"]),
    })
    .optional(),
  locationId: z.string().nullable().optional(),
  updatesEnabled: z.boolean().optional(),
  scrapeWorkers: z.number().int().min(MIN_SCRAPE_WORKERS).max(MAX_SCRAPE_WORKERS).optional(),
  fallback: z
    .object({ enabled: z.boolean(), quantity: z.number().int().min(0).max(1_000_000), onlyWhenZero: z.boolean() })
    .optional(),
  schedule: z
    .object({
      enabled: z.boolean(),
      timezone: timeZone,
      mode: z.enum(["daily", "dates"]),
      dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(1000),
      times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(24),
    })
    .optional(),
});

function mergeStore(
  incoming: z.infer<typeof store> | null | undefined,
  current: StoreCredentials | null,
): StoreCredentials | null {
  if (incoming === undefined) return current;
  if (incoming === null) return null;
  const domain = normalizeDomain(incoming.domain);
  if (!domain) throw new ValidationError(`"${incoming.domain}" is not a valid your-store.myshopify.com domain`);
  // An empty token keeps the saved one, unless the domain changed (never reuse a token across stores).
  const keep = current && current.domain === domain ? current.token : "";
  return { domain, token: incoming.token?.trim() || keep };
}

function mergeTarget(
  incoming: { domain: string } | null | undefined,
  current: { domain: string } | null,
): { domain: string } | null {
  if (incoming === undefined) return current;
  if (incoming === null) return null;
  const domain = normalizePublicDomain(incoming.domain);
  if (!domain) throw new ValidationError(`"${incoming.domain}" is not a valid store domain (e.g. bhunes.com)`);
  return { domain };
}

export async function GET() {
  const settings = await loadSettings();
  return Response.json({
    settings: publicSettings(settings),
    nextRuns: nextRuns(settings.schedule, new Date(), 8),
  });
}

export async function PUT(request: Request) {
  try {
    const input = body.parse(await request.json());
    const schedule = input.schedule && {
      ...input.schedule,
      dates: [...new Set(input.schedule.dates)].sort(),
      times: [...new Set(input.schedule.times)].sort(),
    };
    if (schedule?.enabled && schedule.times.length === 0) return fail("Add at least one run time");
    if (schedule?.enabled && schedule.mode === "dates" && schedule.dates.length === 0) return fail("Pick at least one date");

    const next = await updateSettings((cur) => ({
      ...cur,
      target: mergeTarget(input.target, cur.target),
      connected: mergeStore(input.connected, cur.connected),
      match: input.match ?? cur.match,
      fallback: input.fallback ?? cur.fallback,
      updatesEnabled: input.updatesEnabled ?? cur.updatesEnabled,
      scrapeWorkers: input.scrapeWorkers ?? cur.scrapeWorkers,
      locationId: input.locationId === undefined ? cur.locationId : input.locationId,
      schedule: schedule ?? cur.schedule,
    }));
    return Response.json({ settings: publicSettings(next), nextRuns: nextRuns(next.schedule, new Date(), 8) });
  } catch (err) {
    return errorResponse(err);
  }
}
