import { fail } from "@/lib/api";
import { getRun } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** One run with its full change list and log (the list endpoint leaves these out). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  return run ? Response.json({ run }) : fail("Run not found", 404);
}
