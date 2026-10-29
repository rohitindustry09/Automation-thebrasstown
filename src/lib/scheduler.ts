import { dueSlots } from "./schedule";
import { loadFiredSlots, loadSettings, markSlotFired } from "./storage";
import { getActiveRun, resumeAfterRestart, startSync } from "./sync";

const TICK_MS = 15_000;
const g = globalThis as unknown as { __schedulerTimer?: NodeJS.Timeout };

async function tick() {
  try {
    // A run in progress: leave slots unmarked so the grace window retries them.
    if (getActiveRun()) return;
    const settings = await loadSettings();
    const fired = await loadFiredSlots();
    for (const slot of dueSlots(settings.schedule, new Date(), fired)) {
      if (getActiveRun()) return; // a manual run began meanwhile: keep the slot unmarked so it retries
      await markSlotFired(slot);
      await startSync({ trigger: "schedule", dryRun: false, slot });
      break; // one run per tick; remaining due slots are picked up next tick
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  }
}

/** Idempotent: safe to call again after hot reloads. */
export function startScheduler() {
  if (g.__schedulerTimer) return;
  g.__schedulerTimer = setInterval(() => void tick(), TICK_MS);
  g.__schedulerTimer.unref();
  setTimeout(() => void resumeAfterRestart().catch((err) => console.error("[sync] resume failed:", err)), 5000);
  console.info("[scheduler] started");
}
