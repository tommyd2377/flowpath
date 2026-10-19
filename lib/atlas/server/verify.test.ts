import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { AtlasApiError } from "./http";
import { expandAtlasWithOpenAI } from "./branch";
import type { EventSnapshot, LineageNode } from "../contracts";
import type { AtlasParsedResponse, AtlasRequestOptions, AtlasResponseProgress, AtlasResponsesAdapter, AtlasResponsesRequest } from "./openai-client";
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
import { completedResearchPrefix } from "./research-prefix";

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
    model: "gpt-6-luna",
    createId: testIdFactory(),
    now: () => new Date("2026-08-25T13:00:00.000Z"),
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, "gpt-6-luna");
  assert.equal(call.request.service_tier, "priority");
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

test("incomplete responses fail without a repair call and log their machine reason", async t => {
  const warning = t.mock.method(console, "warn", () => {});
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
  assert.deepEqual(warning.mock.calls[0].arguments, ["[flowpath:initial_research_failed]", JSON.stringify({
    stage: "validation", code: "model_incomplete", errorName: "AtlasApiError", incompleteReason: "max_output_tokens",
  })]);
});

test("initial research diagnostics omit provider messages and private response content", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const providerError = Object.assign(new Error("PRIVATE_PROVIDER_MESSAGE"), {
    name: "RateLimitError", status: 429, code: "rate_limit_exceeded",
    headers: { authorization: "PRIVATE_KEY" }, request: { input: "PRIVATE_PROMPT" },
  });
  const adapter: AtlasResponsesAdapter = { async parse() { throw providerError; } };
  await assert.rejects(() => startAtlasWithOpenAI(startInput, { adapter, model: "gpt-6.1-sol" }),
    error => error instanceof AtlasApiError && error.code === "analysis_unavailable");
  assert.deepEqual(warning.mock.calls[0].arguments, ["[flowpath:initial_research_failed]", JSON.stringify({
    stage: "request", code: "analysis_unavailable", errorName: "RateLimitError", providerStatus: 429, providerCode: "rate_limit_exceeded",
  })]);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls), /PRIVATE_/);
});

test("invalid initial research diagnostics log schema codes and paths without model text", async t => {
  const warning = t.mock.method(console, "warn", () => {});
  const parsed = initialParsedOutput();
  parsed.branches[0].title = "PRIVATE_MODEL_TEXT".repeat(20);
  const adapter = new MockResponsesAdapter(searchedResponse(parsed));
  await assert.rejects(() => startAtlasWithOpenAI(startInput, { adapter, model: "gpt-6.1-sol" }),
    error => error instanceof AtlasApiError && error.code === "model_output_invalid");
  assert.deepEqual(warning.mock.calls[0].arguments, ["[flowpath:initial_research_failed]", JSON.stringify({
    stage: "validation", code: "model_output_invalid", errorName: "ZodError",
    schemaIssues: [{ code: "too_big", path: ["branches", 0, "title"] }],
  })]);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls), /PRIVATE_MODEL_TEXT/);
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

function streamingAdapter(
  response: AtlasParsedResponse<unknown>,
  run: (onProgress: (progress: AtlasResponseProgress) => void) => Promise<void> | void,
) {
  let calls = 0;
  const adapter: AtlasResponsesAdapter = {
    async parse() { throw new Error("Streaming research must use the streaming adapter."); },
    async stream<T>(
      _request: AtlasResponsesRequest,
      _options: AtlasRequestOptions,
      onProgress: (progress: AtlasResponseProgress) => void,
    ) {
      calls += 1;
      await run(onProgress);
      return response as AtlasParsedResponse<T>;
    },
  };
  return { adapter, callCount: () => calls };
}

test("research JSON prefix waits for complete fields across every string and nesting boundary", () => {
  const parsed = initialParsedOutput();
  parsed.summary = 'A "quoted" report contains {braces}, [arrays], commas, \\ and Unicode ☀.';
  parsed.facts[0].text = 'A string can contain ,"branches":[ without starting the map.';
  const serialized = JSON.stringify(parsed);
  const researchEnd = serialized.indexOf(',"branches":[');
  for (let index = 0; index <= researchEnd; index += 1) {
    assert.equal(completedResearchPrefix(serialized.slice(0, index)), null);
  }
  const research = completedResearchPrefix(serialized.slice(0, researchEnd + 1));
  assert.ok(research);
  assert.deepEqual(research, {
    summary: parsed.summary, facts: parsed.facts, uncertainties: parsed.uncertainties, sources: parsed.sources,
  });
  assert.equal(completedResearchPrefix('{"summary":"A","summary":"B","facts":[],"uncertainties":[],"sources":[],'), null);
  assert.equal(completedResearchPrefix('{"summary":"A","facts":[],"uncertainties":[],"sources":{},'), null);
  assert.equal(completedResearchPrefix('```json\n' + serialized), null);
});

