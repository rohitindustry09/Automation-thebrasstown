import { errorResponse, fail } from "@/lib/api";
import { startUpdateNow } from "@/lib/sync";

export const dynamic = "force-dynamic";

/** Writes the quantities in the Target products list to your store right now (no new scrape). */
export async function POST() {
  try {
    return Response.json({ run: await startUpdateNow() }, { status: 202 });
  } catch (err) {
    return err instanceof Error && !("issues" in err) ? fail(err.message, 409) : errorResponse(err);
  }
}
