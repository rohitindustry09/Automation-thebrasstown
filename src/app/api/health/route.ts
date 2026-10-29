export const dynamic = "force-dynamic";

/** Cheap liveness check for keep-alive pings and uptime monitors. Exposes nothing sensitive. */
export async function GET() {
  return Response.json({ ok: true, time: new Date().toISOString() });
}
