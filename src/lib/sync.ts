import { randomUUID } from "node:crypto";
import { CancelledError, clearCancel } from "./cancel";
import { annotateItems } from "./decide";
import { fetchConnectedVariants, applyUpdates } from "./inventory-destination";
import type { ConnectedVariant } from "./plan";
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
import { emptyCounters, type RunRecord, type RunTrigger, type TargetItem } from "./types";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 60_000;
const CHECKPOINT_MAX_HOURS = Number(process.env.CHECKPOINT_MAX_HOURS ?? 12);
/** Products that change are always kept in full; informational rows are sampled to keep history small. */
const MAX_ACTION_ROWS = 10_000;
const MAX_INFO_ROWS = 300;
const MAX_LOG = 200;

const g = globalThis as unknown as { __activeRun?: RunRecord | null; __targetItems?: TargetItem[] };

export const getActiveRun = (): RunRecord | null => g.__activeRun ?? null;

/** Live list while a run is scraping, otherwise the last completed scrape. */
export async function getTargetItems(): Promise<{ items: TargetItem[]; live: boolean }> {
  if (getActiveRun() && g.__targetItems) return { items: g.__targetItems, live: true };
  return { items: await loadTargetItems(), live: false };
}

const isFresh = (cp: Checkpoint) => Date.now() - new Date(cp.updatedAt).getTime() < CHECKPOINT_MAX_HOURS * 3_600_000;

/** Summary of an unfinished scrape that the next run will continue from, if any. */
export async function getCheckpointInfo(): Promise<{ checked: number; updatedAt: string; inProgress: boolean } | null> {
  const cp = await loadCheckpoint();
  if (!cp || !isFresh(cp)) return null;
  return { checked: Object.keys(cp.results).length, updatedAt: cp.updatedAt, inProgress: cp.inProgress };
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

function newRun(trigger: RunTrigger, dryRun: boolean, slot?: string, attempt = 0): RunRecord {
  return {
    attempt,
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
}): Promise<RunRecord> {
  const { trigger, dryRun, slot, attempt } = opts;
  const run = newRun(trigger, dryRun, slot, attempt);

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
  g.__activeRun = run;
  void execute(run)
    .catch((err) => console.error("[sync] could not persist run:", err))
    .finally(() => {
      g.__activeRun = null;
    });
  return run;
}

async function execute(run: RunRecord): Promise<void> {
  let checkpointed = false;
  try {
    const settings = await loadSettings();
    if (!settings.target) throw new Error("Target store domain is not configured");
    if (!settings.connected) throw new Error("Connected store is not configured");
    // Shopify needs a location to set stock at; default to the store's first active one.
    const locationId =
      settings.locationId ?? (await fetchShopInfo(settings.connected)).locations.find((l) => l.active)?.id;
    if (!locationId) throw new Error("The connected store has no active location");

    log(run, `${run.dryRun ? "Dry run" : "Run"} started (${run.trigger})${run.attempt ? `, automatic retry ${run.attempt}` : ""}.`);

    const domain = settings.target.domain;
    const prior = await loadCheckpoint();
    const results = prior && prior.domain === domain && isFresh(prior) ? prior.results : {};
    const resumed = Object.keys(results).length;
    if (resumed > 0) log(run, `Resuming: ${resumed} product pages were already read earlier and will be skipped.`);
    const saveResults = async (res: Record<string, number | null>) => {
      checkpointed = true;
      await saveCheckpoint({
        domain,
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
    const connectedPromise = fetchConnectedVariants(settings.connected, settings.match, locationId, (n) => {
      run.counters.connectedVariants = n;
    });
    connectedPromise.then(
      ({ withVendorSku }) => {
        yourStore = withVendorSku;
        if (g.__targetItems) annotateItems(g.__targetItems, withVendorSku);
      },
      (err) => log(run, `Reading your store failed: ${err instanceof Error ? err.message : String(err)}`), // re-thrown when awaited below
    );

    run.phase = "Scraping target storefront";
    const scrape = await scrapeTargetInventory(
      settings.target.domain,
      (message, progress) => {
        run.phase = message;
        if (progress) run.progress = progress;
      },
      (items) => {
        g.__targetItems = items;
        if (yourStore) annotateItems(items, yourStore);
      },
      { results, save: saveResults },
    );
    run.counters.targetVariants = scrape.variants.length;
    run.scrape = { soldOut: scrape.outOfStock, published: scrape.exposed, hidden: scrape.hidden };
    const { index, duplicates } = buildTargetIndex(scrape.variants);
    log(
      run,
      `Target: ${scrape.variants.length} SKUs — ${scrape.outOfStock} out of stock (0), ${scrape.exposed} with a published count, ${scrape.hidden} in stock with a hidden number; ${duplicates} duplicate SKUs ignored.`,
    );
    if (scrape.outOfStock + scrape.exposed === 0) {
      throw new Error("Target exposes no exact quantities (no out-of-stock items or published counts) — aborting, nothing changed");
    }

    run.phase = "Finishing your store read";
    const { all, withVendorSku } = await connectedPromise;
    if (g.__targetItems) {
      annotateItems(g.__targetItems, withVendorSku);
      await saveTargetItems(g.__targetItems);
    }
    log(run, `Connected: ${all} variants, ${withVendorSku.length} carry a ${settings.match.namespace}.${settings.match.key} value.`);

    const plan = planUpdates(index, withVendorSku, { requireSingleVariant: settings.match.owner === "product",
      fallback: settings.fallback.enabled ? settings.fallback : null,
    });
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
      run.phase = `Updating ${plan.updates.length} quantities`;
      const results = await applyUpdates(settings.connected, locationId, plan.updates, () => undefined);
      const failures = results.filter((r) => r.error);
      const failedBySku = new Map(failures.map((r) => [r.update.sku, r.error as string]));
      for (const c of run.changes) {
        const error = c.status === "updated" ? failedBySku.get(c.sku) : undefined;
        if (error) Object.assign(c, { status: "failed", note: error });
      }
      const failed = failures.length;
      run.counters.updated = plan.updates.length - failed;
      run.counters.failed = failed;
      if (failed > 0) {
        const sample = failures.slice(0, 5).map((r) => r.error);
        log(run, `${failed} updates failed, e.g. ${sample.join(" | ")}`);
      }
      log(run, `Updated ${run.counters.updated} quantities.`);
    }

    run.status = run.counters.failed > 0 ? "partial" : "success";
    run.phase = "Done";
    await clearCheckpoint(); // finished: the next run starts from a fresh scrape
  } catch (err) {
    if (err instanceof CancelledError) {
      run.status = "cancelled";
      run.phase = "Stopped";
      log(run, "Stopped by user. Quantities already written stay as set; the next run resumes the scrape from where it stopped.");
      const cp = await loadCheckpoint();
      if (cp) await saveCheckpoint({ ...cp, inProgress: false });
    } else {
      run.status = "failed";
      run.phase = "Failed";
      log(run, `Error: ${err instanceof Error ? err.message : String(err)}`);
      if (checkpointed) scheduleRetry(run);
    }
  } finally {
    run.finishedAt = new Date().toISOString();
    await saveRun(run);
  }
}
