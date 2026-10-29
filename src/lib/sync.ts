import { randomUUID } from "node:crypto";
import { CancelledError, clearCancel } from "./cancel";
import { annotateItems, effectiveDryRun, isUsableCheck, mayResumeCheckpoint, normalizeSku } from "./decide";
import { applyUpdates, fetchConnectedVariants, pickStockLocation } from "./inventory-destination";
import type { ConnectedVariant, Plan, TargetVariant } from "./plan";
import { scrapeTargetInventory } from "./inventory-source";
import { buildTargetIndex, planUpdates } from "./plan";
import { fetchShopInfo } from "./shopify";
import {
  clearCheckpoint,
  loadCheckpoint,
  loadRuns,
  loadSettings,
  loadTargetItems,
  saveCheckpoint,
  saveRun,
  saveTargetItems,
  type Checkpoint,
} from "./storage";
import { emptyCounters, type RunRecord, type RunTrigger, type Settings, type StoreCredentials, type TargetItem } from "./types";

/** A finished check can be applied without a new scrape for this long; after that stock has likely moved. */
const APPLY_CHECK_MAX_HOURS = Number(process.env.APPLY_CHECK_MAX_HOURS ?? 2);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 60_000;
/** Page counts older than this are never reused: stock changes, and a stale "Only 3 left" must not be written. */
const CHECKPOINT_MAX_HOURS = Number(process.env.CHECKPOINT_MAX_HOURS ?? 1);
/** Abort (nothing written) when more than this share of product pages could not be read. */
const MAX_UNREADABLE_PERCENT = Number(process.env.MAX_UNREADABLE_PERCENT ?? 10);
/** Abort (nothing written) when this share of your in-stock products would all be set to 0 at once. */
const MAX_ZERO_PERCENT = Number(process.env.MAX_ZERO_PERCENT ?? 40);

/** A safety stop: unlike a network error, retrying the same run would not help. */
class GuardError extends Error {}
/** Products that change are always kept in full; informational rows are sampled to keep history small. */
const MAX_ACTION_ROWS = 10_000;
const MAX_INFO_ROWS = 300;
const MAX_LOG = 200;

const g = globalThis as unknown as {
  __activeRun?: RunRecord | null;
  __targetItems?: TargetItem[];
  __targetVersion?: number;
};

export const getActiveRun = (): RunRecord | null => g.__activeRun ?? null;

const bumpTarget = () => {
  g.__targetVersion = (g.__targetVersion ?? 0) + 1;
};

/**
 * Live list while a run is scraping, otherwise the last completed scrape. `version` changes whenever
 * the list does, so a client that already has the current version can skip the download.
 */
export async function getTargetItems(since?: number): Promise<{ version: number; live: boolean; items?: TargetItem[] }> {
  const live = getActiveRun() !== null && g.__targetItems !== undefined;
  if (live) {
    const version = g.__targetVersion ?? 0;
    return since === version ? { version, live } : { version, live, items: g.__targetItems };
  }
  // Not scraping: the saved list. Use a negative version so a switch from live to saved always reloads.
  const items = await loadTargetItems();
  const version = -items.length - 1;
  return since === version ? { version, live } : { version, live, items };
}

const isFresh = (cp: Checkpoint) =>
  Date.now() - new Date(cp.createdAt ?? cp.updatedAt).getTime() < CHECKPOINT_MAX_HOURS * 3_600_000;

/** Summary of an unfinished scrape that the next run will continue from, if any. */
export async function getCheckpointInfo(): Promise<{ checked: number; updatedAt: string; inProgress: boolean; dryRun: boolean } | null> {
  const cp = await loadCheckpoint();
  if (!cp || !isFresh(cp)) return null;
  return { checked: Object.keys(cp.results).length, updatedAt: cp.updatedAt, inProgress: cp.inProgress, dryRun: cp.dryRun };
}

/** After a server restart: continue a scrape that was interrupted mid-run (not one the user stopped). */
export async function resumeAfterRestart(): Promise<void> {
  const cp = await loadCheckpoint();
  if (!cp?.inProgress || !isFresh(cp) || getActiveRun()) return;
  console.info("[sync] resuming interrupted run from checkpoint");
  await startSync({ trigger: cp.trigger, dryRun: cp.dryRun, attempt: 1 });
}