test("streaming publishes validated research before the map and keeps its server identity", async () => {
  const parsed = initialParsedOutput();
  const response = searchedResponse(parsed);
  const serialized = JSON.stringify(parsed);
  const researchEnd = serialized.indexOf(',"branches":[') + 1;
  let finish!: () => void;
  const waitingForMap = new Promise<void>((resolve) => { finish = resolve; });
  const streaming = streamingAdapter(response, async (onProgress) => {
    // No publication until completed search metadata is available.
    onProgress({ outputText: serialized.slice(0, researchEnd), completedOutput: [] });
    onProgress({ outputText: serialized.slice(0, researchEnd), completedOutput: [response.output[0]] });
    await waitingForMap;
    onProgress({ outputText: serialized, completedOutput: response.output });
  });
  const snapshots: EventSnapshot[] = [];
  let researchReady!: () => void;
  const ready = new Promise<void>((resolve) => { researchReady = resolve; });
  let completed = false;
  let clock = 0;
  const pending = startAtlasWithOpenAI(startInput, {
    adapter: streaming.adapter,
    model: "gpt-6.1-sol",
    createId: testIdFactory(),
    now: () => new Date(Date.UTC(2026, 9, 18, 14, 0, clock++)),
    onResearch: (snapshot) => { snapshots.push(snapshot); researchReady(); },
  }).then((result) => { completed = true; return result; });
  await ready;
  assert.equal(completed, false);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].facts.length, 1);
  assert.equal(snapshots[0].sources.length, 2);
  finish();
  const result = await pending;
  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(snapshots.length, 1);
  assert.equal(result.snapshot.id, snapshots[0].id);
  assert.equal(result.snapshot.capturedAt, snapshots[0].capturedAt);
  assert.ok(result.nodes.every((node) => node.id !== result.snapshot.id));
  assert.equal(streaming.callCount(), 1);
});

test("one-character streamed chunks preserve attribution and remove invented citations and summary", async () => {
  const parsed = initialParsedOutput();
  parsed.facts.push({ text: "Unsupported secret vote claim.", sourceUrls: ["https://invented.example/report"] });
  parsed.sources.push({ title: "Invented source", url: "https://invented.example/report" });
  parsed.summary = "Unsupported secret vote claim.";
  const response = searchedResponse(parsed);
  const serialized = JSON.stringify(parsed);
  const streaming = streamingAdapter(response, (onProgress) => {
    for (let index = 1; index <= serialized.length; index += 1) {
      onProgress({ outputText: serialized.slice(0, index), completedOutput: [response.output[0]] });
    }
  });
  const snapshots: EventSnapshot[] = [];
  const result = await startAtlasWithOpenAI(startInput, {
    adapter: streaming.adapter, model: "gpt-6.1-sol", onResearch: (snapshot) => snapshots.push(snapshot),
  });
  assert.equal(result.kind, "atlas");
  assert.equal(snapshots.length, 1);
  assert.doesNotMatch(JSON.stringify(snapshots), /invented.example|secret vote/);
  assert.equal(snapshots[0].facts.length, 1);
});

test("streamed sparse research retains attributed headline context and conditional maps", async () => {
  const parsed = initialParsedOutput();
  parsed.facts = [];
  parsed.sources = [];
  parsed.summary = "An unsupported secret vote happened.";
  const response = searchedResponse(parsed);
  response.output = [{ type: "web_search_call", status: "failed", action: { type: "search", sources: [] } }];
  const streaming = streamingAdapter(response, (onProgress) => {
    onProgress({ outputText: JSON.stringify(parsed), completedOutput: response.output });
  });
  const snapshots: EventSnapshot[] = [];
  const result = await startAtlasWithOpenAI(startInput, {
    adapter: streaming.adapter, model: "gpt-6.1-sol", onResearch: (snapshot) => snapshots.push(snapshot),
  });
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].facts, [{ text: `Example News reports: ${headlineFixture.title}`, sourceIds: [] }]);
  assert.deepEqual(snapshots[0].sources, []);
  assert.equal(snapshots[0].summary, `Example News reports: ${headlineFixture.title}`);
  assert.doesNotMatch(JSON.stringify(snapshots), /secret vote/);
  assert.equal(result.kind, "atlas");
  if (result.kind === "atlas") assert.equal(result.nodes.length, 3);
  assert.equal(streaming.callCount(), 1);
});

