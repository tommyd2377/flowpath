import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { AtlasApiError } from "./http";
import { expandAtlasWithOpenAI } from "./branch";
import type { LineageNode } from "../contracts";
import {
  headlineFixture,
  initialParsedOutput,
  MockResponsesAdapter,
  modelBranch,
  searchedResponse,
  sourceUrls,
  TEST_UUIDS,
  testIdFactory,
} from "./openai-test-fixtures";
import { startAtlasWithOpenAI } from "./verify";

const startInput = {
  installationId: "10000000-0000-4000-8000-000000000001",
  graphId: "20000000-0000-4000-8000-000000000001",
  headline: headlineFixture,
};

test("initial research uses one bounded Responses request with up to two contextual searches", async () => {
  const adapter = new MockResponsesAdapter(
    searchedResponse(initialParsedOutput()),
  );
  const result = await startAtlasWithOpenAI(startInput, {
    adapter,
    model: "gpt-5.6-luna",
    createId: testIdFactory(),
    now: () => new Date("2026-08-25T13:00:00.000Z"),
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, "gpt-5.6-luna");
  assert.equal(call.request.store, false);
  assert.deepEqual(call.request.reasoning, { effort: "low" });
  assert.deepEqual(call.request.tools, [
    { type: "web_search", search_context_size: "medium" },
  ]);
  assert.equal(call.request.tool_choice, "required");
  assert.equal(call.request.max_tool_calls, 2);
  assert.equal(call.request.max_output_tokens, 4000);
  assert.equal(call.request.parallel_tool_calls, false);
  assert.deepEqual(call.request.include, ["web_search_call.action.sources"]);
  assert.equal(call.options.timeout, 75_000);
  assert.equal(call.options.maxRetries, 0);
  assert.equal(Object.hasOwn(call.request, "previous_response_id"), false);
  assert.match(
    call.request.input[0].content,
    /always build three to five distinct conditional possibilities/i,
  );
  const format = call.request.text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.name, "possibility_atlas_initial_branches");
  assert.equal(format.strict, true);

  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(result.meta.callConsumed, true);
  assert.equal(result.meta.cacheStatus, "miss");
  assert.equal(result.snapshot.verificationStatus, "reported");
  assert.equal(result.snapshot.capturedAt, "2026-08-25T13:00:00.000Z");
  assert.deepEqual(
    result.snapshot.sources.map((source) => source.domain),
    ["alpha.example", "beta.example"],
  );
  assert.deepEqual(
    result.nodes.map((node) => node.id),
    TEST_UUIDS.slice(0, 3),
  );
  assert.ok(result.nodes.every((node) => node.depth === 1));
  assert.ok(result.nodes.every((node) => node.parentId === startInput.graphId));
});

test("unmatched citations remove individual factual claims without blocking analysis", async () => {
  const parsed = initialParsedOutput();
  parsed.sources.push({ title: "Unknown page", url: "https://invented.example/page" });
  parsed.sources.push(parsed.sources[0]);
  parsed.facts.push({ text: "Unsupported secret vote claim.", sourceUrls: ["https://invented.example/page"] });
  parsed.summary = "Unsupported secret vote claim.";
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));
  const result = await startAtlasWithOpenAI(startInput, { adapter, model: "gpt-5.6-luna" });
  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(result.nodes.length, 3);
  assert.equal(result.snapshot.facts.length, 1);
  assert.doesNotMatch(JSON.stringify(result.snapshot), /invented.example|secret vote/);
  assert.equal(adapter.calls.length, 1);
});

test("a matching citation survives a missing bibliography entry and an unmatched sibling URL", async () => {
  const parsed = initialParsedOutput();
  parsed.sources = [];
  parsed.facts[0].sourceUrls = [sourceUrls.alpha + "?utm_source=example#section", "https://invented.example/page"];
  const result = await startAtlasWithOpenAI(startInput, { adapter: new MockResponsesAdapter(searchedResponse(parsed)), model: "gpt-5.6-luna" });
  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.deepEqual(result.snapshot.facts[0].sourceIds, [result.snapshot.sources[0].id]);
  assert.equal(result.snapshot.sources[0].url, sourceUrls.alpha);
  assert.equal(result.nodes.length, 3);
});

test("zero sources, empty searches and failed searches still produce conditional maps", async () => {
  for (const output of [[], [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [] } }], [{ type: "web_search_call", status: "failed", action: { type: "search", sources: [{ url: sourceUrls.alpha }] } }]]) {
    const parsed = initialParsedOutput();
    parsed.facts = [];
    parsed.sources = [];
    const adapter = new MockResponsesAdapter({ status: "completed", output, output_parsed: parsed });
    const result = await startAtlasWithOpenAI(startInput, { adapter, model: "gpt-5.6-luna" });
    assert.equal(result.kind, "atlas");
    if (result.kind !== "atlas") return;
    assert.equal(result.snapshot.verificationStatus, "reported");
    assert.equal(result.nodes.length, 3);
    assert.deepEqual(result.snapshot.sources, []);
    assert.deepEqual(result.snapshot.facts, [{ text: `Example News reports: ${headlineFixture.title}`, sourceIds: [] }]);
    assert.equal(adapter.calls.length, 1);
  }
});

