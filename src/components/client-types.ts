import type { PricingSettings } from "@/lib/pricing";
import type { FallbackSettings, MatchSettings, ScheduleSettings } from "@/lib/types";

export interface PublicStore {
  domain: string;
  hasToken: boolean;
  tokenHint: string;
}

export interface PublicSettings {
  target: { domain: string } | null;
  connected: PublicStore | null;
  match: MatchSettings;
  locationId: string | null;
  fallback: FallbackSettings;
  pricing: PricingSettings;
  updatesEnabled: boolean;
  scrapeWorkers: number;
  schedule: ScheduleSettings;
}

export interface Draft {
  targetDomain: string;
  connectedDomain: string;
  connectedToken: string;
  match: MatchSettings;
  locationId: string | null;
  fallback: FallbackSettings;
  pricing: PricingSettings;
  scrapeWorkers: number;
  schedule: ScheduleSettings;
}

export interface MetafieldOption {
  namespace: string;
  key: string;
  name: string;
  type: string;
}

export interface ShopInfoResponse {
  name: string;
  locations: Location[];
  metafields: MetafieldOption[];
}

export interface ApplicableCheck {
  id: string;
  finishedAt: string | null;
  wouldUpdate: number;
}

export interface CheckpointInfo {
  checked: number;
  updatedAt: string;
  inProgress: boolean;
  dryRun: boolean;
}

export interface Location {
  id: string;
  name: string;
  active: boolean;
}

export const toDraft = (s: PublicSettings): Draft => ({
  targetDomain: s.target?.domain ?? "",
  connectedDomain: s.connected?.domain ?? "",
  connectedToken: "",
  match: s.match,
  locationId: s.locationId,
  fallback: s.fallback,
  pricing: s.pricing,
  scrapeWorkers: s.scrapeWorkers,
  schedule: s.schedule,
});

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}
