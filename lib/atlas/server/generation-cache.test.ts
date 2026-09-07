import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@libsql/client";
import { z } from "zod";

import {
  GenerationCacheRepository,
} from "./generation-cache";

const PayloadSchema = z.object({ value: z.string() }).strict();

function createRepository() {
  return new GenerationCacheRepository(createClient({ url: "file::memory:" }));
}

test("generation cache persists one validated template across repositories", async () => {
  const client = createClient({ url: "file::memory:?cache=shared" });
  const first = new GenerationCacheRepository(client);
  await first.put(
    {
      key: "same-key",
      kind: "start",
      model: "gpt-5.6-luna",
      promptVersion: "start-v3-luna",
      sourceFingerprint: "source",
      payload: { value: "first" },
      createdAt: "2026-08-31T12:00:00.000Z",
    },
    PayloadSchema,
  );
  const second = new GenerationCacheRepository(client);
  assert.deepEqual(await second.get("same-key", PayloadSchema), {
    payload: { value: "first" },
    createdAt: "2026-08-31T12:00:00.000Z",
  });
  client.close();
});

test("generation cache insert is first-writer-wins", async () => {
  const repository = createRepository();
  const record = {
    key: "one-key",
    kind: "expand" as const,
    model: "gpt-5.6-luna",
    promptVersion: "expand-v3-luna",
    sourceFingerprint: "source",
    createdAt: "2026-08-31T12:00:00.000Z",
  };
  await repository.put({ ...record, payload: { value: "first" } }, PayloadSchema);
  const stored = await repository.put(
    {
      ...record,
      payload: { value: "second" },
      createdAt: "2026-08-31T12:01:00.000Z",
    },
    PayloadSchema,
  );
  assert.deepEqual(stored, {
    payload: { value: "first" },
    createdAt: "2026-08-31T12:00:00.000Z",
  });
  repository.close();
});

test("generation lease allows one owner until expiry", async () => {
  const repository = createRepository();
  assert.equal(
    await repository.acquireLease({
      key: "lease-key",
      ownerToken: "owner-a",
      now: 1_000,
      ttlMs: 500,
    }),
    true,
  );
  assert.equal(
    await repository.acquireLease({
      key: "lease-key",
      ownerToken: "owner-b",
      now: 1_100,
      ttlMs: 500,
    }),
    false,
  );
  assert.equal(
    await repository.acquireLease({
      key: "lease-key",
      ownerToken: "owner-b",
      now: 1_500,
      ttlMs: 500,
    }),
    true,
  );
  repository.close();
});

test("atlas calls are capped durably and scoped to one installation", async () => {
  const repository = createRepository();
  for (let index = 0; index < 2; index += 1) {
    const result = await repository.reserveAtlasCall({
      graphId: "20000000-0000-4000-8000-000000000001",
      installationKey: "installation-a",
      now: `2026-08-31T12:00:0${index}.000Z`,
      limit: 2,
    });
    assert.equal(result.reserved, true);
    assert.equal(result.callsUsed, index + 1);
  }
  const exhausted = await repository.reserveAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000001",
    installationKey: "installation-a",
    now: "2026-08-31T12:00:03.000Z",
    limit: 2,
  });
  assert.equal(exhausted.reserved, false);
  assert.equal(exhausted.callsUsed, 2);

  const conflict = await repository.reserveAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000001",
    installationKey: "installation-b",
    now: "2026-08-31T12:00:04.000Z",
    limit: 2,
  });
  assert.equal(conflict.ownerMatches, false);
  assert.equal(conflict.reserved, false);

  await repository.releaseAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000001",
    installationKey: "installation-a",
    now: "2026-08-31T12:00:05.000Z",
  });
  const resumed = await repository.reserveAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000001",
    installationKey: "installation-a",
    now: "2026-08-31T12:00:06.000Z",
    limit: 2,
  });
  assert.equal(resumed.reserved, true);
  assert.equal(resumed.callsUsed, 2);
  repository.close();
});

