import { randomUUID } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  EventSnapshotSchema,
  PossibilityNodeSchema,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type EventSnapshot,
  type PossibilityNode,
  type StartAtlasResponse,
} from "../contracts";
import { CuratedStorySchema, type CuratedStory } from "../../story-contracts";
import { AtlasApiError } from "./http";
import {
  InitialModelOutputSchema,
  type InitialResearchOutput,
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
import { completedResearchPrefix } from "./research-prefix";
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
  context?: CuratedStory;
  onResearch?: (snapshot: EventSnapshot) => void;
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

function logResearchFailure(stage: "request" | "validation", error: AtlasApiError, response?: AtlasParsedResponse<unknown>) {
  const causes: Record<string, unknown>[] = [];
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 4 && cause !== null && typeof cause === "object"; depth += 1) {
    const details = cause as Record<string, unknown>;
    causes.push(details);
    cause = details.cause;
  }
  const atom = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_]{1,80}$/.test(value) ? value : undefined;
  const names = new Set(["Error", "SyntaxError", "ZodError", "APIError", "BadRequestError", "AuthenticationError", "PermissionDeniedError", "NotFoundError", "ConflictError", "UnprocessableEntityError", "RateLimitError", "InternalServerError", "APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "AbortError"]);
  const provider = causes.find(item => !(item instanceof AtlasApiError) && (typeof item.status === "number" || typeof item.code === "string"));
  const responseError = response?.error !== null && typeof response?.error === "object" ? response.error as Record<string, unknown> : undefined;
  const schema = causes.find(item => Array.isArray(item.issues));
  const fields = new Set(["summary", "facts", "text", "sourceUrls", "uncertainties", "sources", "title", "url", "branches", "whyPlausible", "keyAssumption", "watchFor", "lessLikelyIf", "horizon", "id", "headline", "capturedAt", "verificationStatus", "sourceIds", "domain", "parentId", "depth", "childIds", "status", "errorMessage", "leafReason", "ok", "kind", "snapshot", "nodes", "meta"]);
  const schemaIssues = (schema?.issues as Array<{ code?: unknown; path?: unknown }> | undefined)?.slice(0, 12).map(issue => ({
    code: atom(issue.code) ?? "unknown",
    path: Array.isArray(issue.path) ? issue.path.map(part => typeof part === "number" ? part : typeof part === "string" && fields.has(part) ? part : "unknown") : [],
  }));
  const errorName = causes.map(item => item.name).find(name => typeof name === "string" && names.has(name));
  const providerStatus = typeof provider?.status === "number" && provider.status >= 100 && provider.status <= 599 ? provider.status : undefined;
  const incompleteReason = response?.incomplete_details?.reason;
  // Log machine metadata only. Provider messages, model text, request contents,
  // headers and identifiers can contain private data and must not be logged.
  console.warn("[flowpath:initial_research_failed]", JSON.stringify({
    stage, code: error.code, errorName: errorName ?? error.name,
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(atom(provider?.code ?? responseError?.code) ? { providerCode: atom(provider?.code ?? responseError?.code) } : {}),
    ...(incompleteReason ? { incompleteReason: ["max_output_tokens", "content_filter"].includes(incompleteReason) ? incompleteReason : "unknown" } : {}),
    ...(schemaIssues?.length ? { schemaIssues } : {}),
  }));
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

function createServerIds(count: number, factory: () => string, reserved: string[] = []) {
  const ids: string[] = [];
  const seen = new Set(reserved);
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

function researchSnapshot(
  input: StartAtlasRequest,
  parsed: InitialResearchOutput,
  evidence: ExtractedEvidence,
  identity: { id: string; capturedAt: string },
) {
  const context = researchProvenance(parsed.sources, parsed.facts, evidence);
  const facts = context.findings.length ? context.findings : [{
    text: `${input.headline.publisher ?? "The selected headline"} reports: ${input.headline.title}`,
    sourceIds: [],
  }];
  const summary = !context.findings.length || context.findings.length < parsed.facts.length
    ? facts.map(fact => fact.text).join(" ")
    : parsed.summary;
  return EventSnapshotSchema.parse({
    ...identity,
    headline: input.headline,
    verificationStatus: "reported",
    summary,
    facts,
    uncertainties: parsed.uncertainties,
    sources: context.sources,
  });
}

export async function startAtlasWithOpenAI(
  rawInput: StartAtlasRequest,
  options: StartAtlasOpenAIOptions,
): Promise<StartAtlasResponse> {
  const input = StartAtlasRequestSchema.parse(rawInput);
  const context = options.context ? CuratedStorySchema.parse(options.context) : undefined;
  const request: AtlasResponsesRequest = {
    model: options.model,
    service_tier: "priority",
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: INITIAL_MAX_OUTPUT_TOKENS,
    input: [
      { role: "system", content: INITIAL_ATLAS_SYSTEM_PROMPT },
      { role: "user", content: buildInitialAtlasInput(input.headline, context) },
    ],
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    max_tool_calls: INITIAL_MAX_SEARCH_CALLS,
    parallel_tool_calls: false,
    include: ["web_search_call.action.sources"],
    text: {
      format: zodTextFormat(InitialModelOutputSchema, "possibility_atlas_initial_branches"),
      verbosity: "low",
    },
    safety_identifier: atlasSafetyIdentifier(input.installationId),
  };

  let response: AtlasParsedResponse<InitialModelOutput>;
  const createId = options.createId ?? randomUUID;
  let publishedResearch: EventSnapshot | undefined;
  try {
    const requestOptions = {
      timeout: INITIAL_TIMEOUT_MS,
      maxRetries: 0 as const,
      signal: options.signal,
    };
    if (options.adapter.stream) {
      response = await options.adapter.stream<InitialModelOutput>(request, requestOptions, (progress) => {
        if (publishedResearch || !options.onResearch || options.signal?.aborted) return;
        const research = completedResearchPrefix(progress.outputText);
        if (!research) return;
        // Only completed tool metadata establishes consulted sources during a
        // stream. A finished message's annotations cannot vouch for early facts.
        const searches = progress.completedOutput.filter((item) => item !== null
          && typeof item === "object" && "type" in item && item.type === "web_search_call"
          && "status" in item && ["completed", "failed"].includes(String(item.status)));
        const evidence = extractResponseEvidence(searches);
        if (research.facts.length && !evidence.webSearchCalls) return;
        const [id] = createServerIds(1, createId);
        publishedResearch = researchSnapshot(input, research, evidence, {
          id,
          capturedAt: (options.now?.() ?? new Date()).toISOString(),
        });
        options.onResearch(publishedResearch);
      });
    } else {
      response = await options.adapter.parse<InitialModelOutput>(request, requestOptions);
    }
    if (options.signal?.aborted) throw options.signal.reason ?? new Error("Research request aborted.");
  } catch (error) {
    const failure = modelCallError(error);
    logResearchFailure("request", failure);
    throw failure;
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
    assertUniqueBranches(parsed.branches);

    const serverIds = createServerIds(
      parsed.branches.length + (publishedResearch ? 0 : 1),
      createId,
      publishedResearch ? [publishedResearch.id] : [],
    );
    const nodeIds = serverIds.slice(0, parsed.branches.length);
    const snapshotId = publishedResearch?.id ?? serverIds.at(-1)!;
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

    const snapshot = researchSnapshot(input, parsed, evidence, {
      id: snapshotId,
      capturedAt: publishedResearch?.capturedAt ?? (options.now?.() ?? new Date()).toISOString(),
    });

    return StartAtlasResponseSchema.parse({
      ok: true,
      kind: "atlas",
      snapshot,
      nodes,
      meta: liveMeta(),
    });
  } catch (error) {
    const failure = error instanceof AtlasApiError ? error : new AtlasApiError({
      code: "model_output_invalid",
      message: "The analysis service returned an invalid result.",
      status: 502,
      retryable: false,
      callConsumed: true,
      cause: error,
    });
    logResearchFailure("validation", failure, response);
    throw failure;
  }
}
