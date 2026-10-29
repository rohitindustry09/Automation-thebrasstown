import { z } from "zod";
import { errorResponse, fail } from "@/lib/api";
import { loadSettings } from "@/lib/storage";
import { getActiveRun, getCheckpointInfo, listRuns, startSync, summarizeRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET() {
  const runs = await listRuns();
  return Response.json({
    running: getActiveRun() !== null,
    runs: runs.map(summarizeRun),
    checkpoint: await getCheckpointInfo(),
  });
}

const body = z.object({ dryRun: z.boolean().default(false), resume: z.boolean().default(false) });

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
    const { dryRun, resume } = body.parse(parsed);
    const s = await loadSettings();
    if (!s.target?.domain) return fail("Save the target store domain first");
    if (!s.connected?.token) return fail("Save the connected store and its token first");
    if (getActiveRun()) return fail("A run is already in progress", 409);
    const run = await startSync({ trigger: "manual", dryRun, resume });
    return Response.json({ run }, { status: 202 });
  } catch (err) {
    return errorResponse(err);
  }
}
