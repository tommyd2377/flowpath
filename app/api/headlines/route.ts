import { getVoiceHeadlines } from "@/lib/exploration-server";
import { headlineFeedErrorResponse } from "@/lib/atlas/server/feed";
import { AtlasApiError, errorResponse } from "@/lib/atlas/server/http";
import { localRequest } from "@/lib/local-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const headers = { "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", Pragma: "no-cache" };

export async function GET(request: Request) {
  if (!localRequest(request)) return Response.json({ error: "Use this app from localhost." }, { status: 403, headers });
  try {
    return Response.json(await getVoiceHeadlines(), { headers });
  } catch (error) {
    if (error instanceof AtlasApiError) return errorResponse(error);
    const result = headlineFeedErrorResponse(error);
    return Response.json(result.body, { status: result.status, headers });
  }
}
