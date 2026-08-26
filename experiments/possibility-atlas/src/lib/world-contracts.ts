import { z } from "zod";

import {
  EventSnapshotSchema,
  HeadlineItemSchema,
  ResponseMetaSchema,
} from "./contracts";

const IsoDateSchema = z.string().datetime({ offset: true });
const ScoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);

export const WorldDimensionsSchema = z
  .object({
    impact: ScoreSchema,
    branchability: ScoreSchema,
    connectivity: ScoreSchema,
    uncertainty: ScoreSchema,
  })
  .strict();

export const WorldEventSummarySchema = z
  .object({
    id: z.string().uuid(),
    canonicalTitle: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    state: z.enum(["candidate", "verified", "inactive"]),
    revision: z.number().int().min(1),
    leadHeadline: HeadlineItemSchema,
    headlineIds: z.array(z.string().min(8).max(64)).min(1).max(120),
    firstSeenAt: IsoDateSchema,
    lastSeenAt: IsoDateSchema,
    ripplePotential: z.enum(["moderate", "high", "very_high"]),
    dimensions: WorldDimensionsSchema,
  })
  .strict();

export type WorldEventSummary = z.infer<typeof WorldEventSummarySchema>;

export const WorldEventHeadlineSchema = z
  .object({
    headline: HeadlineItemSchema,
    role: z.enum(["root", "supporting"]),
    firstSeenAt: IsoDateSchema,
    lastSeenAt: IsoDateSchema,
  })
  .strict();

export type WorldEventHeadline = z.infer<typeof WorldEventHeadlineSchema>;

export const RippleEdgeSchema = z
  .object({
    id: z.string().uuid(),
    sourceEventId: z.string().uuid(),
    sourceScenarioNodeId: z.string().uuid(),
    sourceScenarioTitle: z.string().min(1).max(100),
    sourceScenarioSummary: z.string().min(1).max(420),
    targetEventId: z.string().uuid(),
    influence: z.enum([
      "raises_likelihood",
      "lowers_likelihood",
      "accelerates",
      "delays",
      "amplifies_impact",
      "reduces_pressure",
      "creates_dependency",
    ]),
    strength: z.enum(["limited", "moderate", "strong"]),
    confidence: z.enum(["low", "medium", "high"]),
    mechanism: z.string().min(1).max(700),
    horizon: z.string().min(1).max(120),
    watchFor: z.array(z.string().min(1).max(180)).min(1).max(4),
    analyzedAt: IsoDateSchema,
  })
  .strict();

export type RippleEdge = z.infer<typeof RippleEdgeSchema>;

export const RippleRequestSchema = z
  .object({
    installationId: z.string().uuid(),
    graphId: z.string().uuid(),
    worldEventId: z.string().uuid(),
    scenarioNodeId: z.string().uuid(),
  })
  .strict();

export const RippleQuerySchema = RippleRequestSchema;

export type RippleRequest = z.infer<typeof RippleRequestSchema>;

export const RippleAnalysisResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("ripples"),
      edges: z.array(RippleEdgeSchema).min(1).max(5),
      targetEvents: z.array(WorldEventSummarySchema).min(1).max(5),
      meta: ResponseMetaSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      kind: z.literal("no_credible_links"),
      reason: z.string().min(1).max(500),
      meta: ResponseMetaSchema,
    })
    .strict(),
]);

export type RippleAnalysisResponse = z.infer<
  typeof RippleAnalysisResponseSchema
>;

export const WorldCatalogMetadataSchema = z
  .object({
    catalogVersion: z.number().int().min(0),
    feedFingerprint: z.string().length(64).nullable(),
    scannedAt: IsoDateSchema.nullable(),
  })
  .strict();

export type WorldCatalogMetadata = z.infer<
  typeof WorldCatalogMetadataSchema
>;

export const WorldEventsResponseSchema = z
  .object({
    ok: z.literal(true),
    catalogVersion: z.number().int().min(0),
    feedFingerprint: z.string().length(64).nullable(),
    scannedAt: IsoDateSchema.nullable(),
    events: z.array(WorldEventSummarySchema).max(100),
    featuredCandidates: z.array(WorldEventSummarySchema).max(12),
    pressurePoints: z
      .array(
        z
          .object({
            event: WorldEventSummarySchema,
            outboundRippleCount: z.number().int().min(0),
          })
          .strict(),
      )
      .max(12),
    crossCurrents: z.array(RippleEdgeSchema).max(60),
    recentlyChanged: z.array(WorldEventSummarySchema).max(12),
  })
  .strict();

export type WorldEventsResponse = z.infer<typeof WorldEventsResponseSchema>;

export const WorldEventDetailResponseSchema = z
  .object({
    ok: z.literal(true),
    event: WorldEventSummarySchema,
    headlines: z.array(WorldEventHeadlineSchema).min(1).max(120),
    verifiedSnapshot: EventSnapshotSchema.nullable(),
  })
  .strict();

export type WorldEventDetailResponse = z.infer<
  typeof WorldEventDetailResponseSchema
>;

export const WorldRefreshRequestSchema = z
  .object({ installationId: z.string().uuid() })
  .strict();

export const WorldRefreshResponseSchema = WorldEventsResponseSchema.extend({
  feed: z
    .object({
      fetchedAt: IsoDateSchema,
      feedUpdatedAt: IsoDateSchema.nullable(),
      stale: z.boolean(),
      warning: z.string().max(300).nullable(),
    })
    .strict(),
  meta: ResponseMetaSchema.extend({
    cacheStatus: z.enum(["hit", "miss"]),
  }).strict(),
}).strict();

export type WorldRefreshResponse = z.infer<typeof WorldRefreshResponseSchema>;

export const WorldClassificationGroupSchema = z
  .object({
    existingEventId: z.string().uuid().nullable(),
    canonicalTitle: z.string().min(1).max(180),
    summary: z.string().min(1).max(700),
    dimensions: WorldDimensionsSchema,
    headlines: z
      .array(
        z
          .object({
            headlineId: z.string().min(8).max(64),
            role: z.enum(["root", "supporting"]),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export const WorldClassificationModelOutputSchema = z
  .object({
    groups: z.array(WorldClassificationGroupSchema).max(12),
    standaloneHeadlineIds: z
      .array(z.string().min(8).max(64))
      .max(30),
  })
  .strict();

export type WorldClassificationModelOutput = z.infer<
  typeof WorldClassificationModelOutputSchema
>;
