import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixtureExpansionResponse,
  createFixtureStartResponse,
} from "./fixtures";
import { WORLD_FIXTURE_HEADLINES } from "./world-fixtures";
import {
  headlineFixture,
  lineageNode,
  snapshotFixture,
  TEST_UUIDS,
} from "./openai-test-fixtures";

test("fixture start is deterministic and visibly labeled", () => {
  const input = {
    installationId: "10000000-0000-4000-8000-000000000001",
    graphId: "20000000-0000-4000-8000-000000000001",
    headline: headlineFixture,
  };
  const first = createFixtureStartResponse(input);
  const second = createFixtureStartResponse(input);

  assert.deepEqual(first, second);
  assert.equal(first.meta.mode, "fixture");
  assert.equal(first.meta.callConsumed, false);
  assert.equal(first.kind, "atlas");
  if (first.kind === "atlas") {
    assert.match(first.snapshot.summary, /fixture-only/i);
  }
});

test("fixture world starts use event-specific primary scenarios", () => {
  const energyHeadline = WORLD_FIXTURE_HEADLINES.find(
    (headline) => headline.id === "fixture-energy-001",
  );
  assert.ok(energyHeadline);
  const world = createFixtureStartResponse({
    installationId: "10000000-0000-4000-8000-000000000001",
    graphId: "20000000-0000-4000-8000-000000000001",
    headline: energyHeadline,
    worldEventId: "70000000-0000-4000-8000-000000000001",
  });
  const raw = createFixtureStartResponse({
    installationId: "10000000-0000-4000-8000-000000000001",
    graphId: "20000000-0000-4000-8000-000000000001",
    headline: energyHeadline,
  });
  assert.equal(world.kind, "atlas");
  assert.equal(raw.kind, "atlas");
  if (world.kind !== "atlas" || raw.kind !== "atlas") return;
  assert.ok(
    world.nodes.some((node) =>
      /Restricted access becomes the new normal/.test(node.title),
    ),
  );
  assert.ok(raw.nodes.every((node) => !/shipping route/i.test(node.title)));
});

test("fixture expansion derives depth and remains visibly labeled", () => {
  const parent = lineageNode(1, TEST_UUIDS[0]);
  const result = createFixtureExpansionResponse({
    installationId: "10000000-0000-4000-8000-000000000001",
    graphId: "20000000-0000-4000-8000-000000000001",
    parentId: parent.id,
    snapshot: snapshotFixture,
    lineage: [parent],
    remainingNodeCapacity: 3,
  });

  assert.equal(result.meta.mode, "fixture");
  assert.equal(result.meta.callConsumed, false);
  assert.equal(result.kind, "branches");
  if (result.kind === "branches") {
    assert.equal(result.nodes.length, 3);
    assert.ok(result.nodes.every((node) => node.depth === 2));
  }
});
