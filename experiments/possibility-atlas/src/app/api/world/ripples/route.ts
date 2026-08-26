import {
  createFixtureRippleTemplate,
} from "@/lib/server/fixtures";
import {
  generationCacheKey,
  generationFingerprint,
  RIPPLE_PROMPT_VERSION,
  RippleGenerationTemplateSchema,
} from "@/lib/server/generation-templates";
import { validateRegisteredRippleContext } from "@/lib/server/graph-registry";
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
  createRippleGenerationTemplateWithOpenAI,
  loadSavedRippleAnalysis,
  materializeRippleTemplate,
  responseFromStoredRippleEdges,
} from "@/lib/server/ripple";
import { runWithAtlasRequestGuard } from "@/lib/server/request-guard";
import { getWorldRepository } from "@/lib/server/world-db";
import {
  RippleAnalysisResponseSchema,
  RippleQuerySchema,
  RippleRequestSchema,
  type RippleAnalysisResponse,
  type RippleRequest,
} from "@/lib/world-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function persistenceError(error: unknown, callConsumed: boolean) {
  return new AtlasApiError({
    code: "analysis_persistence_failed",
    message: "The completed ripple analysis could not be saved safely.",
    status: 500,
    retryable: true,
    callConsumed,
    cause: error,
  });
}

function readMode() {
  return process.env.POSSIBILITY_ATLAS_FIXTURE_MODE === "1"
    ? ("fixture" as const)
    : ("live" as const);
}

