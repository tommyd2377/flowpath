import assert from "node:assert/strict";
import test from "node:test";

import type { ExpandAtlasResponse } from "../contracts";
import type { ExpandAtlasRequest } from "./branch";
import { createFixtureStartResponse } from "./fixtures";
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

function registeredInput(): ExpandAtlasRequest {
  const startInput = { installationId, graphId, headline: headlineFixture };
  const start = createFixtureStartResponse(startInput);
  registerStartedGraph(startInput, start);
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

test("registered expansion rejects altered frozen evidence and capacity", () => {
  const input = registeredInput();
  assert.equal(validateRegisteredExpansion(input).remainingNodeCapacity, 60);

  assert.throws(
    () =>
      validateRegisteredExpansion({
        ...input,
        snapshot: { ...input.snapshot, summary: "Altered summary" },
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "snapshot_mismatch",
  );
  assert.throws(
    () =>
      validateRegisteredExpansion({ ...input, remainingNodeCapacity: 59 }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "node_capacity_mismatch",
  );
});

test("a completed start response can be replayed without rebuilding the graph", () => {
  const startInput = { installationId, graphId, headline: headlineFixture };
  const response = createFixtureStartResponse(startInput);
  registerStartedGraph(startInput, response);
  assert.deepEqual(getRegisteredStartResponse(startInput), response);
});

test("completed levels commit atomically and replay safely", () => {
  const input = registeredInput();
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
    meta: { mode: "fixture", callConsumed: false },
  };

  assert.deepEqual(commitRegisteredExpansion(input, "request-key", response), response);
  assert.deepEqual(getRegisteredExpansionResponse(input, "request-key"), response);
  assert.deepEqual(commitRegisteredExpansion(input, "request-key", response), response);
  assert.throws(
    () =>
      validateRegisteredExpansion({
        ...input,
        remainingNodeCapacity: 57,
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "already_expanded",
  );
});

test("an invalid level adds no partial nodes", () => {
  const input = registeredInput();
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
    meta: { mode: "fixture", callConsumed: false },
  };

  assert.throws(() => commitRegisteredExpansion(input, "invalid", invalid));
  assert.equal(getRegisteredExpansionResponse(input, "invalid"), null);
  assert.doesNotThrow(() => validateRegisteredExpansion(input));
});
