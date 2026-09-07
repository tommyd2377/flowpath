import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createClient } from "@libsql/client";

import type { ExpandAtlasResponse, StartAtlasResponse } from "../contracts";
import type { ExpandAtlasRequest } from "./branch";
import { createFixtureStartResponse } from "./fixtures";
import { GenerationCacheRepository } from "./generation-cache";
import {
  commitRegisteredExpansion,
  getRegisteredExpansionResponse,
  getRegisteredStartResponse,
  registerStartedGraph,
  resetRegisteredGraphsForTests,
  validateRegisteredExpansion,
} from "./graph-registry";
import { AtlasApiError } from "./http";
import { headlineFixture } from "./openai-test-fixtures";

const installationId = "10000000-0000-4000-8000-000000000001";
const graphId = "20000000-0000-4000-8000-000000000001";

test.beforeEach(() => resetRegisteredGraphsForTests());

async function registeredInput(
  repository: GenerationCacheRepository | null = null,
): Promise<ExpandAtlasRequest> {
  const startInput = { installationId, graphId, headline: headlineFixture };
  const start = createFixtureStartResponse(startInput);
  await registerStartedGraph(startInput, start, { repository });
  assert.equal(start.kind, "atlas");
  if (start.kind !== "atlas") throw new Error("Expected atlas fixture.");
  const parent = start.nodes[0];
  return {
    installationId,
    graphId,
    parentId: parent.id,
    snapshot: start.snapshot,
    lineage: [
      {
        id: parent.id,
        parentId: parent.parentId,
        depth: parent.depth,
        title: parent.title,
        summary: parent.summary,
        whyPlausible: parent.whyPlausible,
        keyAssumption: parent.keyAssumption,
        horizon: parent.horizon,
      },
    ],
    remainingNodeCapacity: 60,
  };
}