test("installation generation guard allows only one durable active miss", async () => {
  const repository = createRepository();
  const first = await repository.reserveInstallationGeneration({
    installationKey: "installation-a",
    reservationToken: "request-a",
    now: 1_000,
    ttlMs: 5_000,
  });
  assert.equal(first.reserved, true);

  const concurrent = await repository.reserveInstallationGeneration({
    installationKey: "installation-a",
    reservationToken: "request-b",
    now: 1_100,
    ttlMs: 5_000,
  });
  assert.equal(concurrent.reserved, false);

  await repository.releaseInstallationGeneration({
    installationKey: "installation-a",
    reservationToken: "request-a",
    now: 1_200,
  });
  const second = await repository.reserveInstallationGeneration({
    installationKey: "installation-a",
    reservationToken: "request-c",
    now: 1_300,
    ttlMs: 5_000,
  });
  assert.equal(second.reserved, true);

  const otherInstallation = await repository.reserveInstallationGeneration({
    installationKey: "installation-b",
    reservationToken: "request-e",
    now: 1_500,
    ttlMs: 5_000,
  });
  assert.equal(otherInstallation.reserved, true);
  repository.close();
});

test("the durable request limit covers cache hits without consuming model budget", async () => {
  const repository = createRepository();
  await repository.put(
    {
      key: "cache-hit",
      kind: "start",
      model: "gpt-5.6-luna",
      promptVersion: "start-v3-luna",
      sourceFingerprint: "source",
      payload: { value: "cached" },
      createdAt: "2026-08-31T12:00:00.000Z",
    },
    PayloadSchema,
  );
  assert.ok(await repository.get("cache-hit", PayloadSchema));

  const cacheHitRequest = await repository.reserveInstallationRequest({
    installationKey: "installation-a",
    reservationToken: "cache-hit-request",
    now: 1_000,
    limit: 1,
  });
  assert.equal(cacheHitRequest.reserved, true);
  assert.equal(cacheHitRequest.requestsUsed, 1);
  const rateLimited = await repository.reserveInstallationRequest({
    installationKey: "installation-a",
    reservationToken: "next-request",
    now: 1_100,
    limit: 1,
  });
  assert.equal(rateLimited.reserved, false);
  assert.equal(rateLimited.requestsUsed, 1);

  const firstModelCall = await repository.reserveAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000010",
    installationKey: "installation-a",
    now: "2026-08-31T12:00:00.000Z",
    limit: 1,
  });
  assert.equal(firstModelCall.reserved, true);
  assert.equal(firstModelCall.callsUsed, 1);
  repository.close();
});

test("the twenty-first durable request in an hour is rejected", async () => {
  const repository = createRepository();
  for (let index = 0; index < 20; index += 1) {
    const result = await repository.reserveInstallationRequest({
      installationKey: "installation-a",
      reservationToken: `request-${index}`,
      now: 1_000 + index,
    });
    assert.equal(result.reserved, true);
  }
  const exhausted = await repository.reserveInstallationRequest({
    installationKey: "installation-a",
    reservationToken: "request-20",
    now: 2_000,
  });
  assert.equal(exhausted.reserved, false);
  assert.equal(exhausted.requestsUsed, 20);

  const nextWindow = await repository.reserveInstallationRequest({
    installationKey: "installation-a",
    reservationToken: "request-next-window",
    now: 1_000 + 60 * 60 * 1_000,
  });
  assert.equal(nextWindow.reserved, true);
  assert.equal(nextWindow.requestsUsed, 20);
  repository.close();
});

test("expired negative templates become misses while positive templates persist", async () => {
  const repository = createRepository();
  const record = {
    key: "negative",
    kind: "start" as const,
    model: "gpt-5.6-luna",
    promptVersion: "start-v3-luna",
    sourceFingerprint: "source",
    payload: { value: "insufficient" },
    createdAt: "2026-08-31T12:00:00.000Z",
    expiresAt: 2_000_000_000_000,
  };
  await repository.put(record, PayloadSchema);
  assert.ok(
    await repository.get("negative", PayloadSchema, 1_999_999_999_999),
  );
  assert.equal(
    await repository.get("negative", PayloadSchema, 2_000_000_000_000),
    null,
  );

  await repository.put(
    {
      ...record,
      payload: { value: "verified" },
      expiresAt: null,
    },
    PayloadSchema,
  );
  assert.ok(await repository.get("negative", PayloadSchema, 10_000));
  repository.close();
});

