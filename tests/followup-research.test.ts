import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createClient } from "@libsql/client";

import { createFollowupResearchService, FOLLOWUP_CACHE_TTL_MS, FOLLOWUP_TIMEOUT_MS, type FollowupContext } from "../lib/followup-research";
import { createExplorationService, FIXTURE_HEADLINES } from "../lib/exploration-server";
import { GenerationCacheRepository } from "../lib/atlas/server/generation-cache";
import { createGenerationService } from "../lib/atlas/server/generation-service";
import type { AtlasParsedResponse, AtlasRequestOptions, AtlasResponsesAdapter, AtlasResponsesRequest } from "../lib/atlas/server/openai-client";
import { AtlasApiError } from "../lib/atlas/server/http";
import { atlasSafetyIdentifier } from "../lib/atlas/server/request-guard";

const CONTEXT: FollowupContext = { headline: null, snapshot: null, lineage: [] };
const SOURCE = "https://official.example/current-report";
const QUESTION = "What new evidence would change this outlook?";

function response(overrides: Partial<AtlasParsedResponse<unknown>> = {}): AtlasParsedResponse<unknown> {
  return {
    status: "completed",
    output: [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: SOURCE }] } }],
    output_parsed: {
      status: "supported", findings: [{ text: "The pilot is scheduled to start next month.", sourceUrls: [SOURCE] }],
      implications: ["If the pilot starts on schedule, early results may inform the next policy decision."],
      uncertainties: ["The results are not known yet."], sources: [{ title: "Official pilot report", url: SOURCE }],
    },
    ...overrides,
  };
}

class Adapter implements AtlasResponsesAdapter {
  calls: Array<{ request: AtlasResponsesRequest; options: AtlasRequestOptions }> = [];
  constructor(public operation: () => Promise<AtlasParsedResponse<unknown>> = async () => response()) {}
  async parse<T>(request: AtlasResponsesRequest, options: AtlasRequestOptions): Promise<AtlasParsedResponse<T>> {
    this.calls.push({ request, options });
    return await this.operation() as AtlasParsedResponse<T>;
  }
}

function harness(t: TestContext, adapter = new Adapter()) {
  const directory = mkdtempSync(path.join(tmpdir(), "voice-followup-"));
  const client = createClient({ url: `file:${path.join(directory, "isolated.db")}` });
  const repository = new GenerationCacheRepository(client);
  const research = createFollowupResearchService({ repository, adapter, mode: () => "live" });
  const generation = createGenerationService({ repository, mode: () => "fixture" });
  const service = createExplorationService({ repository, generation, research, headlines: async () => ({ items: FIXTURE_HEADLINES }) });
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  return { adapter, repository, research, generation, service, client, installationId: randomUUID() };
}

test("follow-up research uses one bounded search and returns cited data without a narration script", async t => {
  const h = harness(t);
  const answer = await h.research.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  assert.equal(h.adapter.calls.length, 1);
  const call = h.adapter.calls[0];
  assert.equal(call.request.model, "gpt-5.6-luna");
  assert.equal(call.request.store, false);
  assert.equal(call.request.max_output_tokens, 2200);
  assert.deepEqual(call.request.tools, [{ type: "web_search", search_context_size: "medium" }]);
  assert.equal(call.request.tool_choice, "required");
  assert.equal(call.request.max_tool_calls, 1);
  assert.equal(call.request.parallel_tool_calls, false);
  assert.equal(call.options.timeout, FOLLOWUP_TIMEOUT_MS);
  assert.equal(call.options.maxRetries, 0);
  assert.equal(answer.status, "supported");
  assert.equal(answer.kind, "web_research");
  assert.deepEqual(answer.findings[0].sourceIds, [answer.sources[0].id]);
  assert.equal(answer.sources[0].url, SOURCE);
  assert.equal(answer.snapshotUnchanged, true);
  assert.equal("script" in answer, false);
  assert.match(call.request.input[0].content, /untrusted data/);
  assert.match(call.request.input[0].content, /conditional/);
});

test("missing search citations retain conditional implications without asserting unsupported facts", async t => {
  const h = harness(t);
  const good = response();
  for (const variant of [
    response({ output: [] }),
    response({ output: [{ type: "web_search_call", status: "failed", action: { type: "search", sources: [{ url: SOURCE }] } }] }),
    response({ output_parsed: { ...good.output_parsed as object, findings: [{ text: "Unsupported claim", sourceUrls: ["https://unconsulted.example/claim"] }] } }),
  ]) {
    h.adapter.operation = async () => variant;
    const answer = await h.research.search({ installationId: h.installationId, question: `Question ${h.adapter.calls.length}`, context: CONTEXT });
    assert.equal(answer.status, "partial");
    assert.deepEqual(answer.findings, []);
    assert.match(answer.implications[0], /^If the pilot/);
    assert.doesNotMatch(JSON.stringify(answer), /Unsupported claim|unconsulted.example/);
  }
});

