import { mkdirSync } from "node:fs";
import path from "node:path";

import { createClient } from "@libsql/client";
import { z } from "zod";

import { AtlasApiError } from "./http";
import { MAX_ATLAS_CALLS } from "../contracts";
import { voiceDatabaseClient, type VoiceDatabaseClient } from "../../voice-database";

export const DEFAULT_GENERATION_DATABASE_URL =
  "file:./data/the-voice.db";
export const INSTALLATION_REQUEST_LIMIT = 20;
export const INSTALLATION_REQUEST_WINDOW_MS = 60 * 60 * 1_000;
export const REGISTERED_GRAPH_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const REGISTERED_GRAPH_PRUNE_BATCH_SIZE = 100;
export const INSUFFICIENT_EVIDENCE_CACHE_TTL_MS = 10 * 60 * 1_000;
const MAINTENANCE_LEASE_KEY = "maintenance:v1";
const MAINTENANCE_INTERVAL_MS = 5 * 60 * 1_000;

export type GenerationKind = "start" | "expand";

export type GenerationTemplateRecord<T> = {
  key: string;
  kind: GenerationKind;
  model: string;
  promptVersion: string;
  sourceFingerprint: string;
  payload: T;
  createdAt: string;
  expiresAt?: number | null;
};

export type StoredGenerationTemplate<T> = {
  payload: T;
  createdAt: string;
};

const MIGRATION = `
CREATE TABLE IF NOT EXISTS generation_templates (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'expand')),
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER
);

CREATE TABLE IF NOT EXISTS generation_leases (
  cache_key TEXT PRIMARY KEY,
  owner_token TEXT NOT NULL,
  lease_expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS generation_leases_by_expiry
  ON generation_leases (lease_expires_at);

CREATE TABLE IF NOT EXISTS atlas_call_usage (
  graph_id TEXT PRIMARY KEY,
  installation_key TEXT NOT NULL,
  calls_used INTEGER NOT NULL CHECK (calls_used >= 0 AND calls_used <= ${MAX_ATLAS_CALLS}),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS atlas_call_usage_by_updated
  ON atlas_call_usage (updated_at);

CREATE TABLE IF NOT EXISTS installation_generation_state (
  installation_key TEXT PRIMARY KEY,
  active_token TEXT,
  active_expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS installation_generation_state_by_updated
  ON installation_generation_state (updated_at);

CREATE TABLE IF NOT EXISTS installation_requests (
  installation_key TEXT NOT NULL,
  reservation_token TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  PRIMARY KEY (installation_key, reservation_token)
);

CREATE INDEX IF NOT EXISTS installation_requests_by_time
  ON installation_requests (installation_key, requested_at);

CREATE INDEX IF NOT EXISTS installation_requests_by_expiry
  ON installation_requests (requested_at);

CREATE TABLE IF NOT EXISTS registered_graphs (
  graph_id TEXT PRIMARY KEY,
  installation_fingerprint TEXT NOT NULL,
  headline_fingerprint TEXT NOT NULL,
  snapshot_fingerprint TEXT,
  state_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS registered_graphs_by_updated
  ON registered_graphs (updated_at);

CREATE TABLE IF NOT EXISTS voice_stories (
  installation_id TEXT NOT NULL,
  headline_id TEXT NOT NULL,
  graph_id TEXT NOT NULL,
  headline_json TEXT NOT NULL,
  focused_node_id TEXT,
  visited_nodes_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (installation_id, headline_id)
);

CREATE TABLE IF NOT EXISTS voice_selections (
  installation_id TEXT PRIMARY KEY,
  headline_id TEXT NOT NULL
);
`;

function configurationError(message: string) {
  return new AtlasApiError({
    code: "analysis_cache_misconfigured",
    message,
    status: 503,
    retryable: false,
    callConsumed: false,
  });
}

export function resolveGenerationDatabaseConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const url =
    environment.VOICE_DATABASE_URL?.trim() ||
    (environment.VERCEL === "1" && environment.VOICE_FIXTURE_MODE !== "1"
      ? environment.POSSIBILITY_ATLAS_DATABASE_URL?.trim() || environment.DATABASE_URL?.trim()
      : undefined) ||
    (environment.VOICE_FIXTURE_MODE === "1" ? "file:./data/the-voice-fixture.db" : DEFAULT_GENERATION_DATABASE_URL);

  if (url.startsWith("file:")) {
    if (environment.VERCEL === "1") throw configurationError("Hosted analysis requires a shared remote database.");
    if (!/^file:\.\/data\/[A-Za-z0-9._-]+\.db$/.test(url)) {
      throw configurationError("The local analysis cache path is invalid.");
    }
    return { url, authToken: undefined, local: true as const };
  }
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw configurationError("The analysis database URL is invalid."); }
  if (!["libsql:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
    throw configurationError("The analysis database URL is invalid.");
  }
  const authToken = environment.VOICE_DATABASE_AUTH_TOKEN?.trim() ||
    (environment.VERCEL === "1" ? environment.POSSIBILITY_ATLAS_DATABASE_AUTH_TOKEN?.trim() || environment.TURSO_AUTH_TOKEN?.trim() : undefined);
  if (!authToken) throw configurationError("The remote analysis database is not authenticated.");
  return { url, authToken, local: false as const };
}

function parseJson(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid cache payload.");
  return JSON.parse(value) as unknown;
}

function valueText(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid cache record.");
  return value;
}

export class GenerationCacheRepository {
  private initialized: Promise<void> | null = null;

  constructor(private readonly client: VoiceDatabaseClient) {}

  initialize() {
    this.initialized ??= this.migrate().catch((error) => {
      this.initialized = null;
      throw error;
    });
    return this.initialized;
  }

  private async migrate() {
    await this.client.executeMultiple(MIGRATION);
    const voiceColumns = await this.client.execute("PRAGMA table_info(voice_stories)");
    if (!voiceColumns.rows.some((row) => row.name === "visited_nodes_json")) {
      try {
        await this.client.execute("ALTER TABLE voice_stories ADD COLUMN visited_nodes_json TEXT NOT NULL DEFAULT '[]'");
      } catch (error) {
        const refreshed = await this.client.execute("PRAGMA table_info(voice_stories)");
        if (!refreshed.rows.some((row) => row.name === "visited_nodes_json")) throw error;
      }
    }
    const columns = await this.client.execute(
      "PRAGMA table_info(generation_templates)",
    );
    if (!columns.rows.some((row) => row.name === "expires_at")) {
      try {
        await this.client.execute(
          "ALTER TABLE generation_templates ADD COLUMN expires_at INTEGER",
        );
      } catch (error) {
        const refreshed = await this.client.execute(
          "PRAGMA table_info(generation_templates)",
        );
        if (!refreshed.rows.some((row) => row.name === "expires_at")) {
          throw error;
        }
      }
    }
    await this.client.execute(
      "CREATE INDEX IF NOT EXISTS generation_templates_by_expiry ON generation_templates (expires_at)",
    );
  }

  private async ready() {
    await this.initialize();
  }

  async get<T>(key: string, schema: z.ZodType<T>, now = Date.now()) {
    await this.ready();
    const result = await this.client.execute({
      sql: `SELECT payload_json, created_at, expires_at
        FROM generation_templates WHERE cache_key = ? LIMIT 1`,
      args: [key],
    });
    const row = result.rows[0];
    if (!row) return null;
    if (row.expires_at !== null && Number(row.expires_at) <= now) {
      await this.client.execute({
        sql: "DELETE FROM generation_templates WHERE cache_key = ? AND expires_at <= ?",
        args: [key, now],
      });
      return null;
    }
    try {
      const payload = schema.parse(parseJson(row.payload_json));
      return {
        payload,
        createdAt: valueText(row.created_at),
      } satisfies StoredGenerationTemplate<T>;
    } catch {
      await this.client.execute({
        sql: "DELETE FROM generation_templates WHERE cache_key = ?",
        args: [key],
      });
      return null;
    }
  }

