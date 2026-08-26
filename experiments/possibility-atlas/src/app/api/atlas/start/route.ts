import { StartAtlasRequestSchema, type StartAtlasResponse } from "@/lib/contracts";
import { createFixtureStartResponse } from "@/lib/server/fixtures";
import {
  getRegisteredStartResponse,
  registerStartedGraph,
} from "@/lib/server/graph-registry";
import {
  errorResponse,
  jsonResponse,
  markResponseDeduplicated,
  parseJsonRequest,
} from "@/lib/server/http";
import {
  getAtlasModel,
  getAtlasResponsesAdapter,
  resolveAtlasServerMode,
} from "@/lib/server/openai-client";
import {
  atlasIdempotencyKey,
  runWithAtlasRequestGuard,
} from "@/lib/server/request-guard";
import { startAtlasWithOpenAI } from "@/lib/server/verify";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, StartAtlasRequestSchema);
    const mode = resolveAtlasServerMode();
    const replay = getRegisteredStartResponse(input);
    if (replay) return jsonResponse(replay, { mode });
    const guarded = await runWithAtlasRequestGuard<StartAtlasResponse>({
      installationId: input.installationId,
      key: atlasIdempotencyKey("atlas:start", input),
      graphId: input.graphId,
      consumesAtlasCall: mode === "live",
      operation: async () => {
        if (mode === "fixture") return createFixtureStartResponse(input);
        return startAtlasWithOpenAI(input, {
          adapter: getAtlasResponsesAdapter(),
          model: getAtlasModel(),
          signal: request.signal,
        });
      },
    });
    const body = guarded.deduplicated
      ? markResponseDeduplicated(guarded.value)
      : guarded.value;
    return jsonResponse(registerStartedGraph(input, body), { mode });
  } catch (error) {
    return errorResponse(error);
  }
}
