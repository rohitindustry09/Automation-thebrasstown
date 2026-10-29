import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type RunRecord, type Settings, type TargetItem } from "./types";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const MAX_RUNS = 20;
const MAX_FIRED = 300;

let chain: Promise<unknown> = Promise.resolve();
/** Serialises read-modify-write cycles so concurrent API calls can't clobber each other. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(/*turbopackIgnore: true*/ path.join(DATA_DIR, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(/*turbopackIgnore: true*/ DATA_DIR, { recursive: true, mode: 0o700 });
  const target = path.join(DATA_DIR, file);
  const tmp = `${target}.${process.pid}.tmp`;
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(/*turbopackIgnore: true*/ tmp, target);
}

export async function loadSettings(): Promise<Settings> {
  const saved = await readJson<Partial<Settings>>("settings.json", {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    match: { ...DEFAULT_SETTINGS.match, ...saved.match },
    fallback: { ...DEFAULT_SETTINGS.fallback, ...saved.fallback },
    schedule: { ...DEFAULT_SETTINGS.schedule, ...saved.schedule },
  };
}

export function updateSettings(fn: (current: Settings) => Settings): Promise<Settings> {
  return locked(async () => {
    const next = fn(await loadSettings());
    await writeJson("settings.json", next);
    return next;
  });
}

export const loadRuns = () => readJson<RunRecord[]>("runs.json", []);

export function saveRun(run: RunRecord): Promise<void> {
  return locked(async () => {
    const runs = await loadRuns();
    const without = runs.filter((r) => r.id !== run.id);
    await writeJson("runs.json", [run, ...without].slice(0, MAX_RUNS));
  });
}

export const loadTargetItems = () => readJson<TargetItem[]>("target-latest.json", []);
export const saveTargetItems = (items: TargetItem[]) => locked(() => writeJson("target-latest.json", items));

export interface Checkpoint {
  domain: string;
  updatedAt: string;
  trigger: "schedule" | "manual";
  dryRun: boolean;
  /** True while a run owns it; a restart or retry resumes only these automatically */
  inProgress: boolean;
  /** Product handle -> quantity found on its page (null = page checked, number hidden) */
  results: Record<string, number | null>;
}

export const loadCheckpoint = () => readJson<Checkpoint | null>("scrape-checkpoint.json", null);
export const saveCheckpoint = (cp: Checkpoint) => locked(() => writeJson("scrape-checkpoint.json", cp));
export const clearCheckpoint = () =>
  locked(async () => {
    await fs.rm(/*turbopackIgnore: true*/ path.join(DATA_DIR, "scrape-checkpoint.json"), { force: true });
  });

export const loadFiredSlots = async () => new Set(await readJson<string[]>("fired-slots.json", []));

export function markSlotFired(slot: string): Promise<void> {
  return locked(async () => {
    const fired = [...(await loadFiredSlots()), slot];
    await writeJson("fired-slots.json", fired.slice(-MAX_FIRED));
  });
}