test("an unmatched bibliography entry does not discard an actually consulted finding", async t => {
  const good = response();
  const h = harness(t, new Adapter(async () => response({ output_parsed: {
    ...good.output_parsed as object, sources: [{ title: "Unconsulted", url: "https://unconsulted.example/claim" }],
  } })));
  const answer = await h.research.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  assert.equal(answer.status, "supported");
  assert.equal(answer.findings.length, 1);
  assert.equal(answer.sources[0].url, SOURCE);
  assert.doesNotMatch(JSON.stringify(answer), /unconsulted.example/);
});

test("pending outcomes retain context and conditional implications", async t => {
  const h = harness(t, new Adapter(async () => response({ output_parsed: {
    status: "partial",
    findings: [{ text: "The regional newspaper reports that a transit expansion is under consideration.", sourceUrls: [SOURCE] }],
    implications: ["If the expansion is approved and funded, it could reduce travel times for affected commuters."],
    uncertainties: ["Whether the final plan will be approved is not yet established."],
    sources: [{ title: "Regional reporting", url: SOURCE }],
  } })));
  const answer = await h.research.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  assert.equal(answer.status, "partial");
  assert.match(answer.findings[0].text, /under consideration/);
  assert.match(answer.implications[0], /^If the expansion is approved/);
  assert.equal(answer.snapshotUnchanged, true);
});

test("no new reporting still allows analysis from an explicit premise", async t => {
  const h = harness(t, new Adapter(async () => response({ output: [], output_parsed: {
    status: "partial", findings: [],
    implications: ["If the reported proposal proceeds, its impact would depend on participation and funding."],
    uncertainties: ["The timing and funding are not yet specified."], sources: [],
  } })));
  const answer = await h.research.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  assert.equal(answer.status, "partial");
  assert.deepEqual(answer.findings, []);
  assert.match(answer.implications[0], /^If the reported proposal/);
  assert.deepEqual(answer.sources, []);
});

test("incomplete responses, refusals and transport failures are explicit unavailable results without retries", async t => {
  const h = harness(t);
  const operations = [
    async () => response({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }),
    async () => response({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] }),
    async () => { throw new Error("Private provider diagnostic"); },
  ];
  for (const operation of operations) {
    h.adapter.operation = operation;
    const count = h.adapter.calls.length;
    const answer = await h.research.search({ installationId: h.installationId, question: `Question ${count}`, context: CONTEXT });
    assert.equal(h.adapter.calls.length, count + 1);
    assert.equal(answer.status, "unavailable");
    assert.deepEqual(answer.findings, []);
    assert.equal(JSON.stringify(answer).includes("Private provider"), false);
  }
});

test("identical retrievals deduplicate concurrently and expire after two minutes", async t => {
  const h = harness(t);
  let now = Date.now();
  const research = createFollowupResearchService({ repository: h.repository, adapter: h.adapter, mode: () => "live", now: () => now });
  const input = { installationId: h.installationId, question: QUESTION, context: CONTEXT };
  const results = await Promise.all([research.search(input), research.search(input)]);
  assert.equal(h.adapter.calls.length, 1);
  assert.equal(results[1].cacheStatus, "hit");
  assert.equal((await research.search(input)).cacheStatus, "hit");
  now += FOLLOWUP_CACHE_TTL_MS + 1;
  assert.equal((await research.search(input)).cacheStatus, "miss");
  assert.equal(h.adapter.calls.length, 2);
  await research.search({ ...input, context: { ...CONTEXT, headline: FIXTURE_HEADLINES[0] } });
  assert.equal(h.adapter.calls.length, 3);
});

test("ending a visit clears its ephemeral retrieval cache", async t => {
  const h = harness(t);
  const visit = new AbortController();
  const input = { installationId: h.installationId, question: QUESTION, context: CONTEXT, visitKey: "one" };
  await h.research.search({ ...input, visitSignal: visit.signal });
  visit.abort();
  await h.research.search(input);
  assert.equal(h.adapter.calls.length, 2);
});

test("research questions and results never enter durable database records", async t => {
  const h = harness(t);
  await h.research.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  const templates = await h.client.execute("SELECT * FROM generation_templates");
  const graphs = await h.client.execute("SELECT * FROM registered_graphs");
  const usage = await h.client.execute("SELECT * FROM atlas_call_usage");
  const requests = await h.client.execute("SELECT * FROM installation_requests");
  const state = await h.client.execute("SELECT * FROM installation_generation_state");
  assert.equal(templates.rows.length, 0);
  assert.equal(graphs.rows.length, 0);
  assert.equal(usage.rows.length, 0);
  assert.equal(requests.rows.length, 1);
  assert.equal(JSON.stringify([requests.rows, state.rows]).includes(QUESTION), false);
  assert.equal(JSON.stringify([requests.rows, state.rows]).includes("pilot"), false);
});