test("failed and aborted streams keep published research but never return a map or retry", async () => {
  for (const abort of [false, true]) {
    const response = searchedResponse(initialParsedOutput());
    const serialized = JSON.stringify(response.output_parsed);
    const controller = new AbortController();
    const streaming = streamingAdapter(response, (onProgress) => {
      onProgress({ outputText: serialized, completedOutput: [response.output[0]] });
      if (abort) controller.abort();
      else throw new Error("Private provider connection failure.");
    });
    const snapshots: EventSnapshot[] = [];
    await assert.rejects(() => startAtlasWithOpenAI(startInput, {
      adapter: streaming.adapter, model: "gpt-6.1-sol", signal: controller.signal,
      onResearch: (snapshot) => snapshots.push(snapshot),
    }), (error: unknown) => error instanceof AtlasApiError && error.code === "analysis_unavailable"
      && error.callConsumed && !error.message.includes("Private provider"));
    assert.equal(snapshots.length, 1);
    assert.equal(streaming.callCount(), 1);
  }
});

test("a signal aborted before any progress prevents research publication", async () => {
  const response = searchedResponse(initialParsedOutput());
  const controller = new AbortController();
  controller.abort();
  const streaming = streamingAdapter(response, (onProgress) => {
    onProgress({ outputText: JSON.stringify(response.output_parsed), completedOutput: response.output });
  });
  const snapshots: EventSnapshot[] = [];
  await assert.rejects(() => startAtlasWithOpenAI(startInput, {
    adapter: streaming.adapter, model: "gpt-6.1-sol", signal: controller.signal,
    onResearch: (snapshot) => snapshots.push(snapshot),
  }), AtlasApiError);
  assert.equal(snapshots.length, 0);
});

test("streamed research cannot bypass final branch and completion validation", async () => {
  for (const malformed of ["duplicate", "empty", "incomplete"] as const) {
    const parsed = initialParsedOutput();
    if (malformed === "duplicate") parsed.branches[1] = parsed.branches[0];
    if (malformed === "empty") parsed.branches = [];
    const response = searchedResponse(parsed);
    if (malformed === "incomplete") response.status = "incomplete";
    const streaming = streamingAdapter(response, (onProgress) => {
      onProgress({ outputText: JSON.stringify(parsed), completedOutput: [response.output[0]] });
    });
    const snapshots: EventSnapshot[] = [];
    await assert.rejects(() => startAtlasWithOpenAI(startInput, {
      adapter: streaming.adapter, model: "gpt-6.1-sol", onResearch: (snapshot) => snapshots.push(snapshot),
    }), (error: unknown) => error instanceof AtlasApiError
      && error.code === (malformed === "incomplete" ? "model_incomplete" : "model_output_invalid"));
    assert.equal(snapshots.length, 1);
    assert.equal(streaming.callCount(), 1);
  }
});

test("initial catalog context stays attributed and untrusted inside the bounded request", async () => {
  const adapter = new MockResponsesAdapter(searchedResponse(initialParsedOutput()));
  const context = {
    ...headlineFixture, summary: "Attributed opening context.", whyItMatters: "A wider implication.",
    scope: "both" as const, headlines: [headlineFixture],
    contextSources: [{ title: "Prior report", url: sourceUrls.alpha }],
  };
  await startAtlasWithOpenAI(startInput, { adapter, model: "gpt-6.1-sol", context });
  assert.deepEqual(JSON.parse(adapter.calls[0].request.input[1].content).UNTRUSTED_DATA.initialCatalogContext, context);
  assert.match(adapter.calls[0].request.input[0].content, /untrusted context.*not verified research/i);
  assert.match(adapter.calls[0].request.input[0].content, /summary, facts, uncertainties and sources fields first/i);
  assert.equal(adapter.calls.length, 1);
});

