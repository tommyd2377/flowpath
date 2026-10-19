import { randomUUID } from "node:crypto";

import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  ExpandAtlasRequestSchema,
  ExpandAtlasResponseSchema,
  PossibilityNodeSchema,
  type ExpandAtlasResponse,
  type PossibilityNode,
} from "../contracts";
import { AtlasApiError } from "./http";
import {
  createExpansionModelOutputSchema,
  type ExpansionModelOutput,
  type ModelPossibility,
} from "./model-contracts";
import type {
  AtlasParsedResponse,
  AtlasResponsesAdapter,
  AtlasResponsesRequest,
} from "./openai-client";
import { extractResponseEvidence } from "./provenance";
import {
  buildExpansionAtlasInput,
  buildExpansionAtlasSystemPrompt,
} from "./prompts";
import { atlasSafetyIdentifier } from "./request-guard";

const EXPANSION_MAX_OUTPUT_TOKENS = 3_000;
const EXPANSION_TIMEOUT_MS = 40_000;

export type ExpandAtlasRequest = z.infer<typeof ExpandAtlasRequestSchema>;

export type ExpandAtlasOpenAIOptions = {
  adapter: AtlasResponsesAdapter;
  model: string;
  signal?: AbortSignal | null;
  createId?: () => string;
};

export type ValidatedExpansionContext = {
  input: ExpandAtlasRequest;
  nextDepth: 2 | 3 | 4 | 5;
  maxBranches: number;
};

function normalizedTitle(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, " ").trim();
}

export function validateExpansionContext(
  rawInput: ExpandAtlasRequest,
): ValidatedExpansionContext {
  const input = ExpandAtlasRequestSchema.parse(rawInput);
  const ids = new Set<string>();

  for (let index = 0; index < input.lineage.length; index += 1) {
    const node = input.lineage[index];
    const expectedDepth = index + 1;
    const expectedParentId =
      index === 0 ? input.graphId : input.lineage[index - 1]?.id;
    if (
      node.depth !== expectedDepth ||
      node.parentId !== expectedParentId ||
      ids.has(node.id)
    ) {
      throw new AtlasApiError({
        code: "invalid_lineage",
        message: "The selected possibility lineage is not sequential.",
        status: 400,
        retryable: false,
        callConsumed: false,
      });
    }
    ids.add(node.id);
  }

  const parent = input.lineage.at(-1);
  if (!parent || parent.id !== input.parentId) {
    throw new AtlasApiError({
      code: "invalid_lineage",
      message: "The selected parent does not match the supplied lineage.",
      status: 400,
      retryable: false,
      callConsumed: false,
    });
  }
  if (parent.depth >= 5) {
    throw new AtlasApiError({
      code: "max_depth_reached",
      message: "Depth-five possibilities cannot be expanded further.",
      status: 409,
      retryable: false,
      callConsumed: false,
    });
  }

  return {
    input,
    nextDepth: (parent.depth + 1) as 2 | 3 | 4 | 5,
    maxBranches: Math.min(5, input.remainingNodeCapacity),
  };
}

function assertUniqueExpansionBranches(
  branches: ModelPossibility[],
  lineageTitles: string[],
) {
  const existing = new Set(lineageTitles.map(normalizedTitle));
  const siblings = new Set<string>();
  for (const branch of branches) {
    const title = normalizedTitle(branch.title);
    if (!title || existing.has(title) || siblings.has(title)) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned duplicate possibility branches.",
        status: 502,
        retryable: false,
        callConsumed: true,
      });
    }
    siblings.add(title);
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