function scheduleRetry(run: RunRecord) {
  const attempt = (run.attempt ?? 0) + 1;
  if (attempt > MAX_RETRIES) return;
  const delay = RETRY_BASE_MS * 2 ** (attempt - 1);
  log(run, `Will retry automatically in ${delay / 60_000} min (retry ${attempt}/${MAX_RETRIES}), resuming from the saved checkpoint.`);
  setTimeout(() => {
    void (async () => {
      const cp = await loadCheckpoint();
      if (!cp?.inProgress || !isFresh(cp) || getActiveRun()) return; // stopped, finished, or something else is running
      await startSync({ trigger: run.trigger, dryRun: run.dryRun, attempt });
    })().catch((err) => console.error("[sync] retry failed to start:", err));
  }, delay);
}

export async function listRuns(): Promise<RunRecord[]> {
  const saved = await loadRuns();
  const active = getActiveRun();
  return active ? [active, ...saved.filter((r) => r.id !== active.id)] : saved;
}

/** A run without its (potentially thousands of) change rows, for cheap polling. */
export function summarizeRun(run: RunRecord): RunRecord & { changeCount: number } {
  return { ...run, changes: [], changeCount: run.changes.length, log: run.log.slice(-30) };
}

export async function getRun(id: string): Promise<RunRecord | null> {
  const active = getActiveRun();
  if (active?.id === id) return active;
  return (await loadRuns()).find((r) => r.id === id) ?? null;
}

function newRun(trigger: RunTrigger, dryRun: boolean, slot?: string, attempt = 0, resume = false): RunRecord {
  return {
    attempt,
    resume,
    id: randomUUID(),
    trigger,
    dryRun,
    slot,
    status: "running",
    phase: "Starting",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    counters: emptyCounters(),
    changes: [],
    log: [],
  };
}

const log = (run: RunRecord, line: string) => {
  run.log.push(`${new Date().toISOString().slice(11, 19)}  ${line}`);
  if (run.log.length > MAX_LOG) run.log.shift();
};

/**
 * Starts a run unless one is already in progress. Returns the record immediately;
 * the work continues in the background and is observable via listRuns().
 */
export async function startSync(opts: {
  trigger: RunTrigger;
  dryRun: boolean;
  slot?: string;
  attempt?: number;
  resume?: boolean;
}): Promise<RunRecord> {
  const { trigger, dryRun, slot, attempt, resume } = opts;
  return launch(newRun(trigger, dryRun, slot, attempt, resume), execute);
}

/** The latest finished "check only" run, if its saved scrape can still be applied. */
export async function getApplicableCheck(): Promise<RunRecord | null> {
  const domain = (await loadSettings()).target?.domain;
  const latest = (await listRuns()).find((r) => r.status !== "skipped");
  return domain && latest && isUsableCheck(latest, Date.now(), APPLY_CHECK_MAX_HOURS, domain) ? latest : null;
}

/** Writes the quantities found by the last finished check, without scraping the target again. */
export async function startApplyLastCheck(checkId: string): Promise<RunRecord> {
  const check = await getApplicableCheck();
  if (!check) throw new Error("There is no recent finished check to apply. Press Check only first.");
  if (check.id !== checkId) throw new Error("A newer check finished while you were looking. Review it, then press Update again.");
  return launch(newRun("manual", false), (run) => executeApply(run, check));
}

async function launch(run: RunRecord, task: (run: RunRecord) => Promise<void>): Promise<RunRecord> {
  if (getActiveRun()) {
    run.status = "skipped";
    run.phase = "Skipped";
    run.finishedAt = run.startedAt;
    log(run, "Another run is still in progress — skipped.");
    await saveRun(run);
    return run;
  }

  clearCancel();
  g.__targetItems = undefined;
  bumpTarget();
  g.__activeRun = run;
  void task(run)
    .catch((err) => console.error("[sync] could not persist run:", err))
    .finally(() => {
      g.__activeRun = null;
    });
  return run;
}