test("long research prose and its final qualifications survive checked progress and the final map", async () => {
  const parsed = initialParsedOutput();
  const longFact = `The report includes a lengthy conditional claim. ${"Additional detail ".repeat(40)}unless the pending decision changes.`;
  parsed.facts.push({ text: longFact, sourceUrls: [sourceUrls.alpha] });
  parsed.summary = `A detailed summary. ${"Relevant background ".repeat(50)}The pending decision has not been made.`;
  parsed.uncertainties = [`The remaining uncertainty includes ${"procedural detail ".repeat(20)}and no outcome is established.`];
  const serialized = JSON.stringify(parsed);
  const prefix = serialized.slice(0, serialized.indexOf(',"branches":[') + 1);
  const research = completedResearchPrefix(prefix);
  assert.ok(research);
  assert.deepEqual(research.facts, parsed.facts);
  assert.equal(research.summary, parsed.summary);
  assert.deepEqual(research.uncertainties, parsed.uncertainties);
  const response = searchedResponse(parsed);
  const streaming = streamingAdapter(response, onProgress => onProgress({ outputText: prefix, completedOutput: [response.output[0]] }));
  const snapshots: EventSnapshot[] = [];
  const result = await startAtlasWithOpenAI(startInput, { adapter: streaming.adapter, model: "gpt-6.1-sol", onResearch: snapshot => snapshots.push(snapshot) });
  assert.equal(result.kind, "atlas");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].facts.length, 2);
  assert.equal(snapshots[0].facts[1].text, longFact);
  assert.equal(snapshots[0].facts[1].sourceIds.length, 1);
  assert.equal(snapshots[0].summary, parsed.summary);
  assert.deepEqual(snapshots[0].uncertainties, parsed.uncertainties);
  if (result.kind !== "atlas") return;
  assert.equal(result.nodes.length, 3);
  assert.deepEqual(result.snapshot.facts, snapshots[0].facts);
  assert.equal(result.snapshot.summary, parsed.summary);
  assert.deepEqual(result.snapshot.uncertainties, parsed.uncertainties);
  assert.equal(streaming.callCount(), 1);
});

test("provenance repairs the summary using whole supported facts without losing their trailing qualification", async () => {
  const parsed = initialParsedOutput();
  const longFact = `A lengthy supported claim. ${"Relevant detail ".repeat(70)}unless the decision changes.`;
  parsed.facts = [
    { text: longFact, sourceUrls: [sourceUrls.alpha] },
    { text: "An unsupported claim.", sourceUrls: ["https://invented.example/report"] },
  ];
  parsed.summary = "An unsupported claim.";
  const result = await startAtlasWithOpenAI(startInput, { adapter: new MockResponsesAdapter(searchedResponse(parsed)), model: "gpt-6.1-sol" });
  assert.equal(result.kind, "atlas");
  if (result.kind !== "atlas") return;
  assert.equal(result.nodes.length, 3);
  assert.equal(result.snapshot.facts.length, 1);
  assert.equal(result.snapshot.facts[0].text, longFact);
  assert.equal(result.snapshot.summary, longFact);
});

test("accepting long research prose still rejects malformed fact types, sources and extra fields", async t => {
  t.mock.method(console, "warn", () => {});
  const cases: unknown[] = [
    { text: 42, sourceUrls: [sourceUrls.alpha] },
    { text: "Long prose ".repeat(60), sourceUrls: [42] },
    { text: "Long prose ".repeat(60), sourceUrls: ["https://example.test/" + "a".repeat(2_049)] },
    { text: "Long prose ".repeat(60), sourceUrls: [sourceUrls.alpha], instruction: "Untrusted extra field" },
  ];
  for (const malformed of cases) {
    const parsed = { ...initialParsedOutput(), facts: [malformed] };
    const serialized = JSON.stringify(parsed);
    assert.equal(completedResearchPrefix(serialized.slice(0, serialized.indexOf(',"branches":[') + 1)), null);
    const adapter = new MockResponsesAdapter(searchedResponse(parsed));
    await assert.rejects(() => startAtlasWithOpenAI(startInput, { adapter, model: "gpt-6.1-sol" }),
      error => error instanceof AtlasApiError && error.code === "model_output_invalid");
  }
  const invalidSummary = { ...initialParsedOutput(), summary: 42, facts: [{ text: "Long prose ".repeat(60), sourceUrls: [sourceUrls.alpha] }] };
  const adapter = new MockResponsesAdapter(searchedResponse(invalidSummary));
  await assert.rejects(() => startAtlasWithOpenAI(startInput, { adapter, model: "gpt-6.1-sol" }),
    error => error instanceof AtlasApiError && error.code === "model_output_invalid");
});
