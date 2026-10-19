import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  EventSnapshotSchema,
  ExpandAtlasRequestSchema,
  ExpandAtlasResponseSchema,
  PossibilityNodeSchema,
  SourceSchema,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type ExpandAtlasResponse,
  type StartAtlasResponse,
} from "../contracts";
import { AtlasApiError } from "./http";

export const START_PROMPT_VERSION = "start-v8-source-interpretation";
export const EXPANSION_PROMPT_VERSION = "expand-v5-research-context";

const IsoDateSchema = z.string().datetime({ offset: true });

export const PossibilityTemplateSchema = PossibilityNodeSchema.pick({
  title: true,
  summary: true,
  whyPlausible: true,
  keyAssumption: true,
  watchFor: true,
  lessLikelyIf: true,
  horizon: true,
}).strict();

export const SnapshotTemplateSchema = EventSnapshotSchema.pick({
  verificationStatus: true,
  summary: true,
  facts: true,
  uncertainties: true,
  sources: true,
}).strict();

export const StartGenerationTemplateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("atlas"),
      snapshot: SnapshotTemplateSchema,
      branches: z.array(PossibilityTemplateSchema).min(3).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("insufficient_evidence"),
      summary: z.string().min(1).max(900),
      reason: z.string().min(1).max(500),
      sources: z.array(SourceSchema).max(16),
    })
    .strict(),
]);

export const ExpansionGenerationTemplateSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("branches"),
      branches: z.array(PossibilityTemplateSchema).min(3).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("leaf"),
      reason: z.string().min(1).max(500),
    })
    .strict(),
]);

export type PossibilityTemplate = z.infer<typeof PossibilityTemplateSchema>;
export type SnapshotTemplate = z.infer<typeof SnapshotTemplateSchema>;
export type StartGenerationTemplate = z.infer<
  typeof StartGenerationTemplateSchema
>;
export type ExpansionGenerationTemplate = z.infer<
  typeof ExpansionGenerationTemplateSchema
>;

function possibilityTemplateFromNode(
  node: z.infer<typeof PossibilityNodeSchema>,
): PossibilityTemplate {
  return {
    title: node.title,
    summary: node.summary,
    whyPlausible: node.whyPlausible,
    keyAssumption: node.keyAssumption,
    watchFor: node.watchFor,
    lessLikelyIf: node.lessLikelyIf,
    horizon: node.horizon,
  };
}

export function semanticExpansionSource(input: {
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

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

export function generationFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

export function generationCacheKey(input: {
  kind: "start" | "expand";
  model: string;
  promptVersion: string;
  source: unknown;
}) {
  return generationFingerprint(input);
}

function createServerIds(
  count: number,
  factory: () => string,
  callConsumed: boolean,
  reserved: string[] = [],
) {
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
        callConsumed,
      });
    }
    ids.push(id);
    seen.add(id);
  }
  return ids;
}

export type MaterializationMeta = {
  mode: "live" | "fixture";
  callConsumed: boolean;
  cacheStatus: "hit" | "miss";
};

export function startResponseToTemplate(
  response: StartAtlasResponse,
): StartGenerationTemplate {
  if (response.kind === "insufficient_evidence") {
    return StartGenerationTemplateSchema.parse({
      kind: response.kind,
      summary: response.summary,
      reason: response.reason,
      sources: response.sources,
    });
  }
  return StartGenerationTemplateSchema.parse({
    kind: "atlas",
    snapshot: {
      verificationStatus: response.snapshot.verificationStatus,
      summary: response.snapshot.summary,
      facts: response.snapshot.facts,
      uncertainties: response.snapshot.uncertainties,
      sources: response.snapshot.sources,
    },
    branches: response.nodes.map(possibilityTemplateFromNode),
  });
}

export function materializeStartTemplate(
  rawTemplate: StartGenerationTemplate,
  rawInput: z.input<typeof StartAtlasRequestSchema>,
  options: MaterializationMeta & {
    capturedAt: string;
    createId?: () => string;
    snapshotId?: string;
  },
): StartAtlasResponse {
  const template = StartGenerationTemplateSchema.parse(rawTemplate);
  const input = StartAtlasRequestSchema.parse(rawInput);
  const meta = {
    mode: options.mode,
    callConsumed: options.callConsumed,
    cacheStatus: options.cacheStatus,
  };
  if (template.kind === "insufficient_evidence") {
    return StartAtlasResponseSchema.parse({
      ok: true,
      ...template,
      meta,
    });
  }

  const capturedAt = IsoDateSchema.parse(options.capturedAt);
  const createId = options.createId ?? randomUUID;
  const ids = createServerIds(
    template.branches.length + (options.snapshotId ? 0 : 1),
    createId,
    options.callConsumed,
    options.snapshotId ? [options.snapshotId] : [],
  );
  const snapshotId = options.snapshotId ?? ids.at(-1);
  const nodes = template.branches.map((branch, index) =>
    PossibilityNodeSchema.parse({
      id: ids[index],
      parentId: input.graphId,
      depth: 1,
      ...branch,
      childIds: [],
      status: "ready",
      errorMessage: null,
      leafReason: null,
    }),
  );
  return StartAtlasResponseSchema.parse({
    ok: true,
    kind: "atlas",
    snapshot: {
      id: snapshotId,
      headline: input.headline,
      capturedAt,
      ...template.snapshot,
    },
    nodes,
    meta,
  });
}

export function expansionResponseToTemplate(
  response: ExpandAtlasResponse,
): ExpansionGenerationTemplate {
  if (response.kind === "leaf") {
    return ExpansionGenerationTemplateSchema.parse({
      kind: "leaf",
      reason: response.reason,
    });
  }
  return ExpansionGenerationTemplateSchema.parse({
    kind: "branches",
    branches: response.nodes.map(possibilityTemplateFromNode),
  });
}

export function materializeExpansionTemplate(
  rawTemplate: ExpansionGenerationTemplate,
  input: { parentId: string; nextDepth: 2 | 3 | 4 | 5; maxBranches: number },
  options: MaterializationMeta & { createId?: () => string },
): ExpandAtlasResponse {
  const template = ExpansionGenerationTemplateSchema.parse(rawTemplate);
  const meta = {
    mode: options.mode,
    callConsumed: options.callConsumed,
    cacheStatus: options.cacheStatus,
  };
  if (template.kind === "leaf") {
    return ExpandAtlasResponseSchema.parse({
      ok: true,
      kind: "leaf",
      parentId: input.parentId,
      reason: template.reason,
      meta,
    });
  }
  if (template.branches.length > input.maxBranches) {
    throw new AtlasApiError({
      code: "cache_invalid",
      message: "The cached analysis does not fit the remaining atlas capacity.",
      status: 500,
      retryable: false,
      callConsumed: options.callConsumed,
    });
  }
  const createId = options.createId ?? randomUUID;
  const ids = createServerIds(
    template.branches.length,
    createId,
    options.callConsumed,
  );
  const atDepthLimit = input.nextDepth === 5;
  const nodes = template.branches.map((branch, index) =>
    PossibilityNodeSchema.parse({
      id: ids[index],
      parentId: input.parentId,
      depth: input.nextDepth,
      ...branch,
      childIds: [],
      status: atDepthLimit ? "leaf" : "ready",
      errorMessage: null,
      leafReason: atDepthLimit ? "Maximum atlas depth reached." : null,
    }),
  );
  return ExpandAtlasResponseSchema.parse({
    ok: true,
    kind: "branches",
    parentId: input.parentId,
    nodes,
    meta,
  });
}