/** Writes the planned quantities, then reconciles the run record with what really happened. */
async function writeUpdates(run: RunRecord, store: StoreCredentials, locationId: string, plan: Plan): Promise<boolean> {
  run.phase = `Updating ${plan.updates.length} quantities`;
  const { results, cancelled } = await applyUpdates(store, locationId, plan.updates, (done) => {
    run.phase = `Updating quantities (${done}/${plan.updates.length})`;
  });
  const bySku = new Map(results.map((r) => [r.update.sku, r]));
  for (const c of run.changes) {
    if (c.status !== "updated") continue;
    const r = bySku.get(c.sku);
    if (!r) Object.assign(c, { status: "skipped", note: "stopped before this was written" });
    else if (r.error) Object.assign(c, { status: "failed", note: r.error });
  }
  const failures = results.filter((r) => r.error);
  run.counters.updated = results.length - failures.length;
  run.counters.failed = failures.length;
  run.counters.skipped += plan.updates.length - results.length;
  if (failures.length > 0) log(run, `${failures.length} updates failed, e.g. ${failures.slice(0, 5).map((r) => r.error).join(" | ")}`);
  log(run, `Updated ${run.counters.updated} quantities${cancelled ? ` (stopped; ${plan.updates.length - results.length} not written)` : ""}.`);

  // The saved Target products view should show what your store holds now, not the pre-write numbers.
  const written = new Map(results.filter((r) => !r.error).map((r) => [normalizeSku(r.update.sku), r.update.quantity]));
  if (g.__targetItems && written.size > 0) {
    for (const item of g.__targetItems) {
      const q = written.get(normalizeSku(item.sku));
      if (q !== undefined) item.yours = q;
    }
    bumpTarget();
    await saveTargetItems(g.__targetItems);
  }
  return cancelled;
}

/** Plans what to change from the target quantities, applies the safety guard, then previews or writes. True when stopped by the user. */
async function planAndWrite(
  run: RunRecord,
  settings: Settings,
  store: StoreCredentials,
  locationId: string,
  index: ReadonlyMap<string, number | null>,
  withVendorSku: ConnectedVariant[],
  skipReasons: ReadonlyMap<string, string>,
): Promise<boolean> {
  const plan = planUpdates(index, withVendorSku, {
    requireSingleVariant: settings.match.owner === "product",
    fallback: settings.fallback.enabled ? settings.fallback : null,
    skipReasons,
  });

  // Sanity guard: a flaky or changed target (maintenance, theme change) must not zero out your catalog.
  const wouldZero = plan.changes.filter((c) => c.status === "updated" && c.to === 0 && (c.from ?? 0) > 0).length;
  const inStockNow = withVendorSku.filter((v) => (v.available ?? 0) > 0).length;
  if (wouldZero > 25 && (wouldZero / Math.max(1, inStockNow)) * 100 > MAX_ZERO_PERCENT) {
    throw new GuardError(
      `Refusing to set ${wouldZero} in-stock products to 0 at once (over ${MAX_ZERO_PERCENT}% of your ${inStockNow}). The target may be in maintenance or changed. Nothing was written.`,
    );
  }

  const { targetVariants, connectedVariants } = run.counters;
  run.counters = { ...plan.counters, targetVariants, connectedVariants };
  const keep = (status: string, limit: number) => plan.changes.filter((c) => c.status === status).slice(0, limit);
  run.changes = [
    ...keep("updated", MAX_ACTION_ROWS),
    ...keep("failed", MAX_ACTION_ROWS),
    ...keep("skipped", MAX_INFO_ROWS),
    ...keep("not-in-target", MAX_INFO_ROWS),
  ];

  if (run.dryRun) {
    log(run, `Dry run: ${plan.updates.length} quantities would change. Nothing was written.`);
    run.counters.updated = plan.updates.length;
  } else {
    return writeUpdates(run, store, locationId, plan);
  }
  return false;
}

