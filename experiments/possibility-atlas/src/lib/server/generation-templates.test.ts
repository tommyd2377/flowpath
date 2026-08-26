import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureStartResponse } from "./fixtures";
import {
  expansionResponseToTemplate,
  generationCacheKey,
  materializeExpansionTemplate,
  materializeStartTemplate,
  startResponseToTemplate,
} from "./generation-templates";
import { headlineFixture, TEST_UUIDS } from "./openai-test-fixtures";

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

test("start cache templates omit graph IDs and timestamps and materialize fresh IDs", () => {
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

  const first = materializeStartTemplate(template, input, {
    mode: "live",
    callConsumed: false,
    cacheStatus: "hit",
    capturedAt: "2026-08-25T13:00:00.000Z",
    createId: idFactory(0),
  });
  const second = materializeStartTemplate(
    template,
    { ...input, graphId: "20000000-0000-4000-8000-000000000002" },
    {
      mode: "live",
      callConsumed: false,
      cacheStatus: "hit",
      capturedAt: "2026-08-25T13:00:00.000Z",
      createId: idFactory(10),
    },
  );
  assert.equal(first.kind, "atlas");
  assert.equal(second.kind, "atlas");
  if (first.kind !== "atlas" || second.kind !== "atlas") return;
  assert.equal(first.snapshot.capturedAt, second.snapshot.capturedAt);
  assert.notEqual(first.snapshot.id, second.snapshot.id);
  assert.notDeepEqual(
    first.nodes.map((node) => node.id),
    second.nodes.map((node) => node.id),
  );
  assert.ok(first.nodes.every((node) => node.parentId === input.graphId));
  assert.equal(first.meta.callConsumed, false);
  assert.equal(first.meta.cacheStatus, "hit");
});

test("expansion cache templates materialize relationships and terminal depth server-side", () => {
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
    meta: { mode: "live" as const, callConsumed: true, cacheStatus: "miss" as const },
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
});

test("generation cache keys invalidate on model, prompt, or source changes", () => {
  const base = {
    kind: "start" as const,
    model: "gpt-5.6-terra",
    promptVersion: "start-v2",
    source: headlineFixture,
  };
  const key = generationCacheKey(base);
  assert.notEqual(key, generationCacheKey({ ...base, model: "gpt-5.6-sol" }));
  assert.notEqual(
    key,
    generationCacheKey({ ...base, promptVersion: "start-v3" }),
  );
  assert.notEqual(
    key,
    generationCacheKey({
      ...base,
      source: { ...headlineFixture, title: "Updated headline" },
    }),
  );
});
