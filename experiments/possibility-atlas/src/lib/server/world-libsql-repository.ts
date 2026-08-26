import type { Client, InStatement, Row } from "@libsql/client";
import { z } from "zod";

import {
  EventSnapshotSchema,
  HeadlineItemSchema,
  type EventSnapshot,
} from "../contracts";
import {
  RippleEdgeSchema,
  WorldCatalogMetadataSchema,
  WorldDimensionsSchema,
  WorldEventDetailResponseSchema,
  WorldEventsResponseSchema,
  WorldEventSummarySchema,
  type RippleEdge,
  type WorldEventSummary,
} from "../world-contracts";
import {
  WORLD_FIXTURE_EVENT_IDS,
  WORLD_FIXTURE_FEED_FINGERPRINT,
  WORLD_FIXTURE_SCAN_ID,
} from "./world-fixtures";
import {
  WORLD_EVENT_INACTIVE_MS,
  WORLD_EVENT_RETENTION_MS,
  isFeaturedWorldEvent,
  ripplePotentialForDimensions,
  type GenerationTemplateRecord,
  type RippleAnalysisCommit,
  type RippleAnalysisKey,
  type WorldClassificationCommit,
  type WorldRepository,
} from "./world-repository";

export const WORLD_DATABASE_MIGRATION = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS world_events (
  id TEXT PRIMARY KEY,
  canonical_title TEXT NOT NULL,
  summary TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('candidate', 'verified', 'inactive')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  impact INTEGER NOT NULL CHECK (impact BETWEEN 0 AND 3),
  branchability INTEGER NOT NULL CHECK (branchability BETWEEN 0 AND 3),
  connectivity INTEGER NOT NULL CHECK (connectivity BETWEEN 0 AND 3),
  uncertainty INTEGER NOT NULL CHECK (uncertainty BETWEEN 0 AND 3),
  ripple_potential TEXT NOT NULL CHECK (ripple_potential IN ('moderate', 'high', 'very_high')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  lead_headline_json TEXT NOT NULL,
  verified_snapshot_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_scans (
  id TEXT PRIMARY KEY,
  feed_fingerprint TEXT NOT NULL UNIQUE,
  catalog_version INTEGER NOT NULL UNIQUE CHECK (catalog_version >= 1),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  headline_count INTEGER NOT NULL CHECK (headline_count BETWEEN 0 AND 30),
  classification_json TEXT NOT NULL,
  scanned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS world_event_headlines (
  headline_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES world_events(id) ON DELETE CASCADE,
  headline_json TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('root', 'supporting')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_seen_scan_id TEXT NOT NULL REFERENCES world_scans(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_world_event_headlines_event
  ON world_event_headlines(event_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS generation_templates (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'expand', 'ripple')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ripple_analyses (
  graph_id TEXT NOT NULL,
  scenario_node_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES world_events(id) ON DELETE CASCADE,
  catalog_version INTEGER NOT NULL DEFAULT 0,
  analyzed_at TEXT NOT NULL,
  PRIMARY KEY (graph_id, scenario_node_id)
);

CREATE TABLE IF NOT EXISTS ripple_edges (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL REFERENCES world_events(id) ON DELETE CASCADE,
  source_scenario_node_id TEXT NOT NULL,
  target_event_id TEXT NOT NULL REFERENCES world_events(id) ON DELETE CASCADE,
  influence TEXT NOT NULL,
  strength TEXT NOT NULL,
  confidence TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  horizon TEXT NOT NULL,
  watch_for_json TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,
  UNIQUE (graph_id, source_scenario_node_id, target_event_id),
  FOREIGN KEY (graph_id, source_scenario_node_id)
    REFERENCES ripple_analyses(graph_id, scenario_node_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ripple_edges_source
  ON ripple_edges(source_event_id, analyzed_at DESC);

DELETE FROM world_event_headlines
WHERE headline_id IN (
  SELECT headline_id
  FROM (
    SELECT
      headline_id,
      ROW_NUMBER() OVER (
        PARTITION BY event_id
        ORDER BY last_seen_at DESC, first_seen_at DESC, headline_id ASC
      ) AS retained_position
    FROM world_event_headlines
  )
  WHERE retained_position > 120
);
DELETE FROM world_events
WHERE NOT EXISTS (
  SELECT 1 FROM world_event_headlines WHERE event_id = world_events.id
);
`;

const ClassificationCommitSchema = z
  .object({
    scanId: z.string().uuid(),
    feedFingerprint: z.string().length(64),
    scannedAt: z.string().datetime({ offset: true }),
    model: z.string().min(1).max(100),
    promptVersion: z.string().min(1).max(100),
    headlineCount: z.number().int().min(0).max(30),
    groups: z
      .array(
        z
          .object({
            eventId: z.string().uuid(),
            existingEventId: z.string().uuid().nullable(),
            canonicalTitle: z.string().min(1).max(180),
            summary: z.string().min(1).max(700),
            dimensions: WorldDimensionsSchema,
            headlines: z
              .array(
                z
                  .object({
                    headline: HeadlineItemSchema,
                    role: z.enum(["root", "supporting"]),
                  })
                  .strict(),
              )
              .min(1)
              .max(30),
          })
          .strict(),
      )
      .max(12),
    standaloneHeadlineIds: z.array(z.string().min(8).max(64)).max(30),
  })
  .strict();

function text(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid ${key} value.`);
  return value;
}

function number(row: Row, key: string) {
  const value = row[key];
  if (typeof value !== "number" && typeof value !== "bigint") {
    throw new Error(`Invalid ${key} value.`);
  }
  return Number(value);
}

function nullableText(row: Row, key: string) {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`Invalid ${key} value.`);
  return value;
}

function json(value: unknown) {
  return JSON.stringify(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function eventScore(event: WorldEventSummary) {
  return Object.values(event.dimensions).reduce<number>(
    (sum, value) => sum + value,
    0,
  );
}

function parseEdge(row: Row): RippleEdge {
  return RippleEdgeSchema.parse({
    id: text(row, "id"),
    sourceEventId: text(row, "source_event_id"),
    sourceScenarioNodeId: text(row, "source_scenario_node_id"),
    targetEventId: text(row, "target_event_id"),
    influence: text(row, "influence"),
    strength: text(row, "strength"),
    confidence: text(row, "confidence"),
    mechanism: text(row, "mechanism"),
    horizon: text(row, "horizon"),
    watchFor: parseJson(text(row, "watch_for_json")),
    analyzedAt: text(row, "analyzed_at"),
  });
}

export class LibsqlWorldRepository implements WorldRepository {
  private initialized: Promise<void> | null = null;

  constructor(private readonly client: Client) {}

  initialize() {
    this.initialized ??= this.runMigrations();
    return this.initialized;
  }

  private async runMigrations() {
    await this.client.executeMultiple(WORLD_DATABASE_MIGRATION);
    const columns = await this.client.execute("PRAGMA table_info(ripple_analyses)");
    if (!columns.rows.some((row) => row.name === "catalog_version")) {
      await this.client.execute(
        "ALTER TABLE ripple_analyses ADD COLUMN catalog_version INTEGER NOT NULL DEFAULT 0",
      );
    }
    const fixtureEventPlaceholders = WORLD_FIXTURE_EVENT_IDS.map(() => "?").join(
      ", ",
    );
    await this.client.batch(
      [
        {
          sql: `DELETE FROM world_events WHERE id IN (${fixtureEventPlaceholders})`,
          args: WORLD_FIXTURE_EVENT_IDS,
        },
        {
          sql: "DELETE FROM world_scans WHERE id = ? AND feed_fingerprint = ?",
          args: [WORLD_FIXTURE_SCAN_ID, WORLD_FIXTURE_FEED_FINGERPRINT],
        },
      ],
      "write",
    );
  }

  private async ensureInitialized() {
    await this.initialize();
  }

  async getCatalogMetadata() {
    await this.ensureInitialized();
    const result = await this.client.execute(
      "SELECT feed_fingerprint, catalog_version, scanned_at FROM world_scans ORDER BY catalog_version DESC LIMIT 1",
    );
    const row = result.rows[0];
    return WorldCatalogMetadataSchema.parse({
      catalogVersion: row ? number(row, "catalog_version") : 0,
      feedFingerprint: row ? text(row, "feed_fingerprint") : null,
      scannedAt: row ? text(row, "scanned_at") : null,
    });
  }

  private async loadEventSummaries(includeInactive: boolean) {
    await this.ensureInitialized();
    const eventResult = await this.client.execute({
      sql: `SELECT * FROM world_events ${includeInactive ? "" : "WHERE state <> 'inactive'"} ORDER BY last_seen_at DESC`,
      args: [],
    });
    if (eventResult.rows.length === 0) return [];
    const headlineResult = await this.client.execute(
      "SELECT event_id, headline_id FROM world_event_headlines ORDER BY last_seen_at DESC, first_seen_at DESC, headline_id ASC",
    );
    const headlineIds = new Map<string, string[]>();
    for (const row of headlineResult.rows) {
      const eventId = text(row, "event_id");
      const ids = headlineIds.get(eventId) ?? [];
      if (ids.length < 120) ids.push(text(row, "headline_id"));
      headlineIds.set(eventId, ids);
    }
    return eventResult.rows.map((row) =>
      WorldEventSummarySchema.parse({
        id: text(row, "id"),
        canonicalTitle: text(row, "canonical_title"),
        summary: text(row, "summary"),
        state: text(row, "state"),
        revision: number(row, "revision"),
        leadHeadline: parseJson(text(row, "lead_headline_json")),
        headlineIds: headlineIds.get(text(row, "id")) ?? [],
        firstSeenAt: text(row, "first_seen_at"),
        lastSeenAt: text(row, "last_seen_at"),
        ripplePotential: text(row, "ripple_potential"),
        dimensions: {
          impact: number(row, "impact"),
          branchability: number(row, "branchability"),
          connectivity: number(row, "connectivity"),
          uncertainty: number(row, "uncertainty"),
        },
      }),
    );
  }

  async getWorldEvent(id: string) {
    z.string().uuid().parse(id);
    return (await this.loadEventSummaries(true)).find((event) => event.id === id) ?? null;
  }

  async getWorldEventDetail(id: string) {
    const event = await this.getWorldEvent(id);
    if (!event) return null;
    const result = await this.client.execute({
      sql: "SELECT headline_json, role, first_seen_at, last_seen_at FROM world_event_headlines WHERE event_id = ? ORDER BY last_seen_at DESC, first_seen_at DESC, headline_id ASC LIMIT 120",
      args: [id],
    });
    const snapshotResult = await this.client.execute({
      sql: "SELECT verified_snapshot_json FROM world_events WHERE id = ?",
      args: [id],
    });
    const snapshotJson = snapshotResult.rows[0]
      ? nullableText(snapshotResult.rows[0], "verified_snapshot_json")
      : null;
    const parsed = WorldEventDetailResponseSchema.parse({
      ok: true,
      event,
      headlines: result.rows.map((row) => ({
        headline: parseJson(text(row, "headline_json")),
        role: text(row, "role"),
        firstSeenAt: text(row, "first_seen_at"),
        lastSeenAt: text(row, "last_seen_at"),
      })),
      verifiedSnapshot: snapshotJson ? parseJson(snapshotJson) : null,
    });
    return {
      event: parsed.event,
      headlines: parsed.headlines,
      verifiedSnapshot: parsed.verifiedSnapshot,
    };
  }

  async listMatchableEvents() {
    return this.loadEventSummaries(true);
  }

  async listEligibleTargetEvents(excludeEventId: string) {
    z.string().uuid().parse(excludeEventId);
    return (await this.loadEventSummaries(false))
      .filter((event) => event.id !== excludeEventId && isFeaturedWorldEvent(event))
      .sort(
        (left, right) =>
          eventScore(right) - eventScore(left) ||
          right.lastSeenAt.localeCompare(left.lastSeenAt),
      );
  }

  async getCatalogSnapshot() {
    const metadata = await this.getCatalogMetadata();
    const events = (await this.loadEventSummaries(false))
      .filter(isFeaturedWorldEvent)
      .sort(
        (left, right) =>
          eventScore(right) - eventScore(left) ||
          right.lastSeenAt.localeCompare(left.lastSeenAt),
      );
    const edgeResult = await this.client.execute(
      "SELECT * FROM ripple_edges ORDER BY analyzed_at DESC, id ASC",
    );
    const eventsById = new Map(events.map((event) => [event.id, event]));
    const crossCurrents = edgeResult.rows
      .map(parseEdge)
      .filter(
        (edge) =>
          eventsById.get(edge.sourceEventId)?.state === "verified" &&
          eventsById.has(edge.targetEventId),
      )
      .slice(0, 60);
    const counts = new Map<string, number>();
    for (const edge of crossCurrents) {
      counts.set(edge.sourceEventId, (counts.get(edge.sourceEventId) ?? 0) + 1);
    }
    const verified = events.filter((event) => event.state === "verified");
    const pressureSource = verified.length > 0 ? verified : events;

    let recentlyChanged: WorldEventSummary[] = [];
    if (metadata.catalogVersion > 0) {
      const latestScan = await this.client.execute(
        "SELECT id FROM world_scans ORDER BY catalog_version DESC LIMIT 1",
      );
      const scanId = latestScan.rows[0] ? text(latestScan.rows[0], "id") : null;
      if (scanId) {
        const changed = await this.client.execute({
          sql: "SELECT DISTINCT event_id FROM world_event_headlines WHERE first_seen_scan_id = ? AND role = 'supporting'",
          args: [scanId],
        });
        const changedIds = new Set(changed.rows.map((row) => text(row, "event_id")));
        recentlyChanged = events.filter((event) => changedIds.has(event.id));
      }
    }

    return WorldEventsResponseSchema.parse({
      ok: true,
      ...metadata,
      events,
      pressurePoints: pressureSource
        .map((event) => ({
          event,
          outboundRippleCount: counts.get(event.id) ?? 0,
        }))
        .sort(
          (left, right) =>
            right.outboundRippleCount - left.outboundRippleCount ||
            eventScore(right.event) - eventScore(left.event),
        )
        .slice(0, 12),
      crossCurrents,
      recentlyChanged: recentlyChanged.slice(0, 12),
    });
  }

  async commitClassification(rawCommit: WorldClassificationCommit) {
    await this.ensureInitialized();
    const commit = ClassificationCommitSchema.parse(rawCommit);
    const existingScan = await this.client.execute({
      sql: "SELECT id FROM world_scans WHERE feed_fingerprint = ? LIMIT 1",
      args: [commit.feedFingerprint],
    });
    if (existingScan.rows.length > 0) return;

    const metadata = await this.getCatalogMetadata();
    const existingEvents = new Map(
      (await this.loadEventSummaries(true)).map((event) => [event.id, event]),
    );
    const headlineResult = await this.client.execute(
      "SELECT headline_id, event_id, headline_json, role, first_seen_at, last_seen_at, first_seen_scan_id FROM world_event_headlines",
    );
    const priorHeadlines = new Map(
      headlineResult.rows.map((row) => [
        text(row, "headline_id"),
        {
          eventId: text(row, "event_id"),
          headline: HeadlineItemSchema.parse(
            parseJson(text(row, "headline_json")),
          ),
          role: text(row, "role"),
          firstSeenAt: text(row, "first_seen_at"),
          lastSeenAt: text(row, "last_seen_at"),
          firstSeenScanId: text(row, "first_seen_scan_id"),
        },
      ]),
    );

    const statements: InStatement[] = [
      {
        sql: "INSERT INTO world_scans (id, feed_fingerprint, catalog_version, model, prompt_version, headline_count, classification_json, scanned_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        args: [
          commit.scanId,
          commit.feedFingerprint,
          metadata.catalogVersion + 1,
          commit.model,
          commit.promptVersion,
          commit.headlineCount,
          json({
            groups: commit.groups.map((group) => ({
              eventId: group.eventId,
              existingEventId: group.existingEventId,
              headlineIds: group.headlines.map((item) => item.headline.id),
            })),
            standaloneHeadlineIds: commit.standaloneHeadlineIds,
          }),
          commit.scannedAt,
        ],
      },
    ];

    const assigned = new Set<string>();
    const incomingOwners = new Map<string, string>();
    for (const group of commit.groups) {
      for (const item of group.headlines) {
        incomingOwners.set(item.headline.id, group.eventId);
      }
    }
    const movedAwayEventIds = new Set<string>();
    for (const [headlineId, prior] of priorHeadlines) {
      const nextOwner = incomingOwners.get(headlineId);
      if (nextOwner && nextOwner !== prior.eventId) {
        movedAwayEventIds.add(prior.eventId);
      }
    }

    for (const group of commit.groups) {
      assigned.add(group.eventId);
      const prior = existingEvents.get(group.eventId);
      const lead =
        group.headlines.find((item) => item.role === "root")?.headline ??
        group.headlines[0]?.headline;
      if (!lead) throw new Error("A classified event requires a lead headline.");
      const newHeadline = group.headlines.some(
        (item) => priorHeadlines.get(item.headline.id)?.eventId !== group.eventId,
      );
      const roleChanged = group.headlines.some(
        (item) => {
          const priorHeadline = priorHeadlines.get(item.headline.id);
          return (
            priorHeadline?.eventId === group.eventId &&
            priorHeadline.role !== item.role
          );
        },
      );
      const leadChanged =
        Boolean(prior) &&
        (prior?.leadHeadline.id !== lead.id ||
          JSON.stringify(prior?.leadHeadline) !== JSON.stringify(lead));
      const changed =
        !prior ||
        newHeadline ||
        roleChanged ||
        leadChanged ||
        movedAwayEventIds.has(group.eventId) ||
        prior.canonicalTitle !== group.canonicalTitle ||
        prior.summary !== group.summary ||
        JSON.stringify(prior.dimensions) !== JSON.stringify(group.dimensions) ||
        prior.state === "inactive";
      const state =
        prior?.state === "verified" && !changed ? "verified" : "candidate";
      const revision = prior ? prior.revision + (changed ? 1 : 0) : 1;
      statements.push({
        sql: `INSERT INTO world_events
          (id, canonical_title, summary, state, revision, impact, branchability, connectivity, uncertainty, ripple_potential, first_seen_at, last_seen_at, lead_headline_json, verified_snapshot_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            canonical_title = excluded.canonical_title,
            summary = excluded.summary,
            state = excluded.state,
            revision = excluded.revision,
            impact = excluded.impact,
            branchability = excluded.branchability,
            connectivity = excluded.connectivity,
            uncertainty = excluded.uncertainty,
            ripple_potential = excluded.ripple_potential,
            last_seen_at = excluded.last_seen_at,
            lead_headline_json = excluded.lead_headline_json,
            updated_at = excluded.updated_at`,
        args: [
          group.eventId,
          group.canonicalTitle,
          group.summary,
          state,
          revision,
          group.dimensions.impact,
          group.dimensions.branchability,
          group.dimensions.connectivity,
          group.dimensions.uncertainty,
          ripplePotentialForDimensions(group.dimensions),
          prior?.firstSeenAt ?? commit.scannedAt,
          commit.scannedAt,
          json(lead),
          null,
          commit.scannedAt,
        ],
      });
      for (const item of group.headlines) {
        const existing = priorHeadlines.get(item.headline.id);
        statements.push({
          sql: `INSERT INTO world_event_headlines
            (headline_id, event_id, headline_json, role, first_seen_at, last_seen_at, first_seen_scan_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(headline_id) DO UPDATE SET
              event_id = excluded.event_id,
              headline_json = excluded.headline_json,
              role = excluded.role,
              last_seen_at = excluded.last_seen_at`,
          args: [
            item.headline.id,
            group.eventId,
            json(item.headline),
            item.role,
            existing?.firstSeenAt ?? commit.scannedAt,
            commit.scannedAt,
            existing?.firstSeenScanId ?? commit.scanId,
          ],
        });
      }
    }

    for (const eventId of movedAwayEventIds) {
      if (assigned.has(eventId)) continue;
      const priorEvent = existingEvents.get(eventId);
      if (!priorEvent) continue;
      const remaining = [...priorHeadlines.entries()]
        .filter(
          ([headlineId, item]) =>
            item.eventId === eventId &&
            (incomingOwners.get(headlineId) ?? eventId) === eventId,
        )
        .sort(
          ([leftId, left], [rightId, right]) =>
            right.lastSeenAt.localeCompare(left.lastSeenAt) ||
            right.firstSeenAt.localeCompare(left.firstSeenAt) ||
            leftId.localeCompare(rightId),
        );
      const replacement =
        remaining.find(
          ([headlineId]) => headlineId === priorEvent.leadHeadline.id,
        )?.[1] ??
        remaining.find(([, item]) => item.role === "root")?.[1] ??
        remaining[0]?.[1];
      if (replacement) {
        statements.push({
          sql: "UPDATE world_events SET state = 'candidate', revision = revision + 1, lead_headline_json = ?, updated_at = ? WHERE id = ?",
          args: [json(replacement.headline), commit.scannedAt, eventId],
        });
      }
    }

    statements.push({
      sql: `DELETE FROM world_event_headlines
        WHERE headline_id IN (
          SELECT headline_id
          FROM (
            SELECT
              headline_id,
              ROW_NUMBER() OVER (
                PARTITION BY event_id
                ORDER BY last_seen_at DESC, first_seen_at DESC, headline_id ASC
              ) AS retained_position
            FROM world_event_headlines
          )
          WHERE retained_position > 120
        )`,
      args: [],
    });
    statements.push({
      sql: "DELETE FROM world_events WHERE NOT EXISTS (SELECT 1 FROM world_event_headlines WHERE event_id = world_events.id)",
      args: [],
    });

    const inactiveBefore = new Date(
      Date.parse(commit.scannedAt) - WORLD_EVENT_INACTIVE_MS,
    ).toISOString();
    const deleteBefore = new Date(
      Date.parse(commit.scannedAt) - WORLD_EVENT_RETENTION_MS,
    ).toISOString();
    if (assigned.size > 0) {
      const placeholders = [...assigned].map(() => "?").join(", ");
      statements.push({
        sql: `UPDATE world_events SET state = 'inactive', revision = revision + 1, updated_at = ? WHERE id NOT IN (${placeholders}) AND last_seen_at <= ? AND state <> 'inactive'`,
        args: [commit.scannedAt, ...assigned, inactiveBefore],
      });
    } else {
      statements.push({
        sql: "UPDATE world_events SET state = 'inactive', revision = revision + 1, updated_at = ? WHERE last_seen_at <= ? AND state <> 'inactive'",
        args: [commit.scannedAt, inactiveBefore],
      });
    }
    statements.push({
      sql: "DELETE FROM world_events WHERE last_seen_at <= ?",
      args: [deleteBefore],
    });

    await this.client.batch(statements, "write");
  }

  async markEventVerified(eventId: string, snapshot: EventSnapshot) {
    await this.ensureInitialized();
    z.string().uuid().parse(eventId);
    const parsed = EventSnapshotSchema.parse(snapshot);
    const result = await this.client.execute({
      sql: "UPDATE world_events SET state = 'verified', verified_snapshot_json = ?, updated_at = ? WHERE id = ?",
      args: [json(parsed), parsed.capturedAt, eventId],
    });
    if (result.rowsAffected !== 1) throw new Error("Unknown world event.");
  }

  async getGenerationTemplate<T>(key: string, schema: z.ZodType<T>) {
    await this.ensureInitialized();
    const result = await this.client.execute({
      sql: "SELECT payload_json, created_at FROM generation_templates WHERE cache_key = ? LIMIT 1",
      args: [key],
    });
    const row = result.rows[0];
    if (!row) return null;
    let rawPayload: unknown;
    try {
      rawPayload = parseJson(text(row, "payload_json"));
    } catch {
      return null;
    }
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) return null;
    return { payload: parsed.data, createdAt: text(row, "created_at") };
  }

  async putGenerationTemplate<T>(
    rawRecord: GenerationTemplateRecord<T>,
    schema: z.ZodType<T>,
  ) {
    await this.ensureInitialized();
    const payload = schema.parse(rawRecord.payload);
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO generation_templates
        (cache_key, kind, model, prompt_version, source_fingerprint, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        rawRecord.key,
        rawRecord.kind,
        rawRecord.model,
        rawRecord.promptVersion,
        rawRecord.sourceFingerprint,
        json(payload),
        rawRecord.createdAt,
      ],
    });
    let stored = await this.getGenerationTemplate(rawRecord.key, schema);
    if (!stored) {
      await this.client.batch(
        [
          {
            sql: "DELETE FROM generation_templates WHERE cache_key = ?",
            args: [rawRecord.key],
          },
          {
            sql: `INSERT INTO generation_templates
              (cache_key, kind, model, prompt_version, source_fingerprint, payload_json, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [
              rawRecord.key,
              rawRecord.kind,
              rawRecord.model,
              rawRecord.promptVersion,
              rawRecord.sourceFingerprint,
              json(payload),
              rawRecord.createdAt,
            ],
          },
        ],
        "write",
      );
      stored = await this.getGenerationTemplate(rawRecord.key, schema);
    }
    if (!stored) throw new Error("The generation template could not be stored.");
    return stored;
  }

  async getRippleAnalysis(key: RippleAnalysisKey) {
    await this.ensureInitialized();
    z.string().uuid().parse(key.graphId);
    z.string().uuid().parse(key.scenarioNodeId);
    const completed = await this.client.execute({
      sql: "SELECT catalog_version FROM ripple_analyses WHERE graph_id = ? AND scenario_node_id = ? LIMIT 1",
      args: [key.graphId, key.scenarioNodeId],
    });
    if (completed.rows.length === 0) return null;
    if (
      key.catalogVersion !== undefined &&
      number(completed.rows[0]!, "catalog_version") !== key.catalogVersion
    ) {
      return null;
    }
    const result = await this.client.execute({
      sql: "SELECT * FROM ripple_edges WHERE graph_id = ? AND source_scenario_node_id = ? ORDER BY id ASC",
      args: [key.graphId, key.scenarioNodeId],
    });
    return result.rows.map(parseEdge);
  }

  async commitRippleAnalysis(rawCommit: RippleAnalysisCommit) {
    await this.ensureInitialized();
    const commit = {
      graphId: z.string().uuid().parse(rawCommit.graphId),
      scenarioNodeId: z.string().uuid().parse(rawCommit.scenarioNodeId),
      sourceEventId: z.string().uuid().parse(rawCommit.sourceEventId),
      catalogVersion: z.number().int().min(0).parse(rawCommit.catalogVersion),
      analyzedAt: z.string().datetime({ offset: true }).parse(rawCommit.analyzedAt),
      edges: z.array(RippleEdgeSchema).max(5).parse(rawCommit.edges),
    };
    if (
      commit.edges.some(
        (edge) =>
          edge.sourceEventId !== commit.sourceEventId ||
          edge.sourceScenarioNodeId !== commit.scenarioNodeId,
      )
    ) {
      throw new Error("Ripple edges do not match their analysis context.");
    }
    const existing = await this.getRippleAnalysis(commit);
    if (existing) return existing;
    const stale = await this.getRippleAnalysis({
      graphId: commit.graphId,
      scenarioNodeId: commit.scenarioNodeId,
    });
    const statements: InStatement[] = [
      ...(stale
        ? [
            {
              sql: "DELETE FROM ripple_analyses WHERE graph_id = ? AND scenario_node_id = ?",
              args: [commit.graphId, commit.scenarioNodeId],
            } satisfies InStatement,
          ]
        : []),
      {
        sql: "INSERT INTO ripple_analyses (graph_id, scenario_node_id, source_event_id, catalog_version, analyzed_at) VALUES (?, ?, ?, ?, ?)",
        args: [
          commit.graphId,
          commit.scenarioNodeId,
          commit.sourceEventId,
          commit.catalogVersion,
          commit.analyzedAt,
        ],
      },
      ...commit.edges.map(
        (edge): InStatement => ({
          sql: `INSERT INTO ripple_edges
            (id, graph_id, source_event_id, source_scenario_node_id, target_event_id, influence, strength, confidence, mechanism, horizon, watch_for_json, analyzed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            edge.id,
            commit.graphId,
            edge.sourceEventId,
            edge.sourceScenarioNodeId,
            edge.targetEventId,
            edge.influence,
            edge.strength,
            edge.confidence,
            edge.mechanism,
            edge.horizon,
            json(edge.watchFor),
            edge.analyzedAt,
          ],
        }),
      ),
    ];
    await this.client.batch(statements, "write");
    return (await this.getRippleAnalysis(commit)) ?? [];
  }
}
