import { getTargetItems } from "@/lib/sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw !== null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  return Response.json(await getTargetItems(since));
}
