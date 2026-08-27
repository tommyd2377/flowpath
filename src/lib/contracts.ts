import { z } from "zod";

export const MAX_ATLAS_CALLS = 10;
export const MAX_ATLAS_NODES = 64;
export const MAX_HEADLINES = 30;
export const MAX_SAVED_ATLASES = 20;

const IsoDateSchema = z.string().datetime({ offset: true });
const HttpsUrlSchema = z.string().url().refine((value) => value.startsWith("https://"), {
  message: "Only HTTPS URLs are allowed.",
});

export const HeadlineItemSchema = z
  .object({
    id: z.string().min(8).max(64),
    title: z.string().min(1).max(240),
    publisher: z.string().min(1).max(100).nullable(),
    publisherUrl: HttpsUrlSchema.nullable(),
    googleNewsUrl: HttpsUrlSchema,
    publishedAt: IsoDateSchema.nullable(),
  })
  .strict();

export type HeadlineItem = z.infer<typeof HeadlineItemSchema>;

export const SourceSchema = z
  .object({
    id: z.string().min(2).max(32),
    title: z.string().min(1).max(240),
    url: HttpsUrlSchema,
    domain: z.string().min(1).max(253),
  })
  .strict();

export const EventSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    headline: HeadlineItemSchema,
    capturedAt: IsoDateSchema,
    verificationStatus: z.enum(["corroborated", "partial"]),
    summary: z.string().min(1).max(900),
    facts: z
      .array(
        z
          .object({
            text: z.string().min(1).max(500),
            sourceIds: z.array(z.string().min(2).max(32)).min(1).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    uncertainties: z.array(z.string().min(1).max(320)).max(6),
    sources: z.array(SourceSchema).min(1).max(16),
  })
  .strict();

export type EventSnapshot = z.infer<typeof EventSnapshotSchema>;

export const DepthSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const PossibilityNodeSchema = z
  .object({
    id: z.string().uuid(),
    parentId: z.string().min(1).max(100),
    depth: DepthSchema,
    title: z.string().min(1).max(100),
    summary: z.string().min(1).max(420),
    whyPlausible: z.string().min(1).max(420),
    keyAssumption: z.string().min(1).max(280),
    watchFor: z.array(z.string().min(1).max(180)).min(1).max(3),
    lessLikelyIf: z.string().min(1).max(280),
    horizon: z.string().min(1).max(100),
    childIds: z.array(z.string().uuid()).max(5),
    status: z.enum(["ready", "generating", "leaf", "error"]),
    errorMessage: z.string().max(300).nullable(),
    leafReason: z.string().max(360).nullable(),
  })
  .strict();

export type PossibilityNode = z.infer<typeof PossibilityNodeSchema>;

export const AtlasGraphSchema = z
  .object({
    id: z.string().uuid(),
    createdAt: IsoDateSchema,
    updatedAt: IsoDateSchema,
    headline: HeadlineItemSchema,
    status: z.enum(["verifying", "ready", "insufficient_evidence", "error"]),
    snapshot: EventSnapshotSchema.nullable(),
    nodes: z.record(z.string(), PossibilityNodeSchema),
    rootChildIds: z.array(z.string().uuid()).max(5),
    focusedNodeId: z.string().uuid().nullable(),
    callsUsed: z.number().int().min(0).max(MAX_ATLAS_CALLS),
    errorMessage: z.string().max(300).nullable(),
    insufficientReason: z.string().max(500).nullable(),
    insufficientSummary: z.string().max(900).nullable(),
    insufficientSources: z.array(SourceSchema).max(16),
  })
  .strict();

export type AtlasGraph = z.infer<typeof AtlasGraphSchema>;

export const StorageEnvelopeSchema = z
  .object({
    version: z.literal(1),
    installationId: z.string().uuid(),
    atlases: z.record(z.string(), AtlasGraphSchema),
    activeAtlasId: z.string().uuid().nullable(),
    lastHeadlines: z.array(HeadlineItemSchema).max(MAX_HEADLINES),
    lastHeadlinesAt: IsoDateSchema.nullable(),
    updatedAt: IsoDateSchema,
  })
  .strict();

export type StorageEnvelope = z.infer<typeof StorageEnvelopeSchema>;

export const HeadlinesResponseSchema = z
  .object({
    ok: z.literal(true),
    items: z.array(HeadlineItemSchema).max(MAX_HEADLINES),
    fetchedAt: IsoDateSchema,
    feedUpdatedAt: IsoDateSchema.nullable(),
    stale: z.boolean(),
    warning: z.string().max(300).nullable(),
  })
  .strict();

export const StartAtlasRequestSchema = z
  .object({
    installationId: z.string().uuid(),
    graphId: z.string().uuid(),
    headline: HeadlineItemSchema,
  })
  .strict();

export const LineageNodeSchema = PossibilityNodeSchema.pick({
  id: true,
  parentId: true,
  depth: true,
  title: true,
  summary: true,
  whyPlausible: true,
  keyAssumption: true,
  horizon: true,
});

export type LineageNode = z.infer<typeof LineageNodeSchema>;

export const ExpandAtlasRequestSchema = z
  .object({
    installationId: z.string().uuid(),
    graphId: z.string().uuid(),
    parentId: z.string().uuid(),
    snapshot: EventSnapshotSchema,
    lineage: z.array(LineageNodeSchema).min(1).max(5),
    remainingNodeCapacity: z.number().int().min(3).max(MAX_ATLAS_NODES - 1),
  })
  .strict();

export const ResponseMetaSchema = z
  .object({
    mode: z.enum(["live", "fixture"]),
    callConsumed: z.boolean(),
  })
  .strict();

export const StartAtlasResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("atlas"),
      snapshot: EventSnapshotSchema,
      nodes: z.array(PossibilityNodeSchema).min(3).max(5),
      meta: ResponseMetaSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("insufficient_evidence"),
      summary: z.string().min(1).max(900),
      reason: z.string().min(1).max(500),
      sources: z.array(SourceSchema).max(16),
      meta: ResponseMetaSchema,
    })
    .strict(),
]);

export type StartAtlasResponse = z.infer<typeof StartAtlasResponseSchema>;

export const ExpandAtlasResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("branches"),
      parentId: z.string().uuid(),
      nodes: z.array(PossibilityNodeSchema).min(3).max(5),
      meta: ResponseMetaSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("leaf"),
      parentId: z.string().uuid(),
      reason: z.string().min(1).max(500),
      meta: ResponseMetaSchema,
    })
    .strict(),
]);

export type ExpandAtlasResponse = z.infer<typeof ExpandAtlasResponseSchema>;

export const ErrorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().min(1).max(64),
        message: z.string().min(1).max(300),
        retryable: z.boolean(),
        callConsumed: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
