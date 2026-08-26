import { randomUUID } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { EventSnapshot, PossibilityNode } from "../contracts";
import {
  RippleAnalysisResponseSchema,
  RippleEdgeSchema,
  RippleRequestSchema,
  type RippleAnalysisResponse,
  type RippleEdge,
  type RippleRequest,
  type WorldEventSummary,
} from "../world-contracts";
import {
  RippleGenerationTemplateSchema,
  type RippleGenerationTemplate,
} from "./generation-templates";
import { AtlasApiError } from "./http";
import {
  RippleModelOutputSchema,
  type RippleModelOutput,
} from "./model-contracts";
import type {
  AtlasParsedResponse,
  AtlasResponsesAdapter,
  AtlasResponsesRequest,
} from "./openai-client";
import { extractResponseEvidence } from "./provenance";
import {
  buildRippleAnalysisInput,
  RIPPLE_ANALYSIS_SYSTEM_PROMPT,
} from "./prompts";
import { atlasSafetyIdentifier } from "./request-guard";
import type { WorldRepository } from "./world-repository";

const RIPPLE_MAX_OUTPUT_TOKENS = 3_000;
const RIPPLE_TIMEOUT_MS = 40_000;

export type RippleAnalysisContext = {
  input: RippleRequest;
  snapshot: EventSnapshot;
  scenario: PossibilityNode;
  targetEvents: WorldEventSummary[];
};

export type RippleOpenAIOptions = {
  adapter: AtlasResponsesAdapter;
  model: string;
  signal?: AbortSignal | null;
};

function modelCallError(error: unknown) {
  if (error instanceof AtlasApiError) return error;
  return new AtlasApiError({
    code: "analysis_unavailable",
    message: "The analysis service did not complete this ripple analysis.",
    status: 502,
    retryable: true,
    callConsumed: true,
    cause: error,
  });
}

function assertCompleted(response: AtlasParsedResponse<unknown>) {
  const evidence = extractResponseEvidence(response.output);
  if (evidence.refusal) {
    throw new AtlasApiError({
      code: "model_refusal",
      message: "The analysis service declined this ripple analysis.",
      status: 422,
      retryable: false,
      callConsumed: true,
    });
  }
  if (
    response.status !== "completed" ||
    response.incomplete_details ||
    response.error
  ) {
    throw new AtlasApiError({
      code: "model_incomplete",
      message: "The analysis service returned an incomplete ripple analysis.",
      status: 502,
      retryable: true,
      callConsumed: true,
    });
  }
}

