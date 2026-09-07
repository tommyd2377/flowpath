import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureStartResponse } from "./fixtures";
import {
  EXPANSION_PROMPT_VERSION,
  expansionResponseToTemplate,
  generationCacheKey,
  generationFingerprint,
  materializeExpansionTemplate,
  materializeStartTemplate,
  semanticExpansionSource,
  START_PROMPT_VERSION,
  startResponseToTemplate,
} from "./generation-templates";
import {
  headlineFixture,
  lineageNode,
  snapshotFixture,
  TEST_UUIDS,
} from "./openai-test-fixtures";

const input = {
  installationId: "10000000-0000-4000-8000-000000000001",
  graphId: "20000000-0000-4000-8000-000000000001",
  headline: headlineFixture,
};

function idFactory(offset: number) {
  let index = offset;
  return () =>
    `90000000-0000-4000-8000-${(++index).toString().padStart(12, "0")}`;
}

test("start templates omit request-owned fields and materialize fresh server IDs", () => {
  const response = createFixtureStartResponse(input);
  assert.equal(response.kind, "atlas");
  if (response.kind !== "atlas") return;
  const template = startResponseToTemplate(response);
  assert.equal(template.kind, "atlas");
  if (template.kind !== "atlas") return;

  assert.equal(Object.hasOwn(template.snapshot, "id"), false);
  assert.equal(Object.hasOwn(template.snapshot, "headline"), false);
  assert.equal(Object.hasOwn(template.snapshot, "capturedAt"), false);
  assert.ok(
    template.branches.every(
      (branch) =>
        !Object.hasOwn(branch, "id") &&
        !Object.hasOwn(branch, "parentId") &&
        !Object.hasOwn(branch, "depth"),
    ),
  );

  const capturedAt = "2026-08-25T13:00:00.000Z";
  const first = materializeStartTemplate(template, input, {
    mode: "live",
    callConsumed: false,
    cacheStatus: "hit",
    capturedAt,
    createId: idFactory(0),
  });
  const second = materializeStartTemplate(
    template,
    { ...input, graphId: "20000000-0000-4000-8000-000000000002" },
    {
      mode: "live",
      callConsumed: false,
      cacheStatus: "hit",
      capturedAt,
      createId: idFactory(10),
    },
  );
  assert.equal(first.kind, "atlas");
  assert.equal(second.kind, "atlas");
  if (first.kind !== "atlas" || second.kind !== "atlas") return;
  assert.equal(first.snapshot.capturedAt, capturedAt);
  assert.equal(second.snapshot.capturedAt, capturedAt);
  assert.notEqual(first.snapshot.id, second.snapshot.id);
  assert.notDeepEqual(
    first.nodes.map((node) => node.id),
    second.nodes.map((node) => node.id),
  );
  assert.ok(first.nodes.every((node) => node.parentId === input.graphId));
  assert.ok(
    second.nodes.every(
      (node) => node.parentId === "20000000-0000-4000-8000-000000000002",
    ),
  );
  assert.equal(first.meta.callConsumed, false);
  assert.equal(first.meta.cacheStatus, "hit");
});

test("expansion templates materialize relationships and terminal depth server-side", () => {
  const response = {
    ok: true as const,
    kind: "branches" as const,
    parentId: TEST_UUIDS[0],
    nodes: [1, 2, 3].map((index) => ({
      id: TEST_UUIDS[index],
      parentId: TEST_UUIDS[0],
      depth: 2 as const,
      title: `Cached path ${index}`,
      summary: `Summary ${index}`,
      whyPlausible: `Plausible ${index}`,
      keyAssumption: `Assumption ${index}`,
      watchFor: [`Signal ${index}`],
      lessLikelyIf: `Counter-signal ${index}`,
      horizon: "Coming weeks",
      childIds: [],
      status: "ready" as const,
      errorMessage: null,
      leafReason: null,
    })),
    meta: {
      mode: "live" as const,
      callConsumed: true,
      cacheStatus: "miss" as const,
    },
  };
  const template = expansionResponseToTemplate(response);
  assert.equal(template.kind, "branches");
  if (template.kind !== "branches") return;
  assert.ok(template.branches.every((branch) => !Object.hasOwn(branch, "id")));

  const materialized = materializeExpansionTemplate(
    template,
    { parentId: TEST_UUIDS[5], nextDepth: 5, maxBranches: 3 },
    {
      mode: "live",
      callConsumed: false,
      cacheStatus: "hit",
      createId: idFactory(20),
    },
  );
  assert.equal(materialized.kind, "branches");
  if (materialized.kind !== "branches") return;
  assert.ok(materialized.nodes.every((node) => node.parentId === TEST_UUIDS[5]));
  assert.ok(materialized.nodes.every((node) => node.depth === 5));
  assert.ok(materialized.nodes.every((node) => node.status === "leaf"));
  assert.ok(
    materialized.nodes.every(
      (node) => node.leafReason === "Maximum atlas depth reached.",
    ),
  );
});

