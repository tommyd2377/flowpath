import { localRequest } from "@/lib/local-request";
import { getVoiceStories } from "@/lib/story-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", Pragma: "no-cache" };

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Use this app from localhost." }, { status: 403, headers });
  try {
    return Response.json(await getVoiceStories(request.signal), { headers });
  } catch {
    return Response.json({ error: "The story catalog is temporarily unavailable." }, { status: 503, headers });
  }
}