export async function createRippleGenerationTemplateWithOpenAI(
  rawContext: RippleAnalysisContext,
  options: RippleOpenAIOptions,
): Promise<RippleGenerationTemplate> {
  const input = RippleRequestSchema.parse(rawContext.input);
  if (rawContext.scenario.depth !== 1) {
    throw new AtlasApiError({
      code: "invalid_ripple_scenario",
      message: "World reactions can only be analyzed from a primary scenario.",
      status: 400,
      retryable: false,
      callConsumed: false,
    });
  }
  const targetIds = new Set<string>();
  for (const target of rawContext.targetEvents) {
    if (target.id === input.worldEventId || targetIds.has(target.id)) {
      throw new AtlasApiError({
        code: "invalid_ripple_targets",
        message: "The eligible ripple targets are invalid.",
        status: 500,
        retryable: false,
        callConsumed: false,
      });
    }
    targetIds.add(target.id);
  }
  if (targetIds.size === 0) {
    return RippleGenerationTemplateSchema.parse({
      kind: "no_credible_links",
      reason: "No other eligible active events are available for comparison.",
    });
  }

  const request: AtlasResponsesRequest = {
    model: options.model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: RIPPLE_MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: RIPPLE_ANALYSIS_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildRippleAnalysisInput({
          snapshot: rawContext.snapshot,
          scenario: rawContext.scenario,
          targetEvents: rawContext.targetEvents,
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        RippleModelOutputSchema,
        "possibility_atlas_ripple_analysis",
      ),
      verbosity: "low",
    },
    safety_identifier: atlasSafetyIdentifier(input.installationId),
  };

  let response: AtlasParsedResponse<RippleModelOutput>;
  try {
    response = await options.adapter.parse<RippleModelOutput>(request, {
      timeout: RIPPLE_TIMEOUT_MS,
      maxRetries: 0,
      signal: options.signal,
    });
  } catch (error) {
    throw modelCallError(error);
  }

  try {
    assertCompleted(response);
    const parsedResult = RippleModelOutputSchema.safeParse(
      response.output_parsed,
    );
    if (!parsedResult.success) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned an invalid ripple analysis.",
        status: 502,
        retryable: false,
        callConsumed: true,
        cause: parsedResult.error,
      });
    }
    const parsed = parsedResult.data;
    if (parsed.kind === "no_credible_links") {
      if (parsed.links.length !== 0 || parsed.noCredibleReason === null) {
        throw new AtlasApiError({
          code: "model_output_invalid",
          message: "The analysis service returned an invalid ripple analysis.",
          status: 502,
          retryable: false,
          callConsumed: true,
        });
      }
      return RippleGenerationTemplateSchema.parse({
        kind: "no_credible_links",
        reason: parsed.noCredibleReason,
      });
    }

    if (parsed.links.length === 0 || parsed.noCredibleReason !== null) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned an invalid ripple analysis.",
        status: 502,
        retryable: false,
        callConsumed: true,
      });
    }
    const usedTargets = new Set<string>();
    for (const link of parsed.links) {
      if (!targetIds.has(link.targetEventId) || usedTargets.has(link.targetEventId)) {
        throw new AtlasApiError({
          code: "model_output_invalid",
          message: "The ripple analysis referenced an invalid or duplicate event.",
          status: 502,
          retryable: false,
          callConsumed: true,
        });
      }
      usedTargets.add(link.targetEventId);
    }
    return RippleGenerationTemplateSchema.parse({
      kind: "ripples",
      links: parsed.links,
    });
  } catch (error) {
    if (error instanceof AtlasApiError) throw error;
    throw new AtlasApiError({
      code: "model_output_invalid",
      message: "The analysis service returned an invalid ripple analysis.",
      status: 502,
      retryable: false,
      callConsumed: true,
      cause: error,
    });
  }
}