test("terminal templates rematerialize without graph-specific state", () => {
  const insufficient = materializeStartTemplate(
    {
      kind: "insufficient_evidence",
      summary: "The event remains unresolved.",
      reason: "Current sources do not establish the core claim.",
      sources: [],
    },
    input,
    {
      mode: "live",
      callConsumed: false,
      cacheStatus: "hit",
      capturedAt: "2026-08-25T13:00:00.000Z",
    },
  );
  assert.equal(insufficient.kind, "insufficient_evidence");
  assert.equal(insufficient.meta.cacheStatus, "hit");

  const leaf = materializeExpansionTemplate(
    { kind: "leaf", reason: "This path ends with the available evidence." },
    { parentId: TEST_UUIDS[0], nextDepth: 3, maxBranches: 5 },
    { mode: "live", callConsumed: false, cacheStatus: "hit" },
  );
  assert.equal(leaf.kind, "leaf");
  assert.equal(leaf.parentId, TEST_UUIDS[0]);
  assert.equal(leaf.meta.cacheStatus, "hit");
});

test("cache keys invalidate on model, prompt, or semantic source changes", () => {
  const base = {
    kind: "start" as const,
    model: "gpt-5.6-luna",
    promptVersion: START_PROMPT_VERSION,
    source: headlineFixture,
  };
  const key = generationCacheKey(base);
  assert.equal(key.length, 64);
  assert.notEqual(key, generationCacheKey({ ...base, model: "gpt-5.6-terra" }));
  assert.notEqual(
    key,
    generationCacheKey({ ...base, promptVersion: "start-v3-luna" }),
  );
  assert.notEqual(
    key,
    generationCacheKey({
      ...base,
      source: { ...headlineFixture, title: "Updated headline" },
    }),
  );
  assert.equal(START_PROMPT_VERSION, "start-v5-research-context");
  assert.equal(EXPANSION_PROMPT_VERSION, "expand-v5-research-context");
  assert.notEqual(
    generationCacheKey({ ...base, kind: "expand", promptVersion: EXPANSION_PROMPT_VERSION }),
    generationCacheKey({ ...base, kind: "expand", promptVersion: "expand-v3-luna" }),
  );
  assert.equal(
    generationFingerprint({ beta: 2, alpha: 1 }),
    generationFingerprint({ alpha: 1, beta: 2 }),
  );
});

test("semantic expansion sources exclude graph and node IDs but retain frozen context", () => {
  const first = semanticExpansionSource({
    snapshot: snapshotFixture,
    lineage: [lineageNode(1), lineageNode(2)],
    maxBranches: 5,
  });
  const rematerialized = semanticExpansionSource({
    snapshot: {
      ...snapshotFixture,
      id: "70000000-0000-4000-8000-000000000001",
    },
    lineage: [
      {
        ...lineageNode(1),
        id: "71000000-0000-4000-8000-000000000001",
        parentId: "72000000-0000-4000-8000-000000000001",
      },
      {
        ...lineageNode(2),
        id: "71000000-0000-4000-8000-000000000002",
        parentId: "71000000-0000-4000-8000-000000000001",
      },
    ],
    maxBranches: 5,
  });

  assert.deepEqual(first, rematerialized);
  assert.equal(Object.hasOwn(first.snapshot, "id"), false);
  assert.ok(
    first.lineage.every(
      (node) => !Object.hasOwn(node, "id") && !Object.hasOwn(node, "parentId"),
    ),
  );
  assert.equal(first.snapshot.capturedAt, snapshotFixture.capturedAt);
  assert.notEqual(
    generationFingerprint(first),
    generationFingerprint({
      ...first,
      snapshot: {
        ...first.snapshot,
        capturedAt: "2026-08-25T12:06:00.000Z",
      },
    }),
  );
});
