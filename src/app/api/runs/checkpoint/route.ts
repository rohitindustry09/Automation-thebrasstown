import { fail } from "@/lib/api";
import { clearCheckpoint } from "@/lib/storage";
import { getActiveRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** "Start over": forget the saved scrape progress so the next run reads every page again. */
export async function DELETE() {
  if (getActiveRun()) return fail("Stop the current run first", 409);
  await clearCheckpoint();
  return Response.json({ cleared: true });
}
