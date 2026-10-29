import { fail } from "@/lib/api";
import { requestCancel } from "@/lib/cancel";
import { getActiveRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!getActiveRun()) return fail("No run is in progress", 409);
  requestCancel();
  return Response.json({ stopping: true });
}
