import { z } from "zod";

import {
  EventSnapshotSchema,
  HeadlineItemSchema,
  type EventSnapshot,
  type HeadlineItem,
} from "../contracts";
import {
  RippleEdgeSchema,
  WorldCatalogMetadataSchema,
  WorldEventDetailResponseSchema,
  WorldEventsResponseSchema,
  WorldEventSummarySchema,
  type RippleEdge,
  type WorldCatalogMetadata,
  type WorldEventHeadline,
  type WorldEventsResponse,
  type WorldEventSummary,
} from "../world-contracts";

export const WORLD_EVENT_INACTIVE_MS = 14 * 24 * 60 * 60 * 1_000;
export const WORLD_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export type MaterializedWorldGroup = {
  eventId: string;
  existingEventId: string | null;
  canonicalTitle: string;
  summary: string;
  dimensions: WorldEventSummary["dimensions"];
  headlines: Array<{ headline: HeadlineItem; role: "root" | "supporting" }>;
};

export type WorldClassificationCommit = {
  scanId: string;
  feedFingerprint: string;
  scannedAt: string;
  model: string;
  promptVersion: string;
  headlineCount: number;
  groups: MaterializedWorldGroup[];
  standaloneHeadlineIds: string[];
};

export type GenerationTemplateKind = "start" | "expand" | "ripple";

export type GenerationTemplateRecord<T> = {
  key: string;
  kind: GenerationTemplateKind;
  model: string;
  promptVersion: string;
  sourceFingerprint: string;
  payload: T;
  createdAt: string;
};

export type RippleAnalysisKey = {
  graphId: string;
  scenarioNodeId: string;
  catalogVersion?: number;
};

export type RippleAnalysisCommit = RippleAnalysisKey & {
  sourceEventId: string;
  edges: RippleEdge[];
  analyzedAt: string;
  catalogVersion: number;
};

export interface WorldRepository {
  initialize(): Promise<void>;
  getCatalogMetadata(): Promise<WorldCatalogMetadata>;
  getCatalogSnapshot(): Promise<WorldEventsResponse>;
  getWorldEvent(id: string): Promise<WorldEventSummary | null>;
  getWorldEventDetail(id: string): Promise<{
    event: WorldEventSummary;
    headlines: WorldEventHeadline[];
    verifiedSnapshot: EventSnapshot | null;
  } | null>;
  listMatchableEvents(): Promise<WorldEventSummary[]>;
  listEligibleTargetEvents(excludeEventId: string): Promise<WorldEventSummary[]>;
  commitClassification(commit: WorldClassificationCommit): Promise<void>;
  markEventVerified(eventId: string, snapshot: EventSnapshot): Promise<void>;
  getGenerationTemplate<T>(
    key: string,
    schema: z.ZodType<T>,
  ): Promise<{ payload: T; createdAt: string } | null>;
  putGenerationTemplate<T>(
    record: GenerationTemplateRecord<T>,
    schema: z.ZodType<T>,
  ): Promise<{ payload: T; createdAt: string }>;
  getRippleAnalysis(key: RippleAnalysisKey): Promise<RippleEdge[] | null>;
  commitRippleAnalysis(commit: RippleAnalysisCommit): Promise<RippleEdge[]>;
}

function score(event: WorldEventSummary) {
  return Object.values(event.dimensions).reduce<number>(
    (total, value) => total + value,
    0,
  );
}

export function isFeaturedWorldEvent(event: WorldEventSummary) {
  return (
    event.state !== "inactive" &&
    event.dimensions.impact >= 1 &&
    event.dimensions.branchability >= 2 &&
    score(event) >= 7
  );
}

export function ripplePotentialForDimensions(
  dimensions: WorldEventSummary["dimensions"],
): WorldEventSummary["ripplePotential"] {
  const total = Object.values(dimensions).reduce<number>(
    (sum, current) => sum + current,
    0,
  );
  if (total >= 11) return "very_high";
  if (total >= 9) return "high";
  return "moderate";
}

type MemoryHeadline = WorldEventHeadline & {
  firstSeenScanId: string;
};

type MemoryEvent = {
  summary: WorldEventSummary;
  headlines: Map<string, MemoryHeadline>;
  verifiedSnapshot: EventSnapshot | null;
};