test("one publisher and an unfinished proposal need no corroboration or completed vote", async () => {
  const parsed = initialParsedOutput();
  parsed.summary = "Local reporting describes a proposal that is awaiting a board vote.";
  parsed.facts = [{ text: "The board vote is still pending.", sourceUrls: [sourceUrls.alpha] }];
  parsed.uncertainties = ["The eventual decision and timing are unknown."];
  const response = searchedResponse(parsed);
  response.output = [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: sourceUrls.alpha }] } }];
  const adapter = new MockResponsesAdapter(response);
  const result = await startAtlasWithOpenAI(startInput, { adapter, model: "gpt-5.6-luna" });
  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(result.nodes.length, 3);
  assert.equal(result.snapshot.sources.length, 1);
  assert.match(result.snapshot.facts[0].text, /pending/);
  assert.match(result.snapshot.uncertainties[0], /unknown/);
  const schema = (adapter.calls[0].request.text.format as { schema: { properties: Record<string, unknown> } }).schema;
  assert.equal('assessment' in schema.properties, false);
  assert.equal('insufficientReason' in schema.properties, false);
});

test("sparse headline context and explicit assumptions carry through all five levels", async () => {
  const parsed = initialParsedOutput();
  parsed.facts = [];
  parsed.sources = [];
  const initial = await startAtlasWithOpenAI(startInput, {
    adapter: new MockResponsesAdapter({ status: "completed", output: [], output_parsed: parsed }), model: "gpt-5.6-luna",
  });
  assert.equal(initial.kind, "atlas");
  if (initial.kind !== "atlas") return;
  const lineage: LineageNode[] = [];
  let parent = initial.nodes[0];
  for (let depth = 2; depth <= 5; depth++) {
    const { id, parentId, title, summary, whyPlausible, keyAssumption, horizon } = parent;
    lineage.push({ id, parentId, title, summary, whyPlausible, keyAssumption, horizon, depth: parent.depth });
    const adapter = new MockResponsesAdapter({ status: "completed", output: [], output_parsed: {
      kind: "branches", leafReason: null,
      branches: [1, 2, 3].map(index => modelBranch(index, { title: `Conditional consequence ${depth}.${index}` })),
    } });
    const expanded = await expandAtlasWithOpenAI({ installationId: startInput.installationId, graphId: startInput.graphId,
      parentId: parent.id, snapshot: initial.snapshot, lineage: [...lineage], remainingNodeCapacity: 60 - (depth - 2) * 3,
    }, { adapter, model: "gpt-5.6-luna", createId: randomUUID });
    const input = JSON.parse(adapter.calls[0].request.input[1].content);
    assert.deepEqual(input.UNTRUSTED_DATA.frozenSnapshot, initial.snapshot);
    assert.match(adapter.calls[0].request.input[0].content, /few or no independent sources/);
    assert.equal(Object.hasOwn(adapter.calls[0].request, "tools"), false);
    assert.equal(expanded.kind, "branches");
    if (expanded.kind !== "branches") return;
    parent = expanded.nodes[0];
    assert.equal(parent.depth, depth);
  }
  assert.equal(parent.status, "leaf");
});

test("an empty branch response is a malformed model output, never an evidence refusal", async () => {
  const parsed = initialParsedOutput();
  parsed.branches = [];
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));
  await assert.rejects(() => startAtlasWithOpenAI(startInput, { adapter, model: "gpt-5.6-luna" }),
    error => error instanceof AtlasApiError && error.code === "model_output_invalid" && error.callConsumed);
  assert.equal(adapter.calls.length, 1);
});

test("refusals surface a sanitized consumed-call error", async () => {
  const response = searchedResponse(initialParsedOutput());
  response.output = [
    {
      type: "message",
      content: [{ type: "refusal", refusal: "private provider detail" }],
    },
  ];
  const adapter = new MockResponsesAdapter(response);

  await assert.rejects(
    () =>
      startAtlasWithOpenAI(startInput, {
        adapter,
        model: "gpt-5.6-terra",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "model_refusal");
      assert.equal(error.callConsumed, true);
      assert.doesNotMatch(error.message, /provider detail/i);
      return true;
    },
  );
});

test("incomplete responses fail without a repair call", async () => {
  const response = searchedResponse(initialParsedOutput());
  response.status = "incomplete";
  response.incomplete_details = { reason: "max_output_tokens" };
  const adapter = new MockResponsesAdapter(response);

  await assert.rejects(
    () =>
      startAtlasWithOpenAI(startInput, {
        adapter,
        model: "gpt-5.6-terra",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AtlasApiError);
      assert.equal(error.code, "model_incomplete");
      assert.equal(error.callConsumed, true);
      return true;
    },
  );
  assert.equal(adapter.calls.length, 1);
});

test("duplicate branch titles are rejected", async () => {
  const parsed = initialParsedOutput();
  parsed.branches[1] = modelBranch(2, { title: "Distinct path 1!!!" });
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));

  await assert.rejects(
    () =>
      startAtlasWithOpenAI(startInput, {
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
