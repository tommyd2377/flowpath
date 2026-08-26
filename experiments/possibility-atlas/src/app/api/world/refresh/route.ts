import { WorldRefreshRequestSchema } from "@/lib/world-contracts";
import {
  headlineFeedErrorResponse,
  HeadlineFeedError,
  headlineFeedService,
} from "@/lib/server/feed";
import { getWorldRepository } from "@/lib/server/world-db";
import { errorResponse, jsonResponse, parseJsonRequest } from "@/lib/server/http";
import {
  getAtlasResponsesAdapter,
  resolveAtlasServerMode,
} from "@/lib/server/openai-client";
import { refreshWorldCatalog } from "@/lib/server/world-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, WorldRefreshRequestSchema);
    const mode = resolveAtlasServerMode();
    const body = await refreshWorldCatalog({
      installationId: input.installationId,
      mode,
      repository: getWorldRepository(),
      adapter: mode === "live" ? getAtlasResponsesAdapter() : undefined,
      getHeadlines:
        mode === "live"
          ? () => headlineFeedService.getHeadlines()
          : undefined,
      signal: request.signal,
    });
    return jsonResponse(body, { mode });
  } catch (error) {
    if (error instanceof HeadlineFeedError) {
      const response = headlineFeedErrorResponse(error);
      return jsonResponse(response.body, { status: response.status });
    }
    return errorResponse(error);
  }
}
