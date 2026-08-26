import { StartAtlasRequestSchema, type StartAtlasResponse } from "@/lib/contracts";
import { createFixtureStartResponse } from "@/lib/server/fixtures";
import {
  generationCacheKey,
  generationFingerprint,
  materializeStartTemplate,
  START_PROMPT_VERSION,
  StartGenerationTemplateSchema,
} from "@/lib/server/generation-templates";
import {
  getRegisteredStartResponse,
  registerStartedGraph,
} from "@/lib/server/graph-registry";
import {
  AtlasApiError,
  errorResponse,
  jsonResponse,
  parseJsonRequest,
} from "@/lib/server/http";
import {
  getAtlasModel,
  getAtlasResponsesAdapter,
  getWorldAtlasModel,
  resolveAtlasServerMode,
} from "@/lib/server/openai-client";
import { runWithAtlasRequestGuard } from "@/lib/server/request-guard";
import {
  getRawGenerationTemplate,
  putRawGenerationTemplate,
} from "@/lib/server/raw-generation-cache";
import { createStartGenerationTemplateWithOpenAI } from "@/lib/server/verify";
import { getWorldRepository } from "@/lib/server/world-db";

export const runtime = "nodejs";

function persistenceError(error: unknown, callConsumed: boolean) {
  return new AtlasApiError({
    code: "analysis_persistence_failed",
    message: "The completed analysis could not be saved safely.",
    status: 500,
    retryable: true,
    callConsumed,
    cause: error,
  });
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, StartAtlasRequestSchema);
    const mode = resolveAtlasServerMode();
    const replay = getRegisteredStartResponse(input);
    if (replay) return jsonResponse(replay, { mode });

    const repository = input.worldEventId ? getWorldRepository() : null;
    if (repository) await repository.initialize();
    const worldEvent =
      input.worldEventId && repository
        ? await repository.getWorldEvent(input.worldEventId)
        : null;
    if (input.worldEventId) {
      if (!worldEvent || worldEvent.state === "inactive") {
        throw new AtlasApiError({
          code: "world_event_unavailable",
          message: "This world event is no longer available for exploration.",
          status: 404,
          retryable: false,
          callConsumed: false,
        });
      }
      if (
        generationFingerprint(worldEvent.leadHeadline) !==
        generationFingerprint(input.headline)
      ) {
        throw new AtlasApiError({
          code: "world_event_headline_mismatch",
          message: "The selected headline does not match this world event.",
          status: 400,
          retryable: false,
          callConsumed: false,
        });
      }
    }

    const model = worldEvent ? getWorldAtlasModel() : getAtlasModel();
    if (mode === "fixture") {
      const response = createFixtureStartResponse(input);
      const registered = registerStartedGraph(input, response, { model });
      if (repository && worldEvent && registered.kind === "atlas") {
        try {
          await repository.markEventVerified(worldEvent.id, registered.snapshot);
        } catch (error) {
          throw persistenceError(error, false);
        }
      }
      return jsonResponse(registered, { mode });
    }

    const source = worldEvent
      ? { worldEventId: worldEvent.id, revision: worldEvent.revision }
      : input.headline;
    const sourceFingerprint = generationFingerprint(source);
    const cacheKey = generationCacheKey({
      kind: "start",
      model,
      promptVersion: START_PROMPT_VERSION,
      source,
    });
    const cached = repository
      ? await repository.getGenerationTemplate(
          cacheKey,
          StartGenerationTemplateSchema,
        )
      : await getRawGenerationTemplate(cacheKey, StartGenerationTemplateSchema);

    let response: StartAtlasResponse;
    if (cached) {
      response = materializeStartTemplate(cached.payload, input, {
        mode,
        callConsumed: false,
        cacheStatus: "hit",
        capturedAt: cached.createdAt,
      });
    } else {
      const guarded = await runWithAtlasRequestGuard({
        installationId: input.installationId,
        key: cacheKey,
        graphId: input.graphId,
        consumesAtlasCall: true,
        operation: async () => {
          const template = await createStartGenerationTemplateWithOpenAI(input, {
            adapter: getAtlasResponsesAdapter(),
            model,
            signal: request.signal,
          });
          const createdAt = new Date().toISOString();
          const record = {
            key: cacheKey,
            kind: "start" as const,
            model,
            promptVersion: START_PROMPT_VERSION,
            sourceFingerprint,
            payload: template,
            createdAt,
          };
          let stored;
          try {
            stored = repository
              ? await repository.putGenerationTemplate(
                  record,
                  StartGenerationTemplateSchema,
                )
              : await putRawGenerationTemplate(
                  record,
                  StartGenerationTemplateSchema,
                );
          } catch (error) {
            throw persistenceError(error, true);
          }
          return { ...stored, meta: { callConsumed: true } };
        },
      });
      response = materializeStartTemplate(guarded.value.payload, input, {
        mode,
        callConsumed: !guarded.deduplicated,
        cacheStatus: guarded.deduplicated ? "hit" : "miss",
        capturedAt: guarded.value.createdAt,
      });
    }

    if (repository && worldEvent && response.kind === "atlas") {
      try {
        await repository.markEventVerified(worldEvent.id, response.snapshot);
      } catch (error) {
        throw persistenceError(error, response.meta.callConsumed);
      }
    }
    return jsonResponse(registerStartedGraph(input, response, { model }), {
      mode,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
