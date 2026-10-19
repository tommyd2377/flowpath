import assert from "node:assert/strict";
import test from "node:test";

import { expandAtlasWithOpenAI } from "./branch";
import { AtlasApiError } from "./http";
import {
  lineageNode,
  MockResponsesAdapter,
  modelBranch,
  snapshotFixture,
  TEST_UUIDS,
  testIdFactory,
} from "./openai-test-fixtures";

const installationId = "10000000-0000-4000-8000-000000000001";
const graphId = "20000000-0000-4000-8000-000000000001";

function expansionInput(overrides: Record<string, unknown> = {}) {
  const lineage = [lineageNode(1)];
  return {
    installationId,
    graphId,
    parentId: lineage[0].id,
    snapshot: snapshotFixture,
    lineage,
    remainingNodeCapacity: 5,
    ...overrides,
  };
}

function branchResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "{}", annotations: [] }],
      },
    ],
    output_parsed: {
      kind: "branches",
      branches: [modelBranch(1), modelBranch(2), modelBranch(3)],
      leafReason: null,
      ...overrides,
    },
  };
}

test("expansion is no-tool, stateless, bounded, and derives server depth and IDs", async () => {
  const adapter = new MockResponsesAdapter(branchResponse());
  const result = await expandAtlasWithOpenAI(expansionInput(), {
    adapter,
    model: "gpt-6-luna",
    createId: testIdFactory(),
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, "gpt-6-luna");
  assert.equal(call.request.service_tier, "priority");
  assert.equal(call.request.store, false);
  assert.deepEqual(call.request.reasoning, { effort: "low" });
  assert.equal(Object.hasOwn(call.request, "tools"), false);
  assert.equal(Object.hasOwn(call.request, "tool_choice"), false);
  assert.equal(Object.hasOwn(call.request, "previous_response_id"), false);
  assert.equal(call.options.timeout, 40_000);
  assert.equal(call.options.maxRetries, 0);
  const format = call.request.text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.name, "possibility_atlas_branch_expansion");

  const userInput = JSON.parse(call.request.input[1].content) as {
    UNTRUSTED_DATA: { frozenSnapshot: unknown; sequentialLineage: unknown };
  };
  assert.deepEqual(userInput.UNTRUSTED_DATA.frozenSnapshot, snapshotFixture);
  assert.deepEqual(userInput.UNTRUSTED_DATA.sequentialLineage, [lineageNode(1)]);

  assert.equal(result.kind, "branches");
  if (result.kind !== "branches") return;
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    TEST_UUIDS.slice(0, 3),
  );
  assert.ok(result.nodes.every((node) => node.depth === 2));
  assert.ok(result.nodes.every((node) => node.parentId === TEST_UUIDS[0]));
});

test("expansion rejects sibling and lineage title duplicates", async () => {
  const duplicateLineage = modelBranch(1, { title: "Lineage path 1" });
  const adapter = new MockResponsesAdapter(
    branchResponse({
      branches: [duplicateLineage, modelBranch(2), modelBranch(3)],
    }),
  );

  await assert.rejects(
    () =>
      expandAtlasWithOpenAI(expansionInput(), {
        adapter,
        model: "gpt-5.6-terra",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "model_output_invalid");
      return true;
    },
  );
});

test("expansion can return an early leaf", async () => {
  const adapter = new MockResponsesAdapter(
    branchResponse({
      kind: "leaf",
      branches: [],
      leafReason: "The selected path already describes a natural endpoint.",
    }),
  );
  const result = await expandAtlasWithOpenAI(expansionInput(), {
    adapter,
    model: "gpt-5.6-terra",
  });

  assert.equal(result.kind, "leaf");
  if (result.kind === "leaf") {
    assert.match(result.reason, /natural endpoint/i);
  }
});

test("remaining node capacity is a hard branch maximum", async () => {
  const adapter = new MockResponsesAdapter(
    branchResponse({
      branches: [modelBranch(1), modelBranch(2), modelBranch(3), modelBranch(4)],
    }),
  );

  await assert.rejects(
    () =>
      expandAtlasWithOpenAI(
        expansionInput({ remainingNodeCapacity: 3 }),
        { adapter, model: "gpt-5.6-terra" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "model_output_invalid");
      assert.equal(error.callConsumed, true);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 1);
  assert.match(adapter.calls[0].request.input[0].content, /between three and 3/i);
});

test("depth five rejects before a model call", async () => {
  const lineage = [1, 2, 3, 4, 5].map((depth) =>
    lineageNode(depth as 1 | 2 | 3 | 4 | 5),
  );
  const adapter = new MockResponsesAdapter(branchResponse());

  await assert.rejects(
    () =>
      expandAtlasWithOpenAI(
        expansionInput({
          parentId: lineage[4].id,
          lineage,
        }),
        { adapter, model: "gpt-5.6-terra" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "max_depth_reached");
      assert.equal(error.callConsumed, false);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 0);
});

test("non-sequential lineage rejects before a model call", async () => {
  const lineage = [lineageNode(2)];
  const adapter = new MockResponsesAdapter(branchResponse());

  await assert.rejects(
    () =>
      expandAtlasWithOpenAI(
        expansionInput({ parentId: lineage[0].id, lineage }),
        { adapter, model: "gpt-5.6-terra" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "invalid_lineage");
      assert.equal(error.callConsumed, false);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 0);
});

test("disconnected lineage rejects before a model call", async () => {
  const lineage = [
    lineageNode(1),
    lineageNode(2, TEST_UUIDS[1], TEST_UUIDS[4]),
  ];
  const adapter = new MockResponsesAdapter(branchResponse());

  await assert.rejects(
    () =>
      expandAtlasWithOpenAI(
        expansionInput({ parentId: lineage[1].id, lineage }),
        { adapter, model: "gpt-5.6-terra" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "invalid_lineage");
      assert.equal(error.callConsumed, false);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 0);
});

test("children created at depth five are terminal leaves", async () => {
  const lineage = [1, 2, 3, 4].map((depth) =>
    lineageNode(depth as 1 | 2 | 3 | 4 | 5),
  );
  const adapter = new MockResponsesAdapter(branchResponse());
  const result = await expandAtlasWithOpenAI(
    expansionInput({ parentId: lineage[3].id, lineage }),
    {
      adapter,
      model: "gpt-5.6-terra",
      createId: testIdFactory(),
    },
  );

  assert.equal(result.kind, "branches");
  if (result.kind === "branches") {
    assert.ok(result.nodes.every((node) => node.depth === 5));
    assert.ok(result.nodes.every((node) => node.status === "leaf"));
    assert.ok(result.nodes.every((node) => node.leafReason !== null));
  }
});