function assertCompleted<T>(response: AtlasParsedResponse<T>) {
  const evidence = extractResponseEvidence(response.output);
  if (evidence.refusal) {
    throw new AtlasApiError({
      code: "model_refusal",
      message: "The analysis service declined this expansion.",
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

export async function expandAtlasWithOpenAI(
  rawInput: ExpandAtlasRequest,
  options: ExpandAtlasOpenAIOptions,
): Promise<ExpandAtlasResponse> {
  const { input, nextDepth, maxBranches } = validateExpansionContext(rawInput);
  const modelSchema = createExpansionModelOutputSchema(maxBranches);
  const request: AtlasResponsesRequest = {
    model: options.model,
    service_tier: "priority",
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: EXPANSION_MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "system",
        content: buildExpansionAtlasSystemPrompt(maxBranches),
      },
      {
        role: "user",
        content: buildExpansionAtlasInput({
          snapshot: input.snapshot,
          lineage: input.lineage,
          maxBranches,
        }),
      },
    ],
    text: {
      format: zodTextFormat(
        modelSchema,
        "possibility_atlas_branch_expansion",
      ),
      verbosity: "low",
    },
    safety_identifier: atlasSafetyIdentifier(input.installationId),
  };

  let response: AtlasParsedResponse<ExpansionModelOutput>;
  try {
    response = await options.adapter.parse<ExpansionModelOutput>(request, {
      timeout: EXPANSION_TIMEOUT_MS,
      maxRetries: 0,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof AtlasApiError) throw error;
    throw new AtlasApiError({
      code: "analysis_unavailable",
      message: "The analysis service did not complete this request.",
      status: 502,
      retryable: true,
      callConsumed: true,
      cause: error,
    });
  }

  try {
    assertCompleted(response);
    const parsedResult = modelSchema.safeParse(response.output_parsed);
    if (!parsedResult.success) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned an invalid expansion.",
        status: 502,
        retryable: false,
        callConsumed: true,
        cause: parsedResult.error,
      });
    }
    const parsed = parsedResult.data;

    if (parsed.kind === "leaf") {
      if (parsed.branches.length !== 0 || parsed.leafReason === null) {
        throw new AtlasApiError({
          code: "model_output_invalid",
          message: "The analysis service returned an invalid expansion.",
          status: 502,
          retryable: false,
          callConsumed: true,
        });
      }
      return ExpandAtlasResponseSchema.parse({
        ok: true,
        kind: "leaf",
        parentId: input.parentId,
        reason: parsed.leafReason,
        meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
      });
    }

    if (parsed.branches.length < 3 || parsed.leafReason !== null) {
      throw new AtlasApiError({
        code: "model_output_invalid",
        message: "The analysis service returned an invalid expansion.",
        status: 502,
        retryable: false,
        callConsumed: true,
      });
    }

    assertUniqueExpansionBranches(
      parsed.branches,
      input.lineage.map((node) => node.title),
    );

    const createId = options.createId ?? randomUUID;
    const nodeIds = createServerIds(parsed.branches.length, createId);
    const nodes = parsed.branches.map((branch, index): PossibilityNode => {
      const atDepthLimit = nextDepth === 5;
      return PossibilityNodeSchema.parse({
        id: nodeIds[index],
        parentId: input.parentId,
        depth: nextDepth,
        title: branch.title,
        summary: branch.summary,
        whyPlausible: branch.whyPlausible,
        keyAssumption: branch.keyAssumption,
        watchFor: branch.watchFor,
        lessLikelyIf: branch.lessLikelyIf,
        horizon: branch.horizon,
        childIds: [],
        status: atDepthLimit ? "leaf" : "ready",
        errorMessage: null,
        leafReason: atDepthLimit ? "Maximum atlas depth reached." : null,
      });
    });

    return ExpandAtlasResponseSchema.parse({
      ok: true,
      kind: "branches",
      parentId: input.parentId,
      nodes,
      meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
    });
  } catch (error) {
    if (error instanceof AtlasApiError) throw error;
    throw new AtlasApiError({
      code: "model_output_invalid",
      message: "The analysis service returned an invalid expansion.",
      status: 502,
      retryable: false,
      callConsumed: true,
      cause: error,
    });
  }
}