test("registered expansion rejects altered frozen evidence and capacity", async () => {
  const input = await registeredInput();
  assert.equal(
    (await validateRegisteredExpansion(input, { repository: null }))
      .remainingNodeCapacity,
    60,
  );

  await assert.rejects(
    () =>
      validateRegisteredExpansion({
        ...input,
        snapshot: { ...input.snapshot, summary: "Altered summary" },
      }, { repository: null }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "snapshot_mismatch",
  );
  await assert.rejects(
    () =>
      validateRegisteredExpansion(
        { ...input, remainingNodeCapacity: 59 },
        { repository: null },
      ),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "node_capacity_mismatch",
  );
});

test("a completed start response can be replayed without rebuilding the graph", async () => {
  const startInput = { installationId, graphId, headline: headlineFixture };
  const response = createFixtureStartResponse(startInput);
  await registerStartedGraph(startInput, response, { repository: null });
  assert.deepEqual(
    await getRegisteredStartResponse(startInput, { repository: null }),
    { ...response, meta: { ...response.meta, cacheStatus: "hit" } },
  );
});

test("insufficient evidence is not promoted to a long-lived graph replay", async () => {
  const client = createClient({ url: "file::memory:" });
  const repository = new GenerationCacheRepository(client);
  const startInput = { installationId, graphId, headline: headlineFixture };
  const response: StartAtlasResponse = {
    ok: true,
    kind: "insufficient_evidence",
    summary: "The developing report could not yet be verified.",
    reason: "Reliable current evidence was not available.",
    sources: [],
    meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
  };

  assert.deepEqual(
    await registerStartedGraph(startInput, response, { repository }),
    response,
  );
  assert.equal(
    await getRegisteredStartResponse(startInput, { repository }),
    null,
  );
  assert.equal(await repository.getRegisteredGraph(graphId), null);
  repository.close();
});

test("completed levels commit atomically and replay safely", async () => {
  const input = await registeredInput();
  const parentId = input.parentId;
  const response: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId,
    nodes: [1, 2, 3].map((index) => ({
      id: `30000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      parentId,
      depth: 2 as const,
      title: `Registered branch ${index}`,
      summary: "A registered downstream possibility.",
      whyPlausible: "It follows from the frozen evidence.",
      keyAssumption: "The current conditions continue.",
      watchFor: ["A confirming signal"],
      lessLikelyIf: "A contrary signal appears.",
      horizon: "Coming weeks",
      childIds: [],
      status: "ready" as const,
      errorMessage: null,
      leafReason: null,
    })),
    meta: { mode: "fixture", callConsumed: false, cacheStatus: "miss" },
  };

  assert.deepEqual(
    await commitRegisteredExpansion(input, "request-key", response, {
      repository: null,
    }),
    response,
  );
  assert.deepEqual(
    await getRegisteredExpansionResponse(input, "request-key", {
      repository: null,
    }),
    { ...response, meta: { ...response.meta, cacheStatus: "hit" } },
  );
  assert.deepEqual(
    await commitRegisteredExpansion(input, "request-key", response, {
      repository: null,
    }),
    { ...response, meta: { ...response.meta, cacheStatus: "hit" } },
  );
  await assert.rejects(
    () =>
      validateRegisteredExpansion({
        ...input,
        remainingNodeCapacity: 57,
      }, { repository: null }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "already_expanded",
  );
});

test("an invalid level adds no partial nodes", async () => {
  const input = await registeredInput();
  const valid = {
    id: "30000000-0000-4000-8000-000000000001",
    parentId: input.parentId,
    depth: 2 as const,
    title: "Valid-looking branch",
    summary: "A registered downstream possibility.",
    whyPlausible: "It follows from the frozen evidence.",
    keyAssumption: "The current conditions continue.",
    watchFor: ["A confirming signal"],
    lessLikelyIf: "A contrary signal appears.",
    horizon: "Coming weeks",
    childIds: [],
    status: "ready" as const,
    errorMessage: null,
    leafReason: null,
  };
  const invalid: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId: input.parentId,
    nodes: [
      valid,
      { ...valid, id: "30000000-0000-4000-8000-000000000002" },
      {
        ...valid,
        id: "30000000-0000-4000-8000-000000000003",
        parentId: graphId,
      },
    ],
    meta: { mode: "fixture", callConsumed: false, cacheStatus: "miss" },
  };

  await assert.rejects(() =>
    commitRegisteredExpansion(input, "invalid", invalid, {
      repository: null,
    }),
  );
  assert.equal(
    await getRegisteredExpansionResponse(input, "invalid", {
      repository: null,
    }),
    null,
  );
  await assert.doesNotReject(() =>
    validateRegisteredExpansion(input, { repository: null }),
  );
});

test("registered graphs and exact expansion replays survive a cold instance", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "possibility-atlas-graph-"));
  const databaseUrl = `file:${path.join(directory, "registry.db")}`;
  const firstClient = createClient({ url: databaseUrl });
  const secondClient = createClient({ url: databaseUrl });
  const firstRepository = new GenerationCacheRepository(firstClient);
  const secondRepository = new GenerationCacheRepository(secondClient);
  t.after(() => {
    firstRepository.close();
    secondRepository.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const startInput = { installationId, graphId, headline: headlineFixture };
  const start = createFixtureStartResponse(startInput);
  await registerStartedGraph(startInput, start, {
    repository: firstRepository,
  });
  resetRegisteredGraphsForTests();
  assert.deepEqual(
    await getRegisteredStartResponse(startInput, {
      repository: secondRepository,
    }),
    { ...start, meta: { ...start.meta, cacheStatus: "hit" } },
  );

  const input = await registeredInput(secondRepository);
  const parentId = input.parentId;
  const response: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId,
    nodes: [1, 2, 3].map((index) => ({
      id: `40000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      parentId,
      depth: 2 as const,
      title: `Durable branch ${index}`,
      summary: "A durable downstream possibility.",
      whyPlausible: "It follows from the frozen evidence.",
      keyAssumption: "The current conditions continue.",
      watchFor: ["A confirming signal"],
      lessLikelyIf: "A contrary signal appears.",
      horizon: "Coming weeks",
      childIds: [],
      status: "ready" as const,
      errorMessage: null,
      leafReason: null,
    })),
    meta: { mode: "fixture", callConsumed: false, cacheStatus: "hit" },
  };
  await commitRegisteredExpansion(input, "durable-request", response, {
    repository: secondRepository,
  });
  resetRegisteredGraphsForTests();
  assert.deepEqual(
    await getRegisteredExpansionResponse(input, "durable-request", {
      repository: firstRepository,
    }),
    response,
  );
});


test("legacy evidence failures are not replayed and can be replaced without resetting ownership", async () => {
  const repository = new GenerationCacheRepository(createClient({ url: "file::memory:" }));
  try {
    const input = { installationId, graphId, headline: headlineFixture };
    const response = createFixtureStartResponse(input);
    await registerStartedGraph(input, response, { repository });
    const old = await repository.getRegisteredGraph(graphId);
    assert.ok(old);
    await repository.compareAndSwapRegisteredGraph({
      graphId, expectedVersion: old.version, snapshotFingerprint: null,
      state: { startResponse: { ok: true, kind: "insufficient_evidence", summary: "Legacy failure", reason: "Old evidence rule", sources: [], meta: { mode: "live", cacheStatus: "miss", callConsumed: true } }, nodes: {}, expansionResponses: {} },
      updatedAt: new Date().toISOString(),
    });
    assert.equal(await getRegisteredStartResponse(input, { repository }), null);
    await assert.rejects(() => registerStartedGraph({ ...input, installationId: "90000000-0000-4000-8000-000000000009" }, response, { repository }),
      error => error instanceof AtlasApiError && error.code === "graph_conflict");
    assert.equal((await registerStartedGraph(input, response, { repository })).kind, "atlas");
    assert.equal((await getRegisteredStartResponse(input, { repository }))?.kind, "atlas");
    assert.equal((await repository.getRegisteredGraph(graphId))?.installationFingerprint, old.installationFingerprint);
  } finally { repository.close(); }
});
