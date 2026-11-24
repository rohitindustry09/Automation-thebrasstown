import { DEFAULT_PRICING, type PricingSettings } from "./pricing";

export type StoreRole = "target" | "connected";

export interface StoreCredentials {
  domain: string;
  token: string;
}

export interface MatchSettings {
  namespace: string;
  key: string;
  owner: "product" | "variant";
}

export type ScheduleMode = "daily" | "dates";

export interface ScheduleSettings {
  enabled: boolean;
  timezone: string;
  mode: ScheduleMode;
  /** YYYY-MM-DD, used when mode === "dates" */
  dates: string[];
  /** HH:mm (24h), one run per entry per matching day */
  times: string[];
}

export interface FallbackSettings {
  enabled: boolean;
  quantity: number;
  onlyWhenZero: boolean;
}

export interface Settings {
  /** Public storefront to scrape — domain only, no credentials */
  target: { domain: string } | null;
  connected: StoreCredentials | null;
  match: MatchSettings;
  locationId: string | null;
  /** Quantity for in-stock products whose exact number the target hides */
  fallback: FallbackSettings;
  /** Selling and compare prices on your store, derived from the target's */
  pricing: PricingSettings;
  /** Master switch: when off, scheduled runs only check and preview, nothing is written */
  updatesEnabled: boolean;
  /** Product pages read in parallel while scraping the target (more = faster, but harder on the target) */
  scrapeWorkers: number;
  schedule: ScheduleSettings;
}

export type RunStatus = "running" | "success" | "partial" | "failed" | "skipped" | "cancelled";
export type RunTrigger = "schedule" | "manual";
export type ChangeStatus = "updated" | "unchanged" | "skipped" | "failed" | "not-in-target";

export interface RunCounters {
  targetVariants: number;
  connectedVariants: number;
  matched: number;
  updated: number;
  unchanged: number;
  notInTarget: number;
  skipped: number;
  failed: number;
}

export interface RunChange {
  sku: string;
  title: string;
  from: number | null;
  to: number | null;
  status: ChangeStatus;
  note?: string;
  /** The target lists this product as on backorder, so 0 is a confirmed answer, not a flaky scrape */
  backorder?: boolean;
}

export type PriceStatus = "updated" | "unchanged" | "skipped" | "failed";

/** One product's price change (kept apart from quantity rows: a product can change in one and not the other) */
export interface PriceChange {
  sku: string;
  /** Which of your variants this row is about (two products can share a vendor SKU) */
  variantId?: string;
  title: string;
  fromPrice: number | null;
  toPrice: number | null;
  fromCompare: number | null;
  /** Compare price after the run (the current one when it is left untouched) */
  toCompare: number | null;
  status: PriceStatus;
  note?: string;
}

export interface PriceCounters {
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export type TargetState = "sold-out" | "exact" | "hidden" | "pending" | "unreadable";

/** One target-store SKU and what the scrape learned about its quantity */
export interface TargetItem {
  title: string;
  sku: string;
  handle: string;
  quantity: number | null;
  state: TargetState;
  /** The product page says it is on backorder (made to order): its quantity is set to 0 */
  backorder?: boolean;
  /** The target's selling price and "was" price for this SKU */
  price?: number | null;
  compareAt?: number | null;
  /** Filled once your store has been read: is this SKU on your store, and its current quantity */
  inYourStore?: boolean;
  yours?: number | null;
  /** The matching product's title on your store (matched by vendor SKU) */
  yourTitle?: string;
  /** Your store's current selling and compare price for the matching product */
  yourPrice?: number | null;
  yourCompareAt?: number | null;
  /** The matching variant's own SKU on your store (not the vendor-SKU metafield) */
  yourSku?: string;
  /** Your store has a product with this SKU, but its title says it is a different product (title shown) */
  titleMismatch?: string;
  /** Matched by SKU alone, but the two titles look very different: worth a human check */
  titleWarning?: boolean;
  /** Why your store cannot be updated for this product, if so */
  blocked?: string;
}

/** What was read from your store: how much of it carries a quantity, and where from */
export interface ConnectedSummary {
  variants: number;
  withVendorSku: number;
  /** Variants stocked at the location we read, and the total units there */
  stocked: number;
  units: number;
  location: string;
}

/** Live scrape progress shown while a run is active */
export interface RunProgress {
  /** Product the scraper is on right now */
  current: string | null;
  /** SKUs with an exact quantity so far (sold out = 0, or a published count) */
  exact: number;
  /** In-stock SKUs whose number the storefront hides */
  hidden: number;
  checked: number;
  /** In-stock product pages to open */
  total: number;
  /** Products in the target catalog, and how many are sold out (exactly 0, no page needed) */
  catalogTotal: number;
  soldOut: number;
}

export interface RunRecord {
  id: string;
  trigger: RunTrigger;
  dryRun: boolean;
  status: RunStatus;
  phase: string;
  startedAt: string;
  finishedAt: string | null;
  slot?: string;
  counters: RunCounters;
  changes: RunChange[];
  /** Price changes, when price updating is on */
  priceChanges?: PriceChange[];
  prices?: PriceCounters;
  log: string[];
  progress?: RunProgress;
  /** Final tally of the target scrape: how many SKUs got an exact quantity */
  scrape?: { soldOut: number; published: number; hidden: number };
  connected?: ConnectedSummary;
  /** Set on list responses, which leave `changes` out */
  changeCount?: number;
  /** The target store this run scraped (a saved check is only applied while the target is unchanged) */
  targetDomain?: string;
  /** 0 for the first try; >0 for an automatic retry after an error */
  attempt?: number;
  /** Continue the saved scrape instead of starting fresh (set by the Resume button) */
  resume?: boolean;
}

export const emptyCounters = (): RunCounters => ({
  targetVariants: 0,
  connectedVariants: 0,
  matched: 0,
  updated: 0,
  unchanged: 0,
  notInTarget: 0,
  skipped: 0,
  failed: 0,
});

export const MIN_SCRAPE_WORKERS = 1;
export const MAX_SCRAPE_WORKERS = 20;

export const DEFAULT_SETTINGS: Settings = {
  target: null,
  connected: null,
  match: { namespace: "custom", key: "vendor_sku", owner: "product" },
  locationId: null,
  fallback: { enabled: false, quantity: 10, onlyWhenZero: true },
  pricing: DEFAULT_PRICING,
  updatesEnabled: true,
  scrapeWorkers: 10,
  schedule: {
    enabled: false,
    timezone: process.env.DEFAULT_TIMEZONE ?? "Asia/Kolkata",
    mode: "daily",
    dates: [],
    times: ["09:00"],
  },
};
