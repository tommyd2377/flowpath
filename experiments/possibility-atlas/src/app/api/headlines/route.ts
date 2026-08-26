import {
  headlineFeedErrorResponse,
  headlineFeedService,
} from "@/lib/server/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export async function GET() {
  try {
    const body = await headlineFeedService.getHeadlines();
    return Response.json(body, { headers: RESPONSE_HEADERS });
  } catch (error) {
    const { body, status } = headlineFeedErrorResponse(error);
    return Response.json(body, {
      status,
      headers: RESPONSE_HEADERS,
    });
  }
}
