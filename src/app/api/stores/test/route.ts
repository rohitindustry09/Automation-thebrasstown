import { z } from "zod";
import { errorResponse, fail } from "@/lib/api";
import { fetchShopInfo, normalizeDomain } from "@/lib/shopify";
import { loadSettings } from "@/lib/storage";

export const dynamic = "force-dynamic";

const body = z.object({
  domain: z.string().min(1).max(255),
  token: z.string().max(512).optional(),
});

/** Verifies the connected store's credentials (typed, or saved for the same domain) and lists locations. */
export async function POST(request: Request) {
  try {
    const input = body.parse(await request.json());
    const domain = normalizeDomain(input.domain);
    if (!domain) return fail("Enter a domain like your-store.myshopify.com");
    const saved = (await loadSettings()).connected;
    const token = input.token?.trim() || (saved?.domain === domain ? saved.token : "");
    if (!token) return fail("Enter the Admin API access token");
    return Response.json(await fetchShopInfo({ domain, token }));
  } catch (err) {
    return errorResponse(err);
  }
}