test("follow-up searches honor the shared durable hourly guard without touching graph call budgets", async t => {
  const h = harness(t);
  for (let index = 0; index < 20; index++) {
    await h.research.search({ installationId: h.installationId, question: `Distinct follow-up ${index}`, context: CONTEXT });
  }
  const fresh = createFollowupResearchService({ repository: h.repository, adapter: h.adapter, mode: () => "live" });
  await assert.rejects(() => fresh.search({ installationId: h.installationId, question: "Twenty-first search", context: CONTEXT }), error => error instanceof AtlasApiError && error.code === "rate_limit_exceeded");
  assert.equal(h.adapter.calls.length, 20);
  assert.equal((await h.client.execute("SELECT * FROM atlas_call_usage")).rows.length, 0);
});

test("fixture research is deterministic and cannot run in production", async t => {
  const h = harness(t);
  const fixture = createFollowupResearchService({ repository: h.repository, adapter: h.adapter, environment: { NODE_ENV: "test", VOICE_FIXTURE_MODE: "1" } });
  const result = await fixture.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT });
  assert.equal(result.mode, "fixture");
  assert.match(result.findings[0].text, /simulated/);
  assert.equal(h.adapter.calls.length, 0);
  const forbidden = createFollowupResearchService({ repository: h.repository, adapter: h.adapter, environment: { NODE_ENV: "production", VOICE_FIXTURE_MODE: "1" } });
  await assert.rejects(() => forbidden.search({ installationId: h.installationId, question: QUESTION, context: CONTEXT }), error => error instanceof AtlasApiError && error.code === "fixture_mode_forbidden");
});

test("a voice follow-up can search without selecting any headline", async t => {
  const h = harness(t);
  await h.service.search(h.installationId, QUESTION);
  assert.deepEqual(JSON.parse(h.adapter.calls[0].request.input[1].content).context, CONTEXT);
  assert.deepEqual(await h.service.restore(h.installationId), { selectedHeadline: null });
});

test("failed selection B searches only B metadata and never leaks saved story A", async t => {
  const h = harness(t);
  const service = createExplorationService({ repository: h.repository, research: h.research, headlines: async () => ({ items: FIXTURE_HEADLINES }), generation: {
    async start(input, signal) {
      if (input.headline.id === FIXTURE_HEADLINES[1].id) throw new Error("Simulated failure");
      return h.generation.start(input, signal);
    }, expand: h.generation.expand,
  } });
  await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id);
  await assert.rejects(() => service.selectStory(h.installationId, FIXTURE_HEADLINES[1].id));
  await service.search(h.installationId, QUESTION, undefined, FIXTURE_HEADLINES[1].id);
  const context = JSON.parse(h.adapter.calls[0].request.input[1].content).context;
  assert.equal(context.headline.id, FIXTURE_HEADLINES[1].id);
  assert.equal(context.snapshot, null);
  assert.deepEqual(context.lineage, []);
  assert.equal((await service.restore(h.installationId)).selectedHeadline?.id, FIXTURE_HEADLINES[0].id);
  await assert.rejects(() => service.search(h.installationId, QUESTION, undefined, "nonexistent-headline"), /no longer available/);
  assert.equal(h.adapter.calls.length, 1);
});

test("research at depth five and the ten-call cap keeps the graph and frozen snapshot unchanged", async t => {
  const h = harness(t);
  const start = await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id);
  type View = { graphId: string; choices: Array<{ id: string }>; currentNode: { depth: number }; snapshot: unknown };
  let view = start as unknown as View;
  for (let depth = 1; depth <= 5; depth++) view = await h.service.execute(h.installationId, "choose_path", { nodeId: view.choices[0].id }) as unknown as View;
  for (let calls = 5; calls < 10; calls++) await h.repository.reserveAtlasCall({ graphId: view.graphId, installationKey: atlasSafetyIdentifier(h.installationId), now: new Date().toISOString() });
  const before = await h.repository.getRegisteredGraph(view.graphId);
  await h.service.search(h.installationId, QUESTION, undefined, FIXTURE_HEADLINES[0].id);
  const context = JSON.parse(h.adapter.calls[0].request.input[1].content).context;
  assert.equal(context.lineage.at(-1).depth, 5);
  assert.deepEqual(context.snapshot, view.snapshot);
  assert.deepEqual(await h.repository.getRegisteredGraph(view.graphId), before);
  assert.equal(await h.repository.getAtlasCallsUsed(view.graphId, atlasSafetyIdentifier(h.installationId)), 10);
});

test("switching stories cancels and discards an obsolete follow-up result", async t => {
  let release!: (value: AtlasParsedResponse<unknown>) => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const pending = new Promise<AtlasParsedResponse<unknown>>(resolve => { release = resolve; });
  const h = harness(t, new Adapter(async () => { began(); return pending; }));
  await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id);
  const search = h.service.search(h.installationId, QUESTION, undefined, FIXTURE_HEADLINES[0].id);
  const cancelled = assert.rejects(search, { name: "AbortError" });
  await started;
  const next = h.service.selectStory(h.installationId, FIXTURE_HEADLINES[1].id);
  release(response());
  await cancelled;
  await next;
  assert.equal((await h.service.restore(h.installationId)).selectedHeadline?.id, FIXTURE_HEADLINES[1].id);
});
