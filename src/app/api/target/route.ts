import { errorResponse, fail } from "@/lib/api";
import { clearLastScrape, getTargetItems } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  return Response.json(await getTargetItems(since));
}

/** Forgets the last completed scrape. */
export async function DELETE() {
  try {
    await clearLastScrape();
    return Response.json({ ok: true });
  } catch (err) {
    return err instanceof Error && !("issues" in err) ? fail(err.message, 409) : errorResponse(err);
  }
}