  async put<T>(record: GenerationTemplateRecord<T>, schema: z.ZodType<T>) {
    await this.ready();
    const payload = schema.parse(record.payload);
    await this.client.execute({
      sql: `INSERT OR IGNORE INTO generation_templates
        (cache_key, kind, model, prompt_version, source_fingerprint, payload_json, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        record.key,
        record.kind,
        record.model,
        record.promptVersion,
        record.sourceFingerprint,
        JSON.stringify(payload),
        record.createdAt,
        record.expiresAt ?? null,
      ],
    });
    let stored = await this.get(record.key, schema);
    if (!stored) {
      await this.client.execute({
        sql: `INSERT OR IGNORE INTO generation_templates
          (cache_key, kind, model, prompt_version, source_fingerprint, payload_json, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          record.key,
          record.kind,
          record.model,
          record.promptVersion,
          record.sourceFingerprint,
          JSON.stringify(payload),
          record.createdAt,
          record.expiresAt ?? null,
        ],
      });
      stored = await this.get(record.key, schema);
    }
    if (!stored) throw new Error("The generation template could not be stored.");
    return stored;
  }

  async getRegisteredGraph(graphId: string) {
    await this.ready();
    const result = await this.client.execute({
      sql: `SELECT installation_fingerprint, headline_fingerprint,
        snapshot_fingerprint, state_json, version, updated_at
        FROM registered_graphs WHERE graph_id = ? LIMIT 1`,
      args: [graphId],
    });
    const row = result.rows[0];
    if (!row) return null;
    const version = Number(row.version);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error("Invalid registered graph version.");
    }
    const snapshotFingerprint = row.snapshot_fingerprint;
    if (
      snapshotFingerprint !== null &&
      typeof snapshotFingerprint !== "string"
    ) {
      throw new Error("Invalid registered graph snapshot.");
    }
    return {
      installationFingerprint: valueText(row.installation_fingerprint),
      headlineFingerprint: valueText(row.headline_fingerprint),
      snapshotFingerprint,
      state: parseJson(row.state_json),
      version,
      updatedAt: valueText(row.updated_at),
    };
  }

  async insertRegisteredGraph(input: {
    graphId: string;
    installationFingerprint: string;
    headlineFingerprint: string;
    snapshotFingerprint: string | null;
    state: unknown;
    version: number;
    updatedAt: string;
  }) {
    await this.ready();
    const result = await this.client.execute({
      sql: `INSERT OR IGNORE INTO registered_graphs
        (graph_id, installation_fingerprint, headline_fingerprint,
          snapshot_fingerprint, state_json, version, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.graphId,
        input.installationFingerprint,
        input.headlineFingerprint,
        input.snapshotFingerprint,
        JSON.stringify(input.state),
        input.version,
        input.updatedAt,
      ],
    });
    return result.rowsAffected === 1;
  }

  async compareAndSwapRegisteredGraph(input: {
    graphId: string;
    expectedVersion: number;
    snapshotFingerprint: string | null;
    state: unknown;
    updatedAt: string;
  }) {
    await this.ready();
    const result = await this.client.execute({
      sql: `UPDATE registered_graphs
        SET snapshot_fingerprint = ?, state_json = ?, version = version + 1,
            updated_at = ?
        WHERE graph_id = ? AND version = ?`,
      args: [
        input.snapshotFingerprint,
        JSON.stringify(input.state),
        input.updatedAt,
        input.graphId,
        input.expectedVersion,
      ],
    });
    return result.rowsAffected === 1;
  }

  async pruneRegisteredGraphs(input: {
    olderThan: string;
    limit?: number;
  }) {
    await this.ready();
    const limit = input.limit ?? REGISTERED_GRAPH_PRUNE_BATCH_SIZE;
    const results = await this.client.batch(
      [
        {
          sql: `DELETE FROM atlas_call_usage WHERE graph_id IN (
            SELECT graph_id FROM registered_graphs
            WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?
          )`,
          args: [input.olderThan, limit],
        },
        {
          sql: `DELETE FROM registered_graphs WHERE graph_id IN (
            SELECT graph_id FROM registered_graphs
            WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?
          )`,
          args: [input.olderThan, limit],
        },
      ],
      "write",
    );
    return results[1]?.rowsAffected ?? 0;
  }

  async runMaintenance(input: {
    ownerToken: string;
    now: number;
    graphOlderThan: string;
    stateOlderThan: number;
    graphLimit?: number;
  }) {
    const ownsLease = await this.acquireLease({
      key: MAINTENANCE_LEASE_KEY,
      ownerToken: input.ownerToken,
      now: input.now,
      ttlMs: MAINTENANCE_INTERVAL_MS,
    });
    if (!ownsLease) return { ran: false, graphsPruned: 0 };

    const graphLimit = input.graphLimit ?? REGISTERED_GRAPH_PRUNE_BATCH_SIZE;
    try {
      const results = await this.client.batch(
        [
          {
            sql: `DELETE FROM generation_templates
              WHERE expires_at IS NOT NULL AND expires_at <= ?`,
            args: [input.now],
          },
          {
            sql: `DELETE FROM installation_requests WHERE requested_at <= ?`,
            args: [input.now - INSTALLATION_REQUEST_WINDOW_MS],
          },
          {
            sql: `DELETE FROM generation_leases
              WHERE lease_expires_at <= ? AND cache_key <> ?`,
            args: [input.now, MAINTENANCE_LEASE_KEY],
          },
          {
            sql: `DELETE FROM installation_generation_state
              WHERE (active_token IS NULL AND updated_at < ?)
                OR (active_expires_at IS NOT NULL AND active_expires_at <= ?)`,
            args: [input.stateOlderThan, input.now],
          },
          {
            sql: `DELETE FROM atlas_call_usage
              WHERE updated_at < ? AND graph_id NOT IN (
                SELECT graph_id FROM registered_graphs
              )`,
            args: [input.graphOlderThan],
          },
          {
            sql: `DELETE FROM atlas_call_usage WHERE graph_id IN (
              SELECT graph_id FROM registered_graphs
              WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?
            )`,
            args: [input.graphOlderThan, graphLimit],
          },
          {
            sql: `DELETE FROM registered_graphs WHERE graph_id IN (
              SELECT graph_id FROM registered_graphs
              WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?
            )`,
            args: [input.graphOlderThan, graphLimit],
          },
        ],
        "write",
      );
      return { ran: true, graphsPruned: results[6]?.rowsAffected ?? 0 };
    } catch (error) {
      await this.releaseLease(MAINTENANCE_LEASE_KEY, input.ownerToken).catch(
        () => undefined,
      );
      throw error;
    }
  }

  async acquireLease(input: {
    key: string;
    ownerToken: string;
    now: number;
    ttlMs: number;
  }) {
    await this.ready();
    const result = await this.client.execute({
      sql: `INSERT INTO generation_leases (cache_key, owner_token, lease_expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          owner_token = excluded.owner_token,
          lease_expires_at = excluded.lease_expires_at
        WHERE generation_leases.lease_expires_at <= ?`,
      args: [
        input.key,
        input.ownerToken,
        input.now + input.ttlMs,
        input.now,
      ],
    });
    return result.rowsAffected === 1;
  }

  async releaseLease(key: string, ownerToken: string) {
    await this.ready();
    await this.client.execute({
      sql: "DELETE FROM generation_leases WHERE cache_key = ? AND owner_token = ?",
      args: [key, ownerToken],
    });
  }

  async hasHostedSession(installationId: string, now = Date.now()) {
    await this.ready();
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM generation_leases WHERE cache_key LIKE ? AND lease_expires_at > ? LIMIT 1',
      args: [`hosted-installation:${installationId}:%`, now],
    });
    return result.rows.length > 0;
  }

  async reserveInstallationGeneration(input: {
    installationKey: string;
    reservationToken: string;
    now: number;
    ttlMs: number;
  }) {
    await this.ready();
    const results = await this.client.batch(
      [
        {
          sql: `INSERT OR IGNORE INTO installation_generation_state
            (installation_key, active_token, active_expires_at, updated_at)
            VALUES (?, NULL, NULL, ?)`,
          args: [input.installationKey, input.now],
        },
        {
          sql: `UPDATE installation_generation_state
            SET active_token = ?, active_expires_at = ?, updated_at = ?
            WHERE installation_key = ?
              AND (active_token IS NULL OR active_expires_at <= ?)`,
          args: [
            input.reservationToken,
            input.now + input.ttlMs,
            input.now,
            input.installationKey,
            input.now,
          ],
        },
        {
          sql: `SELECT active_token, active_expires_at
            FROM installation_generation_state
            WHERE installation_key = ? LIMIT 1`,
          args: [input.installationKey],
        },
      ],
      "write",
    );

    const reserved = results[1]?.rowsAffected === 1;
    const state = results[2]?.rows[0];
    const activeExpiresAt = Number(state?.active_expires_at ?? input.now);

    return {
      reserved,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((activeExpiresAt - input.now) / 1_000),
      ),
    };
  }

  async reserveInstallationRequest(input: {
    installationKey: string;
    reservationToken: string;
    now: number;
    limit?: number;
    windowMs?: number;
  }) {
    await this.ready();
    const limit = input.limit ?? INSTALLATION_REQUEST_LIMIT;
    const windowMs = input.windowMs ?? INSTALLATION_REQUEST_WINDOW_MS;
    const windowStart = input.now - windowMs;
    const results = await this.client.batch(
      [
        {
          sql: `DELETE FROM installation_requests
            WHERE requested_at <= ?`,
          args: [windowStart],
        },
        {
          sql: `INSERT OR IGNORE INTO installation_requests
            (installation_key, reservation_token, requested_at)
            SELECT ?, ?, ? WHERE (
              SELECT COUNT(*) FROM installation_requests
              WHERE installation_key = ?
            ) < ?`,
          args: [
            input.installationKey,
            input.reservationToken,
            input.now,
            input.installationKey,
            limit,
          ],
        },
        {
          sql: `SELECT COUNT(*) AS requests_used, MIN(requested_at) AS oldest_request
            FROM installation_requests WHERE installation_key = ?`,
          args: [input.installationKey],
        },
      ],
      "write",
    );
    const reserved = results[1]?.rowsAffected === 1;
    const usage = results[2]?.rows[0];
    const requestsUsed = Number(usage?.requests_used ?? 0);
    const oldestRequest = Number(usage?.oldest_request ?? input.now);
    return {
      reserved,
      requestsUsed,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldestRequest + windowMs - input.now) / 1_000),
      ),
    };
  }

  async releaseInstallationGeneration(input: {
    installationKey: string;
    reservationToken: string;
    now: number;
  }) {
    await this.ready();
    await this.client.execute({
      sql: `UPDATE installation_generation_state
        SET active_token = NULL, active_expires_at = NULL, updated_at = ?
        WHERE installation_key = ? AND active_token = ?`,
      args: [input.now, input.installationKey, input.reservationToken],
    });
  }

  async reserveAtlasCall(input: {
    graphId: string;
    installationKey: string;
    now: string;
    limit?: number;
  }) {
    await this.ready();
    const limit = input.limit ?? MAX_ATLAS_CALLS;
    const results = await this.client.batch(
      [
        {
          sql: `INSERT OR IGNORE INTO atlas_call_usage
            (graph_id, installation_key, calls_used, updated_at)
            VALUES (?, ?, 0, ?)`,
          args: [input.graphId, input.installationKey, input.now],
        },
        {
          sql: `UPDATE atlas_call_usage
            SET calls_used = calls_used + 1, updated_at = ?
            WHERE graph_id = ? AND installation_key = ? AND calls_used < ?`,
          args: [
            input.now,
            input.graphId,
            input.installationKey,
            limit,
          ],
        },
        {
          sql: `SELECT installation_key, calls_used
            FROM atlas_call_usage WHERE graph_id = ? LIMIT 1`,
          args: [input.graphId],
        },
      ],
      "write",
    );
    const row = results[2]?.rows[0];
    const storedOwner = row?.installation_key;
    const callsUsed = Number(row?.calls_used ?? 0);
    return {
      ownerMatches: storedOwner === input.installationKey,
      reserved: results[1]?.rowsAffected === 1,
      callsUsed,
    };
  }

  async releaseAtlasCall(input: {
    graphId: string;
    installationKey: string;
    now: string;
  }) {
    await this.ready();
    await this.client.execute({
      sql: `UPDATE atlas_call_usage
        SET calls_used = CASE WHEN calls_used > 0 THEN calls_used - 1 ELSE 0 END,
            updated_at = ?
        WHERE graph_id = ? AND installation_key = ?`,
      args: [input.now, input.graphId, input.installationKey],
    });
  }

  close() {
    this.client.close();
  }

  async getVoiceStory(installationId: string, headlineId?: string) {
    await this.ready();
    const result = await this.client.execute({
      sql: headlineId
        ? "SELECT * FROM voice_stories WHERE installation_id = ? AND headline_id = ?"
        : `SELECT s.* FROM voice_stories s JOIN voice_selections v
          ON v.installation_id = s.installation_id AND v.headline_id = s.headline_id
          WHERE s.installation_id = ?`,
      args: headlineId ? [installationId, headlineId] : [installationId],
    });
    const row = result.rows[0];
    return row ? {
      headline: parseJson(row.headline_json),
      graphId: valueText(row.graph_id),
      focusedNodeId: row.focused_node_id === null ? null : valueText(row.focused_node_id),
      visitedNodeIds: parseJson(row.visited_nodes_json),
    } : null;
  }

  async saveVoiceStory(input: {
    installationId: string;
    headlineId: string;
    headline: unknown;
    graphId: string;
    focusedNodeId: string | null;
    visitedNodeIds: string[];
    selected: boolean;
  }) {
    await this.ready();
    await this.client.batch([
      {
        sql: `INSERT INTO voice_stories
          (installation_id, headline_id, graph_id, headline_json, focused_node_id, visited_nodes_json)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (installation_id, headline_id) DO UPDATE SET
          graph_id = excluded.graph_id, headline_json = excluded.headline_json,
          focused_node_id = excluded.focused_node_id, visited_nodes_json = excluded.visited_nodes_json`,
        args: [input.installationId, input.headlineId, input.graphId,
          JSON.stringify(input.headline), input.focusedNodeId, JSON.stringify(input.visitedNodeIds)],
      },
      ...(input.selected ? [{
        sql: `INSERT INTO voice_selections (installation_id, headline_id) VALUES (?, ?)
          ON CONFLICT (installation_id) DO UPDATE SET headline_id = excluded.headline_id`,
        args: [input.installationId, input.headlineId],
      }] : []),
    ], "write");
  }

  async getAtlasCallsUsed(graphId: string, installationKey: string) {
    await this.ready();
    const result = await this.client.execute({
      sql: "SELECT calls_used FROM atlas_call_usage WHERE graph_id = ? AND installation_key = ?",
      args: [graphId, installationKey],
    });
    return Number(result.rows[0]?.calls_used ?? 0);
  }
}

let repository: GenerationCacheRepository | null = null;

export function getGenerationCacheRepository() {
  if (repository) return repository;
  const config = resolveGenerationDatabaseConfig();
  if (config.local) {
    mkdirSync(path.resolve(process.cwd(), "data"), { recursive: true });
  }
  repository = new GenerationCacheRepository(
    voiceDatabaseClient(createClient({
      url: config.url,
      authToken: config.authToken,
      timeout: config.local ? 5_000 : undefined,
    }), !config.local),
  );
  return repository;
}

export function setGenerationCacheRepositoryForTests(
  next: GenerationCacheRepository | null,
) {
  repository = next;
}

export async function waitForGenerationTemplate<T>(input: {
  repository: GenerationCacheRepository;
  key: string;
  schema: z.ZodType<T>;
  timeoutMs?: number;
  intervalMs?: number;
  signal?: AbortSignal;
}) {
  const timeoutMs = input.timeoutMs ?? 25_000;
  const intervalMs = input.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const stored = await input.repository.get(input.key, input.schema);
    if (stored) return stored;
  }
  return null;
}
