import { ExpandAtlasRequestSchema, type ExpandAtlasResponse } from "@/lib/contracts";
import {
  createExpansionGenerationTemplateWithOpenAI,
  validateExpansionContext,
} from "@/lib/server/branch";
import { validatePersistedCausalContext } from "@/lib/server/causal-context";
import { createFixtureExpansionResponse } from "@/lib/server/fixtures";
import {
  EXPANSION_PROMPT_VERSION,
  ExpansionGenerationTemplateSchema,
  generationCacheKey,
  generationFingerprint,
  materializeExpansionTemplate,
  semanticExpansionSource,
} from "@/lib/server/generation-templates";
import {
  commitRegisteredExpansion,
  getRegisteredExpansionResponse,
  validateRegisteredExpansion,
} from "@/lib/server/graph-registry";
import {
  AtlasApiError,
  errorResponse,
  jsonResponse,
  parseJsonRequest,
} from "@/lib/server/http";
import {
  getAtlasResponsesAdapter,
  resolveAtlasServerMode,
} from "@/lib/server/openai-client";
import { runAtlasModelOperation } from "@/lib/server/atlas-model-operation";
import { getOptionalRawAtlasCallLedger } from "@/lib/server/optional-call-ledger";
import { atlasIdempotencyKey } from "@/lib/server/request-guard";
import {
  getRawGenerationTemplate,
  putRawGenerationTemplate,
} from "@/lib/server/raw-generation-cache";
import { getWorldRepository } from "@/lib/server/world-db";

export const runtime = "nodejs";

function persistenceError(error: unknown) {
  return new AtlasApiError({
    code: "analysis_persistence_failed",
    message: "The completed expansion could not be cached safely.",
    status: 500,
    retryable: true,
    callConsumed: true,
    cause: error,
  });
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, ExpandAtlasRequestSchema);
    const expansion = validateExpansionContext(input);
    const mode = resolveAtlasServerMode();
    const requestKey = atlasIdempotencyKey("atlas:expand", input);
    const replay = getRegisteredExpansionResponse(input, requestKey);
    if (replay) return jsonResponse(replay, { mode });
    const registered = validateRegisteredExpansion(input);
    const repository = registered.worldEventId ? getWorldRepository() : null;
    if (repository) await repository.initialize();
    if (input.causalContext && !repository) {
      throw new AtlasApiError({
        code: "causal_context_stale",
        message:
          "A conditional chain can only continue inside a registered world atlas.",
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }
    const causalContext = input.causalContext
      ? await validatePersistedCausalContext({
          context: input.causalContext,
          targetWorldEventId: registered.worldEventId,
          repository: repository!,
        })
      : undefined;

    if (mode === "fixture") {
      const response = createFixtureExpansionResponse(input);
      return jsonResponse(
        commitRegisteredExpansion(input, requestKey, response),
        { mode },
      );
    }

    const source = semanticExpansionSource({
      snapshot: input.snapshot,
      lineage: input.lineage,
      maxBranches: expansion.maxBranches,
      causalContext,
    });
    const sourceFingerprint = generationFingerprint(source);
    const cacheKey = generationCacheKey({
      kind: "expand",
      model: registered.model,
      promptVersion: EXPANSION_PROMPT_VERSION,
      source,
    });
    const cached = repository
      ? await repository.getGenerationTemplate(
          cacheKey,
          ExpansionGenerationTemplateSchema,
        )
      : await getRawGenerationTemplate(
          cacheKey,
          ExpansionGenerationTemplateSchema,
        );

    let response: ExpandAtlasResponse;
    if (cached) {
      response = materializeExpansionTemplate(
        cached.payload,
        {
          parentId: input.parentId,
          nextDepth: expansion.nextDepth,
          maxBranches: expansion.maxBranches,
        },
        { mode, callConsumed: false, cacheStatus: "hit" },
      );
    } else {
      const guarded = await runAtlasModelOperation({
        installationId: input.installationId,
        key: cacheKey,
        graphId: input.graphId,
        resolveCallLedger: repository
          ? async () => repository
          : getOptionalRawAtlasCallLedger,
        operation: async () => {
          const template =
            await createExpansionGenerationTemplateWithOpenAI(input, {
              adapter: getAtlasResponsesAdapter(),
              model: registered.model,
              signal: request.signal,
            });
          const createdAt = new Date().toISOString();
          const record = {
            key: cacheKey,
            kind: "expand" as const,
            model: registered.model,
            promptVersion: EXPANSION_PROMPT_VERSION,
            sourceFingerprint,
            payload: template,
            createdAt,
          };
          let stored;
          try {
            stored = repository
              ? await repository.putGenerationTemplate(
                  record,
                  ExpansionGenerationTemplateSchema,
                )
              : await putRawGenerationTemplate(
                  record,
                  ExpansionGenerationTemplateSchema,
                );
          } catch (error) {
            throw persistenceError(error);
          }
          return { ...stored, meta: { callConsumed: true } };
        },
      });
      response = materializeExpansionTemplate(
        guarded.value.payload,
        {
          parentId: input.parentId,
          nextDepth: expansion.nextDepth,
          maxBranches: expansion.maxBranches,
        },
        {
          mode,
          callConsumed: !guarded.deduplicated,
          cacheStatus: guarded.deduplicated ? "hit" : "miss",
        },
      );
    }

    return jsonResponse(
      commitRegisteredExpansion(input, requestKey, response),
      { mode },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
