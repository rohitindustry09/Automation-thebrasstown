import { z } from "zod";
import { errorResponse, fail } from "@/lib/api";
import { loadSettings } from "@/lib/storage";
import { getActiveRun, getApplicableCheck, getCheckpointInfo, listRuns, startApplyLastCheck, startSync, summarizeRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listRuns();
  const check = getActiveRun() ? null : await getApplicableCheck();
  return Response.json({
    running: getActiveRun() !== null,
    runs: runs.map(summarizeRun),
    checkpoint: await getCheckpointInfo(),
    applicableCheck: check && { finishedAt: check.finishedAt, id: check.id, wouldUpdate: check.counters.updated + (check.prices?.updated ?? 0) },
  });
}

const body = z.object({ dryRun: z.boolean().default(false), resume: z.boolean().default(false), applyLast: z.string().optional() });

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let parsed: unknown = {};
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail("Request body is not valid JSON");
      }
    }
    const { dryRun, resume, applyLast } = body.parse(parsed);
    const s = await loadSettings();
    if (!s.target?.domain) return fail("Save the target store domain first");
    if (!s.connected?.token) return fail("Save the connected store and its token first");
    if (getActiveRun()) return fail("A run is already in progress", 409);
    if (applyLast) {
      const applied = await startApplyLastCheck(applyLast);
      return applied.status === "skipped" ? fail("A run is already in progress", 409) : Response.json({ run: applied }, { status: 202 });
    }
    const run = await startSync({ trigger: "manual", dryRun, resume });
    return Response.json({ run }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
