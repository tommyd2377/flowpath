import { ExpandAtlasRequestSchema, type ExpandAtlasResponse } from "@/lib/contracts";
import {
  expandAtlasWithOpenAI,
  validateExpansionContext,
} from "@/lib/server/branch";
import { createFixtureExpansionResponse } from "@/lib/server/fixtures";
import {
  commitRegisteredExpansion,
  getRegisteredExpansionResponse,
  validateRegisteredExpansion,
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

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, ExpandAtlasRequestSchema);
    validateExpansionContext(input);
    const mode = resolveAtlasServerMode();
    const requestKey = atlasIdempotencyKey("atlas:expand", input);
    const replay = getRegisteredExpansionResponse(input, requestKey);
    if (replay) return jsonResponse(replay, { mode });
    validateRegisteredExpansion(input);
    const guarded = await runWithAtlasRequestGuard<ExpandAtlasResponse>({
      installationId: input.installationId,
      key: requestKey,
      graphId: input.graphId,
      consumesAtlasCall: mode === "live",
      operation: async () => {
        const response =
          mode === "fixture"
            ? createFixtureExpansionResponse(input)
            : await expandAtlasWithOpenAI(input, {
                adapter: getAtlasResponsesAdapter(),
                model: getAtlasModel(),
                signal: request.signal,
              });
        return commitRegisteredExpansion(input, requestKey, response);
      },
    });
    const body = guarded.deduplicated
      ? markResponseDeduplicated(guarded.value)
      : guarded.value;
    return jsonResponse(body, { mode });
  } catch (error) {
    return errorResponse(error);
  }
}
