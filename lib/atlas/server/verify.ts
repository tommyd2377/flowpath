import { randomUUID } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  EventSnapshotSchema,
  PossibilityNodeSchema,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type PossibilityNode,
  type StartAtlasResponse,
} from "../contracts";
import { AtlasApiError } from "./http";
import {
  InitialModelOutputSchema,
  type InitialModelOutput,
  type ModelPossibility,
} from "./model-contracts";
import type {
  AtlasParsedResponse,
  AtlasResponsesAdapter,
  AtlasResponsesRequest,
} from "./openai-client";
import {
  extractResponseEvidence,
  researchProvenance,
  type ExtractedEvidence,
} from "./provenance";
import { buildInitialAtlasInput, INITIAL_ATLAS_SYSTEM_PROMPT } from "./prompts";
import { atlasSafetyIdentifier } from "./request-guard";

const INITIAL_MAX_OUTPUT_TOKENS = 4_000;
const INITIAL_TIMEOUT_MS = 75_000;
const INITIAL_MAX_SEARCH_CALLS = 2;

type StartAtlasRequest = z.infer<typeof StartAtlasRequestSchema>;

export type StartAtlasOpenAIOptions = {
  adapter: AtlasResponsesAdapter;
  model: string;
  signal?: AbortSignal | null;
  now?: () => Date;
  createId?: () => string;
};

function liveMeta() {
  return { mode: "live" as const, callConsumed: true, cacheStatus: "miss" as const };
}

function modelCallError(error: unknown) {
  if (error instanceof AtlasApiError) return error;
  return new AtlasApiError({
    code: "analysis_unavailable",
    message: "The analysis service did not complete this request.",
    status: 502,
    retryable: true,
    callConsumed: true,
    cause: error,
  });
}

function assertCompleted<T>(
  response: AtlasParsedResponse<T>,
  evidence: ExtractedEvidence,
) {
  if (evidence.refusal) {
    throw new AtlasApiError({
      code: "model_refusal",
      message: "The analysis service declined this headline.",
      status: 422,
      retryable: false,
      callConsumed: true,
    });
  }
  if (response.status !== "completed" || response.incomplete_details || response.error) {
    throw new AtlasApiError({
      code: "model_incomplete",
      message: "The analysis service returned an incomplete result.",
      status: 502,
      retryable: true,
      callConsumed: true,
    });
  }
}

function normalizedTitle(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

function assertUniqueBranches(branches: ModelPossibility[]) {
  const titles = new Set<string>();
  for (const branch of branches) {
    const title = normalizedTitle(branch.title);
    if (!title || titles.has(title)) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned duplicate possibility branches.",
        status: 502,
        retryable: false,
        callConsumed: true,
      });
    }
    titles.add(title);
  }
}

function createServerIds(count: number, factory: () => string) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const id = factory();
    if (!z.string().uuid().safeParse(id).success || seen.has(id)) {
      throw new AtlasApiError({
        code: "internal_error",
        message: "The request could not be completed.",
        status: 500,
        retryable: false,
        callConsumed: true,
      });
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

export async function startAtlasWithOpenAI(
  rawInput: StartAtlasRequest,
  options: StartAtlasOpenAIOptions,
): Promise<StartAtlasResponse> {
  const input = StartAtlasRequestSchema.parse(rawInput);
  const request: AtlasResponsesRequest = {
    model: options.model,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: INITIAL_MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: INITIAL_ATLAS_SYSTEM_PROMPT },
      { role: "user", content: buildInitialAtlasInput(input.headline) },
    ],
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    max_tool_calls: INITIAL_MAX_SEARCH_CALLS,
    parallel_tool_calls: false,
    include: ["web_search_call.action.sources"],
    text: {
      format: zodTextFormat(
        InitialModelOutputSchema,
        "possibility_atlas_initial_branches",
      ),
      verbosity: "low",
    },
    safety_identifier: atlasSafetyIdentifier(input.installationId),
  };

  let response: AtlasParsedResponse<InitialModelOutput>;
  try {
    response = await options.adapter.parse<InitialModelOutput>(request, {
      timeout: INITIAL_TIMEOUT_MS,
      maxRetries: 0,
      signal: options.signal,
    });
  } catch (error) {
    throw modelCallError(error);
  }

  try {
    const evidence = extractResponseEvidence(response.output);
    assertCompleted(response, evidence);

    const parsedResult = InitialModelOutputSchema.safeParse(response.output_parsed);
    if (!parsedResult.success) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned an invalid result.",
        status: 502,
        retryable: false,
        callConsumed: true,
        cause: parsedResult.error,
      });
    }
    const parsed = parsedResult.data;

    // A completed, structured analysis always becomes a map. Citations provide
    // attribution; missing/mismatched citations never reject its possibilities.
    const context = researchProvenance(parsed.sources, parsed.facts, evidence);
    const facts = context.findings.length ? context.findings : [{
      text: `${input.headline.publisher ?? "The selected headline"} reports: ${input.headline.title}`,
      sourceIds: [],
    }];
    const summary = context.findings.length < parsed.facts.length
      ? facts.map(fact => fact.text).join(" ").slice(0, 900)
      : parsed.summary;
    assertUniqueBranches(parsed.branches);

    const createId = options.createId ?? randomUUID;
    const serverIds = createServerIds(parsed.branches.length + 1, createId);
    const nodeIds = serverIds.slice(0, parsed.branches.length);
    const snapshotId = serverIds.at(-1);
    const nodes = parsed.branches.map((branch, index): PossibilityNode =>
      PossibilityNodeSchema.parse({
        id: nodeIds[index],
        parentId: input.graphId,
        depth: 1,
        title: branch.title,
        summary: branch.summary,
        whyPlausible: branch.whyPlausible,
        keyAssumption: branch.keyAssumption,
        watchFor: branch.watchFor,
        lessLikelyIf: branch.lessLikelyIf,
        horizon: branch.horizon,
        childIds: [],
        status: "ready",
        errorMessage: null,
        leafReason: null,
      }),
    );

    const snapshot = EventSnapshotSchema.parse({
      id: snapshotId,
      headline: input.headline,
      capturedAt: (options.now?.() ?? new Date()).toISOString(),
      verificationStatus: "reported",
      summary,
      facts,
      uncertainties: parsed.uncertainties,
      sources: context.sources,
    });

    return StartAtlasResponseSchema.parse({
      ok: true,
      kind: "atlas",
      snapshot,
      nodes,
      meta: liveMeta(),
    });
  } catch (error) {
    if (error instanceof AtlasApiError) throw error;
    throw new AtlasApiError({
      code: "model_output_invalid",
      message: "The analysis service returned an invalid result.",
      status: 502,
      retryable: false,
      callConsumed: true,
      cause: error,
    });
  }
}