function parseRippleQuery(request: Request): RippleRequest {
  const url = new URL(request.url);
  const parsed = RippleQuerySchema.safeParse({
    installationId: url.searchParams.get("installationId"),
    graphId: url.searchParams.get("graphId"),
    worldEventId: url.searchParams.get("worldEventId"),
    scenarioNodeId: url.searchParams.get("scenarioNodeId"),
  });
  if (!parsed.success) {
    throw new AtlasApiError({
      code: "invalid_request",
      message: "The ripple query does not match the expected shape.",
      status: 400,
      retryable: false,
      callConsumed: false,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function rippleCacheSource(input: {
  sourceEventId: string;
  snapshot: ReturnType<typeof validateRegisteredRippleContext>["snapshot"];
  scenario: ReturnType<typeof validateRegisteredRippleContext>["scenario"];
  catalogVersion: number;
}) {
  return {
    sourceEventId: input.sourceEventId,
    snapshot: {
      headline: input.snapshot.headline,
      capturedAt: input.snapshot.capturedAt,
      verificationStatus: input.snapshot.verificationStatus,
      summary: input.snapshot.summary,
      facts: input.snapshot.facts,
      uncertainties: input.snapshot.uncertainties,
      sources: input.snapshot.sources,
    },
    scenario: {
      title: input.scenario.title,
      summary: input.scenario.summary,
      whyPlausible: input.scenario.whyPlausible,
      keyAssumption: input.scenario.keyAssumption,
      watchFor: input.scenario.watchFor,
      lessLikelyIf: input.scenario.lessLikelyIf,
      horizon: input.scenario.horizon,
    },
    catalogVersion: input.catalogVersion,
  };
}

async function targetEventsForIds(ids: string[]) {
  const repository = getWorldRepository();
  const events = await Promise.all(ids.map((id) => repository.getWorldEvent(id)));
  if (events.some((event) => !event)) {
    throw new AtlasApiError({
      code: "ripple_target_unavailable",
      message: "A saved ripple target is no longer available.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }
  return events.filter((event): event is NonNullable<typeof event> => Boolean(event));
}

export async function GET(request: Request) {
  try {
    const input = parseRippleQuery(request);
    validateRegisteredRippleContext(input);
    const repository = getWorldRepository();
    await repository.initialize();
    const mode = readMode();
    return jsonResponse(
      await loadSavedRippleAnalysis({ repository, request: input, mode }),
      { mode },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await parseJsonRequest(request, RippleRequestSchema);
    const mode = resolveAtlasServerMode();
    const context = validateRegisteredRippleContext(input);
    const repository = getWorldRepository();
    await repository.initialize();
    const sourceEvent = await repository.getWorldEvent(input.worldEventId);
    if (!sourceEvent || sourceEvent.state !== "verified") {
      throw new AtlasApiError({
        code: "event_not_verified",
        message: "This world event must be verified before analyzing its effects.",
        status: 409,
        retryable: false,
        callConsumed: false,
      });
    }

    const metadata = await repository.getCatalogMetadata();
    const existing = await repository.getRippleAnalysis({
      graphId: input.graphId,
      scenarioNodeId: input.scenarioNodeId,
      catalogVersion: metadata.catalogVersion,
    });
    if (existing !== null) {
      const targetEvents = await targetEventsForIds(
        existing.map((edge) => edge.targetEventId),
      );
      return jsonResponse(
        responseFromStoredRippleEdges({ edges: existing, targetEvents, mode }),
        { mode },
      );
    }

    const targetEvents = await repository.listEligibleTargetEvents(
      input.worldEventId,
    );
    const source = rippleCacheSource({
      sourceEventId: input.worldEventId,
      snapshot: context.snapshot,
      scenario: context.scenario,
      catalogVersion: metadata.catalogVersion,
    });
    const sourceFingerprint = generationFingerprint(source);
    const cacheKey = generationCacheKey({
      kind: "ripple",
      model: context.model,
      promptVersion: RIPPLE_PROMPT_VERSION,
      source,
    });

    let response: RippleAnalysisResponse;
    if (mode === "fixture") {
      response = materializeRippleTemplate(
        createFixtureRippleTemplate(targetEvents),
        {
          sourceEventId: input.worldEventId,
          sourceScenarioNodeId: input.scenarioNodeId,
          targetEvents,
        },
        { mode, callConsumed: false, cacheStatus: "miss" },
      );
    } else {
      const cached = await repository.getGenerationTemplate(
        cacheKey,
        RippleGenerationTemplateSchema,
      );
      if (cached) {
        response = materializeRippleTemplate(
          cached.payload,
          {
            sourceEventId: input.worldEventId,
            sourceScenarioNodeId: input.scenarioNodeId,
            targetEvents,
          },
          { mode, callConsumed: false, cacheStatus: "hit" },
        );
      } else if (targetEvents.length === 0) {
        response = materializeRippleTemplate(
          {
            kind: "no_credible_links",
            reason: "No other eligible active events are available for comparison.",
          },
          {
            sourceEventId: input.worldEventId,
            sourceScenarioNodeId: input.scenarioNodeId,
            targetEvents,
          },
          { mode, callConsumed: false, cacheStatus: "miss" },
        );
      } else {
        const guarded = await runWithAtlasRequestGuard({
          installationId: input.installationId,
          key: cacheKey,
          graphId: input.graphId,
          consumesAtlasCall: true,
          operation: async () => {
            const template = await createRippleGenerationTemplateWithOpenAI(
              { input, ...context, targetEvents },
              {
                adapter: getAtlasResponsesAdapter(),
                model: context.model,
                signal: request.signal,
              },
            );
            const createdAt = new Date().toISOString();
            let stored;
            try {
              stored = await repository.putGenerationTemplate(
                {
                  key: cacheKey,
                  kind: "ripple",
                  model: context.model,
                  promptVersion: RIPPLE_PROMPT_VERSION,
                  sourceFingerprint,
                  payload: template,
                  createdAt,
                },
                RippleGenerationTemplateSchema,
              );
            } catch (error) {
              throw persistenceError(error, true);
            }
            return { ...stored, meta: { callConsumed: true } };
          },
        });
        response = materializeRippleTemplate(
          guarded.value.payload,
          {
            sourceEventId: input.worldEventId,
            sourceScenarioNodeId: input.scenarioNodeId,
            targetEvents,
          },
          {
            mode,
            callConsumed: !guarded.deduplicated,
            cacheStatus: guarded.deduplicated ? "hit" : "miss",
          },
        );
      }
    }

    const edges = response.kind === "ripples" ? response.edges : [];
    const analyzedAt = edges[0]?.analyzedAt ?? new Date().toISOString();
    let committed;
    try {
      committed = await repository.commitRippleAnalysis({
        graphId: input.graphId,
        scenarioNodeId: input.scenarioNodeId,
        sourceEventId: input.worldEventId,
        edges,
        analyzedAt,
        catalogVersion: metadata.catalogVersion,
      });
    } catch (error) {
      throw persistenceError(error, response.meta.callConsumed);
    }
    if (response.kind === "ripples" && committed !== edges) {
      response = RippleAnalysisResponseSchema.parse({
        ...response,
        edges: committed,
        targetEvents: await targetEventsForIds(
          committed.map((edge) => edge.targetEventId),
        ),
      });
    }
    return jsonResponse(response, { mode });
  } catch (error) {
    return errorResponse(error);
  }
}