function createEdgeIds(
  count: number,
  factory: () => string,
  callConsumed: boolean,
) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const id = factory();
    if (!z.string().uuid().safeParse(id).success || seen.has(id)) {
      throw new AtlasApiError({
        code: "internal_error",
        message: "The ripple analysis could not be completed.",
        status: 500,
        retryable: false,
        callConsumed,
      });
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

export function materializeRippleTemplate(
  rawTemplate: RippleGenerationTemplate,
  input: {
    sourceEventId: string;
    sourceScenarioNodeId: string;
    sourceScenarioTitle: string;
    sourceScenarioSummary: string;
    targetEvents: WorldEventSummary[];
  },
  options: {
    mode: "live" | "fixture";
    callConsumed: boolean;
    cacheStatus: "hit" | "miss";
    now?: () => Date;
    createId?: () => string;
  },
): RippleAnalysisResponse {
  const template = RippleGenerationTemplateSchema.parse(rawTemplate);
  const meta = {
    mode: options.mode,
    callConsumed: options.callConsumed,
    cacheStatus: options.cacheStatus,
  };
  if (template.kind === "no_credible_links") {
    return RippleAnalysisResponseSchema.parse({
      ok: true,
      kind: "no_credible_links",
      reason: template.reason,
      meta,
    });
  }
  const targetById = new Map(
    input.targetEvents.map((target) => [target.id, target] as const),
  );
  const selectedTargets = template.links.map((link) => targetById.get(link.targetEventId));
  if (selectedTargets.some((target) => !target)) {
    throw new AtlasApiError({
      code: "cache_invalid",
      message: "The ripple analysis references an unavailable target event.",
      status: 500,
      retryable: false,
      callConsumed: options.callConsumed,
    });
  }
  const ids = createEdgeIds(
    template.links.length,
    options.createId ?? randomUUID,
    options.callConsumed,
  );
  const analyzedAt = (options.now?.() ?? new Date()).toISOString();
  const edges = template.links.map((link, index) =>
    RippleEdgeSchema.parse({
      id: ids[index],
      sourceEventId: input.sourceEventId,
      sourceScenarioNodeId: input.sourceScenarioNodeId,
      sourceScenarioTitle: input.sourceScenarioTitle,
      sourceScenarioSummary: input.sourceScenarioSummary,
      ...link,
      analyzedAt,
    }),
  );
  return RippleAnalysisResponseSchema.parse({
    ok: true,
    kind: "ripples",
    edges,
    targetEvents: selectedTargets,
    meta,
  });
}

export function responseFromStoredRippleEdges(input: {
  edges: RippleEdge[];
  noCredibleReason?: string | null;
  targetEvents: WorldEventSummary[];
  mode: "live" | "fixture";
}): RippleAnalysisResponse {
  if (input.edges.length === 0) {
    return RippleAnalysisResponseSchema.parse({
      ok: true,
      kind: "no_credible_links",
      reason:
        input.noCredibleReason ??
        "No credible one-hop relationships were identified.",
      meta: { mode: input.mode, callConsumed: false, cacheStatus: "hit" },
    });
  }
  const targets = new Map(input.targetEvents.map((event) => [event.id, event]));
  const targetEvents = input.edges.map((edge) => targets.get(edge.targetEventId));
  if (targetEvents.some((event) => !event)) {
    throw new AtlasApiError({
      code: "ripple_target_unavailable",
      message: "A saved ripple target is no longer available.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }
  return RippleAnalysisResponseSchema.parse({
    ok: true,
    kind: "ripples",
    edges: input.edges,
    targetEvents,
    meta: { mode: input.mode, callConsumed: false, cacheStatus: "hit" },
  });
}

type SavedRippleRepository = Pick<
  WorldRepository,
  | "getCatalogMetadata"
  | "getRippleAnalysisResult"
  | "getWorldEvent"
  | "listEligibleTargetEvents"
>;

function staleRippleAnalysisError(message: string) {
  return new AtlasApiError({
    code: "ripple_analysis_stale",
    message,
    status: 409,
    retryable: true,
    callConsumed: false,
  });
}

export async function loadSavedRippleAnalysis(input: {
  repository: SavedRippleRepository;
  request: RippleRequest;
  mode: "live" | "fixture";
}): Promise<RippleAnalysisResponse> {
  const sourceEvent = await input.repository.getWorldEvent(
    input.request.worldEventId,
  );
  if (!sourceEvent || sourceEvent.state !== "verified") {
    throw new AtlasApiError({
      code: "ripple_source_unavailable",
      message: "This source event is no longer verified for world analysis.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }

  const metadata = await input.repository.getCatalogMetadata();
  const key = {
    graphId: input.request.graphId,
    scenarioNodeId: input.request.scenarioNodeId,
  };
  const analysis = await input.repository.getRippleAnalysisResult({
    ...key,
    catalogVersion: metadata.catalogVersion,
  });
  if (analysis === null) {
    const priorAnalysis = await input.repository.getRippleAnalysisResult(key);
    if (priorAnalysis !== null) {
      throw staleRippleAnalysisError(
        "The saved world reaction is out of date. Recheck ripple links to refresh it.",
      );
    }
    throw new AtlasApiError({
      code: "ripple_not_generated",
      message: "This scenario has not been analyzed for world reactions yet.",
      status: 404,
      retryable: false,
      callConsumed: false,
    });
  }

  const eligibleTargets = await input.repository.listEligibleTargetEvents(
    input.request.worldEventId,
  );
  const eligibleById = new Map(
    eligibleTargets.map((event) => [event.id, event] as const),
  );
  const targetEvents = analysis.edges.map((edge) =>
    eligibleById.get(edge.targetEventId),
  );
  if (targetEvents.some((event) => !event)) {
    throw staleRippleAnalysisError(
      "A saved target event is no longer active or eligible. Recheck ripple links to refresh this analysis.",
    );
  }

  return responseFromStoredRippleEdges({
    edges: analysis.edges,
    noCredibleReason: analysis.noCredibleReason,
    targetEvents: targetEvents.filter(
      (event): event is WorldEventSummary => Boolean(event),
    ),
    mode: input.mode,
  });
}