async function execute(run: RunRecord): Promise<void> {
  let checkpointed = false;
  let connectedRead: Promise<unknown> | null = null;
  try {
    const settings = await loadSettings();
    if (!settings.target) throw new Error("Target store domain is not configured");
    if (!settings.connected) throw new Error("Connected store is not configured");
    run.targetDomain = settings.target.domain;
    if (effectiveDryRun(run.trigger, run.dryRun, settings.updatesEnabled) && !run.dryRun) {
      run.dryRun = true;
      log(run, "Quantity updates are switched off, so this scheduled run only checks and previews.");
    }
    const annotateOptions = { requireSingleVariant: settings.match.owner === "product" };
    // Shopify needs a location to set stock at: use the one where your products are actually stocked.
    const shop = await fetchShopInfo(settings.connected);
    const stockLocation = await pickStockLocation(settings.connected, shop.locations.filter((l) => l.active));
    const locationId = stockLocation.id;
    log(run, `Stock location: ${stockLocation.name}.`);

    log(run, `${run.dryRun ? "Dry run" : "Run"} started (${run.trigger})${run.attempt ? `, automatic retry ${run.attempt}` : ""}.`);

    // "Run now" and scheduled runs start fresh. Saved page counts are reused only by an explicit Resume,
    // an automatic retry, or a restart-resume, and only while still fresh.
    const domain = settings.target.domain;
    const prior = await loadCheckpoint();
    const reuse = mayResumeCheckpoint(run) && prior && prior.domain === domain && isFresh(prior) ? prior : null;
    const results = reuse?.results ?? {};
    const createdAt = reuse ? (reuse.createdAt ?? reuse.updatedAt) : new Date().toISOString();
    const resumed = Object.keys(results).length;
    if (resumed > 0) log(run, `Resuming: ${resumed} product pages were already read earlier and will be skipped.`);
    const saveResults = async (res: Record<string, number | null>) => {
      checkpointed = true;
      await saveCheckpoint({
        domain,
        createdAt,
        updatedAt: new Date().toISOString(),
        trigger: run.trigger,
        dryRun: run.dryRun,
        inProgress: true,
        results: res,
      });
    };
    await saveResults(results);

    // Read your store at the same time as the target scrape: the two are independent, and the
    // per-product "your qty / to update" view can fill in while the target is still being read.
    let yourStore: ConnectedVariant[] | null = null;
    const connected = fetchConnectedVariants(settings.connected, settings.match, locationId, (n) => {
      run.counters.connectedVariants = n;
    });
    connectedRead = connected;
    connected.then(
      ({ withVendorSku }) => {
        yourStore = withVendorSku;
        if (g.__targetItems) {
          annotateItems(g.__targetItems, withVendorSku, annotateOptions);
          bumpTarget();
        }
      },
      (err) => log(run, `Reading your store failed: ${err instanceof Error ? err.message : String(err)}`), // re-thrown when awaited below
    );

    run.phase = "Scraping target storefront";
    const scrape = await scrapeTargetInventory(
      settings.target.domain,
      (message, progress) => {
        run.phase = message;
        if (progress) run.progress = progress;
        bumpTarget();
      },
      (items) => {
        g.__targetItems = items;
        if (yourStore) annotateItems(items, yourStore, annotateOptions);
        bumpTarget();
      },
      { results, save: saveResults },
    );
    run.counters.targetVariants = scrape.variants.length;
    run.scrape = { soldOut: scrape.outOfStock, published: scrape.exposed, hidden: scrape.hidden };
    const { index, duplicates, conflicts } = buildTargetIndex(scrape.variants);
    log(
      run,
      `Target: ${scrape.variants.length} SKUs — ${scrape.outOfStock} out of stock (0), ${scrape.exposed} with a published count, ${scrape.hidden} in stock with a hidden number; ${duplicates} duplicate SKUs${conflicts.size ? ` (${conflicts.size} conflicting, skipped)` : ""}.`,
    );
    if (scrape.unreadable.length > 0) {
      log(run, `${scrape.unreadable.length} of ${scrape.pages} product pages could not be read; those products are skipped, not guessed.`);
      if (scrape.unreadable.length / Math.max(1, scrape.pages) > MAX_UNREADABLE_PERCENT / 100) {
        throw new Error(`Too many product pages failed to load (${scrape.unreadable.length} of ${scrape.pages}) — aborting, nothing changed`);
      }
    }
    if (scrape.outOfStock + scrape.exposed === 0) {
      throw new GuardError("Target exposes no exact quantities (no out-of-stock items or published counts) — aborting, nothing changed");
    }

    run.phase = "Finishing your store read";
    const { all, withVendorSku, stocked, units } = await connected;
    run.connected = { variants: all, withVendorSku: withVendorSku.length, stocked, units, location: stockLocation.name };
    if (g.__targetItems) {
      annotateItems(g.__targetItems, withVendorSku, annotateOptions);
      await saveTargetItems(g.__targetItems);
    }
    log(run, `Connected: ${all} variants, ${withVendorSku.length} carry a ${settings.match.namespace}.${settings.match.key} value.`);

    const skipReasons = new Map(conflicts);
    for (const sku of scrape.unreadable) skipReasons.set(normalizeSku(sku), "target page could not be read this run");
    if (await planAndWrite(run, settings, settings.connected, locationId, index, withVendorSku, skipReasons)) throw new CancelledError();

    run.status = run.counters.failed > 0 ? "partial" : "success";
    run.phase = "Done";
    await clearCheckpoint(); // finished: the next run starts from a fresh scrape
  } catch (err) {
    if (err instanceof CancelledError) {
      run.status = "cancelled";
      run.phase = "Stopped";
      log(run, "Stopped by user. Quantities already written stay as set; press Resume to continue the scrape from where it stopped, or Run now to start fresh.");
      const cp = await loadCheckpoint();
      if (cp) await saveCheckpoint({ ...cp, inProgress: false });
    } else {
      run.status = "failed";
      run.phase = "Failed";
      log(run, `Error: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof GuardError) {
        const cp = await loadCheckpoint();
        if (cp) await saveCheckpoint({ ...cp, inProgress: false });
      } else if (checkpointed) scheduleRetry(run);
    }
  } finally {
    // Let a background store read settle first, so it cannot bleed into the next run.
    if (connectedRead) await connectedRead.catch(() => undefined);
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
  }
}

/** What the last check learned about each target SKU, rebuilt from the saved list (no network). */
function indexFromSavedItems(items: TargetItem[]) {
  const variants = items.flatMap((i): TargetVariant[] => {
    if (i.state === "sold-out") return [{ sku: i.sku, quantity: 0 }];
    if (i.state === "exact" && i.quantity !== null) return [{ sku: i.sku, quantity: i.quantity }];
    if (i.state === "hidden") return [{ sku: i.sku, quantity: null }];
    return [];
  });
  const { index, conflicts } = buildTargetIndex(variants);
  const skipReasons = new Map(conflicts);
  for (const i of items) {
    if (i.state === "pending" || i.state === "unreadable") skipReasons.set(normalizeSku(i.sku), "target page was not read in the last check");
  }
  return { index, skipReasons };
}

/** Applies a finished check: reads your store for current quantities, then writes. The target is not scraped again. */
async function executeApply(run: RunRecord, check: RunRecord): Promise<void> {
  try {
    const settings = await loadSettings();
    if (!settings.target) throw new Error("Target store domain is not configured");
    if (!settings.connected) throw new Error("Connected store is not configured");
    if (check.targetDomain !== settings.target.domain) throw new Error("The target store changed since that check. Press Check only again.");
    run.targetDomain = settings.target.domain;
    const items = await loadTargetItems();
    if (items.length === 0) throw new Error("The saved check is empty. Press Check only again.");
    log(run, `Applying the check finished at ${check.finishedAt}. The target is not scraped again.`);

    const shop = await fetchShopInfo(settings.connected);
    const stockLocation = await pickStockLocation(settings.connected, shop.locations.filter((l) => l.active));
    run.phase = "Reading your store";
    const { all, withVendorSku, stocked, units } = await fetchConnectedVariants(settings.connected, settings.match, stockLocation.id, (n) => {
      run.counters.connectedVariants = n;
    });
    run.connected = { variants: all, withVendorSku: withVendorSku.length, stocked, units, location: stockLocation.name };
    run.scrape = check.scrape;
    run.counters.targetVariants = items.length;

    g.__targetItems = items;
    annotateItems(items, withVendorSku, { requireSingleVariant: settings.match.owner === "product" });
    bumpTarget();
    const { index, skipReasons } = indexFromSavedItems(items);
    const stopped = await planAndWrite(run, settings, settings.connected, stockLocation.id, index, withVendorSku, skipReasons);
    await saveTargetItems(items);
    if (stopped) throw new CancelledError();
    run.status = run.counters.failed > 0 ? "partial" : "success";
    run.phase = "Done";
  } catch (err) {
    if (err instanceof CancelledError) {
      run.status = "cancelled";
      run.phase = "Stopped";
      log(run, "Stopped by user. Quantities already written stay as set.");
    } else {
      run.status = "failed";
      run.phase = "Failed";
      log(run, `Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
  }
}