test("registered graph pruning is bounded and preserves generation templates", async () => {
  const repository = createRepository();
  const graph = (graphId: string, updatedAt: string) =>
    repository.insertRegisteredGraph({
      graphId,
      installationFingerprint: "installation",
      headlineFingerprint: "headline",
      snapshotFingerprint: null,
      state: {},
      version: 1,
      updatedAt,
    });
  await graph(
    "20000000-0000-4000-8000-000000000011",
    "2026-01-01T00:00:00.000Z",
  );
  await graph(
    "20000000-0000-4000-8000-000000000012",
    "2026-02-01T00:00:00.000Z",
  );
  await graph(
    "20000000-0000-4000-8000-000000000013",
    "2026-08-01T00:00:00.000Z",
  );
  await repository.put(
    {
      key: "permanent-template",
      kind: "start",
      model: "gpt-5.6-luna",
      promptVersion: "start-v3-luna",
      sourceFingerprint: "source",
      payload: { value: "saved" },
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    PayloadSchema,
  );

  assert.equal(
    await repository.pruneRegisteredGraphs({
      olderThan: "2026-06-01T00:00:00.000Z",
      limit: 1,
    }),
    1,
  );
  assert.equal(
    await repository.getRegisteredGraph(
      "20000000-0000-4000-8000-000000000011",
    ),
    null,
  );
  assert.ok(
    await repository.getRegisteredGraph(
      "20000000-0000-4000-8000-000000000012",
    ),
  );
  assert.ok(
    await repository.getRegisteredGraph(
      "20000000-0000-4000-8000-000000000013",
    ),
  );
  assert.ok(await repository.get("permanent-template", PayloadSchema));
  repository.close();
});

test("periodic maintenance clears expired operational rows", async () => {
  const client = createClient({ url: "file::memory:" });
  const repository = new GenerationCacheRepository(client);
  const now = Date.now();
  await repository.put(
    {
      key: "expired-negative",
      kind: "start",
      model: "gpt-5.6-luna",
      promptVersion: "start-v3-luna",
      sourceFingerprint: "source",
      payload: { value: "temporary" },
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: now + 1_000,
    },
    PayloadSchema,
  );
  await repository.acquireLease({
    key: "expired-generation",
    ownerToken: "old-owner",
    now: now - 2_000,
    ttlMs: 1,
  });
  await repository.reserveInstallationGeneration({
    installationKey: "inactive-installation",
    reservationToken: "old-generation",
    now: now - 2_000,
    ttlMs: 1,
  });
  await repository.reserveAtlasCall({
    graphId: "20000000-0000-4000-8000-000000000099",
    installationKey: "inactive-installation",
    now: "2026-01-01T00:00:00.000Z",
  });

  const maintenance = await repository.runMaintenance({
    ownerToken: "maintenance-owner",
    now: now + 2_000,
    graphOlderThan: "2026-06-01T00:00:00.000Z",
    stateOlderThan: now - 1_000,
  });
  assert.equal(maintenance.ran, true);
  assert.equal(
    await repository.get("expired-negative", PayloadSchema, now + 2_000),
    null,
  );
  const leases = await client.execute(
    "SELECT cache_key FROM generation_leases WHERE cache_key = 'expired-generation'",
  );
  assert.equal(leases.rows.length, 0);
  const states = await client.execute(
    "SELECT installation_key FROM installation_generation_state WHERE installation_key = 'inactive-installation'",
  );
  assert.equal(states.rows.length, 0);
  const orphanedUsage = await client.execute(
    "SELECT graph_id FROM atlas_call_usage WHERE graph_id = '20000000-0000-4000-8000-000000000099'",
  );
  assert.equal(orphanedUsage.rows.length, 0);
  assert.equal(
    (
      await repository.runMaintenance({
        ownerToken: "maintenance-owner-2",
        now: now + 2_001,
        graphOlderThan: "2026-06-01T00:00:00.000Z",
        stateOlderThan: now - 1_000,
      })
    ).ran,
    false,
  );
  repository.close();
});

test("initialization adds template expiry to a pre-expiry schema", async () => {
  const client = createClient({ url: "file::memory:" });
  await client.execute(`CREATE TABLE generation_templates (
    cache_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    source_fingerprint TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  const repository = new GenerationCacheRepository(client);
  await repository.initialize();
  const columns = await client.execute(
    "PRAGMA table_info(generation_templates)",
  );
  assert.ok(columns.rows.some((row) => row.name === "expires_at"));
  repository.close();
});


