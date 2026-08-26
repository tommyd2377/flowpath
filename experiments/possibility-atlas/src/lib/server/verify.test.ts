import assert from "node:assert/strict";
import test from "node:test";

import { AtlasApiError } from "./http";
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

test("initial generation uses one bounded web search and materializes server IDs", async () => {
  const adapter = new MockResponsesAdapter(
    searchedResponse(initialParsedOutput()),
  );
  const result = await startAtlasWithOpenAI(startInput, {
    adapter,
    model: "gpt-5.6-terra",
    createId: testIdFactory(),
    now: () => new Date("2026-08-25T13:00:00.000Z"),
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, "gpt-5.6-terra");
  assert.equal(call.request.store, false);
  assert.deepEqual(call.request.reasoning, { effort: "low" });
  assert.deepEqual(call.request.tools, [
    { type: "web_search", search_context_size: "medium" },
  ]);
  assert.equal(call.request.tool_choice, "required");
  assert.equal(call.request.max_tool_calls, 1);
  assert.equal(call.request.parallel_tool_calls, false);
  assert.deepEqual(call.request.include, ["web_search_call.action.sources"]);
  assert.equal(call.options.timeout, 75_000);
  assert.equal(call.options.maxRetries, 0);
  assert.equal(Object.hasOwn(call.request, "previous_response_id"), false);
  const format = call.request.text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.name, "possibility_atlas_initial_branches");
  assert.equal(format.strict, true);

  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(result.meta.callConsumed, true);
  assert.equal(result.snapshot.verificationStatus, "corroborated");
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

test("world-event verification asks Sol for materially distinct primary scenarios", async () => {
  const adapter = new MockResponsesAdapter(
    searchedResponse(initialParsedOutput()),
  );
  await startAtlasWithOpenAI(
    {
      ...startInput,
      worldEventId: "70000000-0000-4000-8000-000000000001",
    },
    {
      adapter,
      model: "gpt-5.6-sol",
      createId: testIdFactory(),
    },
  );

  assert.equal(adapter.calls.length, 1);
  assert.equal(adapter.calls[0].request.model, "gpt-5.6-sol");
  assert.match(adapter.calls[0].request.input[0].content, /primary scenarios/i);
  assert.match(adapter.calls[0].request.input[1].content, /world event/i);
});

test("unconsulted fact or branch URLs produce insufficient evidence", async () => {
  const parsed = initialParsedOutput();
  parsed.branches[0] = modelBranch(1, {
    sourceUrls: ["https://invented.example/not-consulted"],
  });
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));

  const result = await startAtlasWithOpenAI(startInput, {
    adapter,
    model: "gpt-5.6-terra",
  });

  assert.equal(result.kind, "insufficient_evidence");
  assert.equal(result.meta.callConsumed, true);
  if (result.kind === "insufficient_evidence") {
    assert.match(result.reason, /unverified source/i);
    assert.deepEqual(
      result.sources.map((source) => source.url).sort(),
      [sourceUrls.alpha, sourceUrls.beta].sort(),
    );
  }
});

test("unconsulted fact URLs also produce insufficient evidence", async () => {
  const parsed = initialParsedOutput();
  parsed.facts[0] = {
    text: "A fact with a fabricated source.",
    sourceUrls: ["https://invented.example/not-consulted"],
  };
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));

  const result = await startAtlasWithOpenAI(startInput, {
    adapter,
    model: "gpt-5.6-terra",
  });

  assert.equal(result.kind, "insufficient_evidence");
  if (result.kind === "insufficient_evidence") {
    assert.match(result.reason, /fact was not supported/i);
  }
});

test("unresolved and contradicted assessments never produce branches", async () => {
  for (const assessment of ["unresolved", "contradicted"] as const) {
    const parsed = initialParsedOutput();
    parsed.assessment = assessment;
    parsed.branches = [];
    parsed.facts = [];
    parsed.sources = [];
    parsed.insufficientReason = `Fixture ${assessment} reason.`;
    const adapter = new MockResponsesAdapter(searchedResponse(parsed));

    const result = await startAtlasWithOpenAI(startInput, {
      adapter,
      model: "gpt-5.6-terra",
    });

    assert.equal(result.kind, "insufficient_evidence");
    if (result.kind === "insufficient_evidence") {
      assert.match(result.reason, new RegExp(assessment));
    }
  }
});

test("corroborated requires two domains and downgrades one-domain evidence", async () => {
  const parsed = initialParsedOutput();
  parsed.sources = [{ title: "Alpha report", url: sourceUrls.alpha }];
  parsed.facts = [
    { text: "One-domain fact.", sourceUrls: [sourceUrls.alpha] },
  ];
  parsed.branches = [1, 2, 3].map((index) =>
    modelBranch(index, { sourceUrls: [sourceUrls.alpha] }),
  );
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));
  const result = await startAtlasWithOpenAI(startInput, {
    adapter,
    model: "gpt-5.6-terra",
    createId: testIdFactory(),
  });

  assert.equal(result.kind, "atlas");
  if (result.kind === "atlas") {
    assert.equal(result.snapshot.verificationStatus, "partial");
  }
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