export function createMemoryWorldRepository(): WorldRepository {
  const events = new Map<string, MemoryEvent>();
  const scans: WorldClassificationCommit[] = [];
  const templates = new Map<string, GenerationTemplateRecord<unknown>>();
  const analyses = new Map<
    string,
    { edges: RippleEdge[]; catalogVersion: number }
  >();

  const analysisKey = (key: RippleAnalysisKey) =>
    `${key.graphId}\0${key.scenarioNodeId}`;

  function currentMetadata(): WorldCatalogMetadata {
    const scan = scans.at(-1);
    return WorldCatalogMetadataSchema.parse({
      catalogVersion: scans.length,
      feedFingerprint: scan?.feedFingerprint ?? null,
      scannedAt: scan?.scannedAt ?? null,
    });
  }

  function sortedFeatured() {
    return [...events.values()]
      .map((entry) => entry.summary)
      .filter(isFeaturedWorldEvent)
      .sort(
        (left, right) =>
          score(right) - score(left) ||
          right.lastSeenAt.localeCompare(left.lastSeenAt),
      );
  }

  return {
    async initialize() {},

    async getCatalogMetadata() {
      return currentMetadata();
    },

    async getCatalogSnapshot() {
      const metadata = currentMetadata();
      const featured = sortedFeatured();
      const featuredById = new Map(featured.map((event) => [event.id, event]));
      const allEdges = [...analyses.values()]
        .flatMap((analysis) => analysis.edges)
        .filter(
          (edge) =>
            featuredById.get(edge.sourceEventId)?.state === "verified" &&
            featuredById.has(edge.targetEventId),
        );
      const counts = new Map<string, number>();
      for (const edge of allEdges) {
        counts.set(edge.sourceEventId, (counts.get(edge.sourceEventId) ?? 0) + 1);
      }
      const verified = featured.filter((event) => event.state === "verified");
      const pressureSource = verified.length > 0 ? verified : featured;
      const latestScan = scans.at(-1);
      const recentlyChanged = latestScan
        ? featured.filter((event) => {
            const stored = events.get(event.id);
            return [...(stored?.headlines.values() ?? [])].some(
              (item) =>
                item.role === "supporting" &&
                item.firstSeenScanId === latestScan.scanId,
            );
          })
        : [];
      return WorldEventsResponseSchema.parse({
        ok: true,
        ...metadata,
        events: featured,
        pressurePoints: pressureSource
          .map((event) => ({
            event,
            outboundRippleCount: counts.get(event.id) ?? 0,
          }))
          .sort(
            (left, right) =>
              right.outboundRippleCount - left.outboundRippleCount ||
              score(right.event) - score(left.event),
          )
          .slice(0, 12),
        crossCurrents: allEdges
          .sort((left, right) => right.analyzedAt.localeCompare(left.analyzedAt))
          .slice(0, 60),
        recentlyChanged: recentlyChanged.slice(0, 12),
      });
    },

    async getWorldEvent(id) {
      return events.get(id)?.summary ?? null;
    },

    async getWorldEventDetail(id) {
      const stored = events.get(id);
      if (!stored) return null;
      const parsed = WorldEventDetailResponseSchema.parse({
        ok: true,
        event: stored.summary,
        headlines: [...stored.headlines.values()].map((item) => ({
          headline: item.headline,
          role: item.role,
          firstSeenAt: item.firstSeenAt,
          lastSeenAt: item.lastSeenAt,
        })),
        verifiedSnapshot: stored.verifiedSnapshot,
      });
      return {
        event: parsed.event,
        headlines: parsed.headlines,
        verifiedSnapshot: parsed.verifiedSnapshot,
      };
    },

    async listMatchableEvents() {
      return [...events.values()]
        .map((entry) => entry.summary)
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
    },

    async listEligibleTargetEvents(excludeEventId) {
      return sortedFeatured().filter((event) => event.id !== excludeEventId);
    },

    async commitClassification(commit) {
      if (scans.some((scan) => scan.feedFingerprint === commit.feedFingerprint)) {
        return;
      }
      const atMs = Date.parse(commit.scannedAt);
      const assigned = new Set(commit.groups.map((group) => group.eventId));
      const incomingOwners = new Map<string, string>();
      for (const group of commit.groups) {
        for (const item of group.headlines) {
          incomingOwners.set(item.headline.id, group.eventId);
        }
      }
      const movedAwayEventIds = new Set<string>();
      for (const [eventId, stored] of events) {
        for (const [headlineId] of stored.headlines) {
          const nextOwner = incomingOwners.get(headlineId);
          if (nextOwner && nextOwner !== eventId) {
            stored.headlines.delete(headlineId);
            movedAwayEventIds.add(eventId);
          }
        }
      }

      for (const group of commit.groups) {
        const prior = events.get(group.eventId);
        const lead =
          group.headlines.find((item) => item.role === "root")?.headline ??
          group.headlines[0]?.headline;
        if (!lead) throw new Error("A classified event requires a lead headline.");

        const priorRoles = new Map(
          [...(prior?.headlines.values() ?? [])].map((item) => [
            item.headline.id,
            item.role,
          ]),
        );
        const newHeadline = group.headlines.some(
          (item) => !prior?.headlines.has(item.headline.id),
        );
        const roleChanged = group.headlines.some(
          (item) =>
            priorRoles.has(item.headline.id) &&
            priorRoles.get(item.headline.id) !== item.role,
        );
        const leadChanged = prior
          ? prior.summary.leadHeadline.id !== lead.id ||
            JSON.stringify(prior.summary.leadHeadline) !== JSON.stringify(lead)
          : false;
        const changed =
          !prior ||
          newHeadline ||
          roleChanged ||
          leadChanged ||
          movedAwayEventIds.has(group.eventId) ||
          prior.summary.canonicalTitle !== group.canonicalTitle ||
          prior.summary.summary !== group.summary ||
          JSON.stringify(prior.summary.dimensions) !==
            JSON.stringify(group.dimensions) ||
          prior.summary.state === "inactive";
        const headlines = prior?.headlines ?? new Map<string, MemoryHeadline>();
        for (const item of group.headlines) {
          const existing = headlines.get(item.headline.id);
          headlines.set(item.headline.id, {
            headline: HeadlineItemSchema.parse(item.headline),
            role: item.role,
            firstSeenAt: existing?.firstSeenAt ?? commit.scannedAt,
            lastSeenAt: commit.scannedAt,
            firstSeenScanId: existing?.firstSeenScanId ?? commit.scanId,
          });
        }
        const retainedHeadlines = new Map(
          [...headlines.entries()]
            .sort(
              ([leftId, left], [rightId, right]) =>
                right.lastSeenAt.localeCompare(left.lastSeenAt) ||
                right.firstSeenAt.localeCompare(left.firstSeenAt) ||
                leftId.localeCompare(rightId),
            )
            .slice(0, 120),
        );
        const summary = WorldEventSummarySchema.parse({
          id: group.eventId,
          canonicalTitle: group.canonicalTitle,
          summary: group.summary,
          state:
            prior?.summary.state === "verified" && !changed
              ? "verified"
              : "candidate",
          revision: prior ? prior.summary.revision + (changed ? 1 : 0) : 1,
          leadHeadline: lead,
          headlineIds: [...retainedHeadlines.keys()],
          firstSeenAt: prior?.summary.firstSeenAt ?? commit.scannedAt,
          lastSeenAt: commit.scannedAt,
          ripplePotential: ripplePotentialForDimensions(group.dimensions),
          dimensions: group.dimensions,
        });
        events.set(group.eventId, {
          summary,
          headlines: retainedHeadlines,
          verifiedSnapshot: prior?.verifiedSnapshot ?? null,
        });
      }

      for (const [eventId, stored] of events) {
        if (stored.headlines.size === 0) {
          events.delete(eventId);
          continue;
        }
        if (!assigned.has(eventId) && movedAwayEventIds.has(eventId)) {
          const retainedLead = stored.headlines.get(
            stored.summary.leadHeadline.id,
          );
          const replacementLead =
            retainedLead?.headline ??
            [...stored.headlines.values()].find((item) => item.role === "root")
              ?.headline ??
            stored.headlines.values().next().value?.headline;
          if (!replacementLead) {
            events.delete(eventId);
            continue;
          }
          stored.summary = WorldEventSummarySchema.parse({
            ...stored.summary,
            state: "candidate",
            revision: stored.summary.revision + 1,
            leadHeadline: replacementLead,
            headlineIds: [...stored.headlines.keys()],
          });
        }
        if (assigned.has(eventId)) continue;
        const age = atMs - Date.parse(stored.summary.lastSeenAt);
        if (age >= WORLD_EVENT_RETENTION_MS) {
          events.delete(eventId);
        } else if (
          age >= WORLD_EVENT_INACTIVE_MS &&
          stored.summary.state !== "inactive"
        ) {
          stored.summary = WorldEventSummarySchema.parse({
            ...stored.summary,
            state: "inactive",
            revision: stored.summary.revision + 1,
          });
        }
      }
      scans.push(structuredClone(commit));
    },

    async markEventVerified(eventId, snapshot) {
      const stored = events.get(eventId);
      if (!stored) throw new Error("Unknown world event.");
      stored.verifiedSnapshot = EventSnapshotSchema.parse(snapshot);
      stored.summary = WorldEventSummarySchema.parse({
        ...stored.summary,
        state: "verified",
      });
    },

    async getGenerationTemplate(key, schema) {
      const record = templates.get(key);
      if (!record) return null;
      const result = schema.safeParse(record.payload);
      if (!result.success) return null;
      return { payload: result.data, createdAt: record.createdAt };
    },

    async putGenerationTemplate(record, schema) {
      const payload = schema.parse(record.payload);
      const existing = templates.get(record.key);
      if (existing) {
        return {
          payload: schema.parse(existing.payload),
          createdAt: existing.createdAt,
        };
      }
      templates.set(record.key, { ...record, payload });
      return { payload, createdAt: record.createdAt };
    },

    async getRippleAnalysis(key) {
      const value = analyses.get(analysisKey(key));
      if (!value ||
        (key.catalogVersion !== undefined &&
          value.catalogVersion !== key.catalogVersion)) {
        return null;
      }
      return z.array(RippleEdgeSchema).parse(value.edges);
    },

    async commitRippleAnalysis(commit) {
      const key = analysisKey(commit);
      const prior = analyses.get(key);
      if (prior?.catalogVersion === commit.catalogVersion) {
        return z.array(RippleEdgeSchema).parse(prior.edges);
      }
      const parsed = z.array(RippleEdgeSchema).max(5).parse(commit.edges);
      if (
        parsed.some(
          (edge) =>
            edge.sourceEventId !== commit.sourceEventId ||
            edge.sourceScenarioNodeId !== commit.scenarioNodeId,
        )
      ) {
        throw new Error("Ripple edges do not match their analysis context.");
      }
      analyses.set(key, {
        edges: parsed,
        catalogVersion: commit.catalogVersion,
      });
      return parsed;
    },
  };
}
