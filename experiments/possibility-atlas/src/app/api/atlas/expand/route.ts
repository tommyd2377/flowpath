import { ExpandAtlasRequestSchema, type ExpandAtlasResponse } from "@/lib/contracts";
import { z } from "zod";
import {
  createExpansionGenerationTemplateWithOpenAI,
  validateExpansionContext,
} from "@/lib/server/branch";
import { createFixtureExpansionResponse } from "@/lib/server/fixtures";
import {
  EXPANSION_PROMPT_VERSION,
  ExpansionGenerationTemplateSchema,
  generationCacheKey,
  generationFingerprint,
  materializeExpansionTemplate,
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
import {
  atlasIdempotencyKey,
  runWithAtlasRequestGuard,
} from "@/lib/server/request-guard";
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

function semanticExpansionSource(input: {
  snapshot: z.infer<typeof ExpandAtlasRequestSchema>["snapshot"];
  lineage: z.infer<typeof ExpandAtlasRequestSchema>["lineage"];
  maxBranches: number;
}) {
  return {
    snapshot: {
      headline: input.snapshot.headline,
      capturedAt: input.snapshot.capturedAt,
      verificationStatus: input.snapshot.verificationStatus,
      summary: input.snapshot.summary,
      facts: input.snapshot.facts,
      uncertainties: input.snapshot.uncertainties,
      sources: input.snapshot.sources,
    },
    lineage: input.lineage.map((node) => ({
      depth: node.depth,
      title: node.title,
      summary: node.summary,
      whyPlausible: node.whyPlausible,
      keyAssumption: node.keyAssumption,
      horizon: node.horizon,
    })),
    maxBranches: input.maxBranches,
  };
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

    if (mode === "fixture") {
      const response = createFixtureExpansionResponse(input);
      return jsonResponse(
        commitRegisteredExpansion(input, requestKey, response),
        { mode },
      );
    }

    const repository = registered.worldEventId ? getWorldRepository() : null;
    if (repository) await repository.initialize();
    const source = semanticExpansionSource({
      snapshot: input.snapshot,
      lineage: input.lineage,
      maxBranches: expansion.maxBranches,
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
      const guarded = await runWithAtlasRequestGuard({
        installationId: input.installationId,
        key: cacheKey,
        graphId: input.graphId,
        consumesAtlasCall: true,
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
