import assert from "node:assert/strict";
import test from "node:test";
import OpenAI, { APIUserAbortError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

import { createAtlasResponsesAdapter, type AtlasResponseProgress, type AtlasResponsesRequest } from "../lib/atlas/server/openai-client";
import { GenerationCacheRepository } from "../lib/atlas/server/generation-cache";
import { createGenerationService } from "../lib/atlas/server/generation-service";
import { headlineFixture, initialParsedOutput, searchedResponse, sourceUrls } from "../lib/atlas/server/openai-test-fixtures";
import type { EventSnapshot } from "../lib/atlas/contracts";

const request: AtlasResponsesRequest = {
  model: "gpt-6-luna", service_tier: "priority", store: false, reasoning: { effort: "low" }, max_output_tokens: 100,
  input: [{ role: "user", content: "Offline SDK stream fixture." }],
  text: { format: zodTextFormat(z.object({ summary: z.string() }).strict(), "offline_stream"), verbosity: "low" },
};
const encodeEvent = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const created = { id: "resp_offline", status: "in_progress", output: [] };

function stalledSDK() {
  let calls = 0;
  let signal: AbortSignal | undefined;
  let headersReady!: () => void;
  const headers = new Promise<void>(resolve => { headersReady = resolve; });
  const client = new OpenAI({
    apiKey: "offline-test-key-never-sent", maxRetries: 0,
    fetch: async (_url, init) => {
      calls += 1;
      signal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encodeEvent({ type: "response.created", response: created, sequence_number: 0 }));
        signal?.addEventListener("abort", () => controller.error(new DOMException("Offline stream aborted.", "AbortError")), { once: true });
      } });
      headersReady();
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  return { adapter: createAtlasResponsesAdapter(async () => client), headers, calls: () => calls, signal: () => signal };
}

test("the production stream adapter times out a stalled SSE body after headers without retrying", async () => {
  const fixture = stalledSDK();
  const caller = new AbortController();
  const began = Date.now();
  // A watchdog also terminates a regression, instead of leaving a hanging test.
  const watchdog = setTimeout(() => caller.abort(), 500);
  try {
    await assert.rejects(() => fixture.adapter.stream!(request, { timeout: 25, maxRetries: 0, signal: caller.signal }, () => {}), APIUserAbortError);
    assert.ok(Date.now() - began < 400, "The adapter lifetime timer must fire before the watchdog.");
    assert.equal(caller.signal.aborted, false);
    assert.equal(fixture.signal()?.aborted, true);
    assert.equal(fixture.calls(), 1);
  } finally { clearTimeout(watchdog); caller.abort(); }
});

test("the production stream adapter preserves caller cancellation after SSE headers", async () => {
  const fixture = stalledSDK();
  const caller = new AbortController();
  const pending = fixture.adapter.stream!(request, { timeout: 5_000, maxRetries: 0, signal: caller.signal }, () => {});
  const rejected = assert.rejects(pending, APIUserAbortError);
  await fixture.headers;
  caller.abort();
  await rejected;
  assert.equal(fixture.signal()?.aborted, true);
  assert.equal(fixture.calls(), 1);
});

test("the production stream adapter preserves incompletion metadata when final JSON is truncated", async () => {
  const serialized = '{"summary":"An unfinished offline report';
  const message = { id: "msg_offline", type: "message", role: "assistant", status: "incomplete", content: [{ type: "output_text", text: serialized, annotations: [] }] };
  const events = [
    { type: "response.created", response: created },
    { type: "response.output_item.added", output_index: 0, item: { ...message, content: [], status: "in_progress" } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: serialized },
    { type: "response.output_item.done", output_index: 0, item: message },
    { type: "response.incomplete", response: { ...created, status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [message] } },
  ];
  let calls = 0;
  const client = new OpenAI({
    apiKey: "offline-test-key-never-sent", maxRetries: 0,
    fetch: async () => {
      calls += 1;
      return new Response(events.map((event, index) => `data: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const adapter = createAtlasResponsesAdapter(async () => client);
  const response = await adapter.stream!(request, { timeout: 1_000, maxRetries: 0 }, () => {});
  assert.equal(response.status, "incomplete");
  assert.deepEqual(response.incomplete_details, { reason: "max_output_tokens" });
  assert.equal(response.output_parsed, null);
  assert.deepEqual(response.output, [message]);
  assert.equal(calls, 1);
});

test("the production stream adapter accumulates text and completed search metadata before parsing the final result", async () => {
  const summary = { summary: "Completed fixture context." };
  const serialized = JSON.stringify(summary);
  const search = { id: "ws_offline", type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: "https://fixture.example/report" }] } };
  const message = { id: "msg_offline", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: serialized, annotations: [] }] };
  const events = [
    { type: "response.created", response: created },
    { type: "response.output_item.added", output_index: 0, item: { ...search, status: "in_progress" } },
    { type: "response.output_item.done", output_index: 0, item: search },
    { type: "response.output_item.added", output_index: 1, item: { ...message, content: [], status: "in_progress" } },
    { type: "response.content_part.added", output_index: 1, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: serialized.slice(0, 12) },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: serialized.slice(12) },
    { type: "response.output_item.done", output_index: 1, item: message },
    { type: "response.completed", response: { ...created, status: "completed", output: [search, message] } },
  ];
  let signal: AbortSignal | undefined;
  let calls = 0;
  const client = new OpenAI({
    apiKey: "offline-test-key-never-sent", maxRetries: 0,
    fetch: async (_url, init) => {
      calls += 1;
      const sent = JSON.parse(String(init?.body));
      assert.equal(sent.model, "gpt-6-luna");
      assert.equal(sent.service_tier, "priority");
      signal = init?.signal ?? undefined;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        events.forEach((event, index) => controller.enqueue(encodeEvent({ ...event, sequence_number: index })));
        controller.close();
      } }), { headers: { "content-type": "text/event-stream" } });
    },
  });
  const adapter = createAtlasResponsesAdapter(async () => client);
  const progress: AtlasResponseProgress[] = [];
  const response = await adapter.stream!(request, { timeout: 25, maxRetries: 0 }, update => progress.push(update));
  assert.deepEqual(response.output_parsed, summary);
  assert.deepEqual(progress[0], { outputText: "", completedOutput: [search] });
  assert.equal(progress[1].outputText, serialized.slice(0, 12));
  assert.equal(progress[2].outputText, serialized);
  assert.deepEqual(progress[2].completedOutput, [search]);
  assert.equal(calls, 1);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(signal?.aborted, false, "A successful response clears its lifetime timer.");
});

test("actual SDK streaming retains complete long research through durable map reload and cache replay", async t => {
  const parsed = initialParsedOutput();
  const longFact = `A long claim ${"with important detail ".repeat(35)}unless its qualification applies.`;
  parsed.facts.push({ text: longFact, sourceUrls: [sourceUrls.alpha] });
  parsed.summary = `A detailed summary ${"with relevant background ".repeat(45)}The decision remains pending.`;
  parsed.uncertainties = [`An unresolved question ${"with procedural detail ".repeat(20)}and no established outcome.`];
  const serialized = JSON.stringify(parsed);
  const split = serialized.indexOf(',"branches":[') + 1;
  const search = searchedResponse(parsed).output[0];
  const message = { id: "msg_offline", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: serialized, annotations: [] }] };
  const events = [
    { type: "response.created", response: created },
    { type: "response.output_item.added", output_index: 0, item: search },
    { type: "response.output_item.done", output_index: 0, item: search },
    { type: "response.output_item.added", output_index: 1, item: { ...message, content: [], status: "in_progress" } },
    { type: "response.content_part.added", output_index: 1, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: serialized.slice(0, split) },
    { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: serialized.slice(split) },
    { type: "response.output_item.done", output_index: 1, item: message },
    { type: "response.completed", response: { ...created, status: "completed", output: [search, message] } },
  ];
  let calls = 0;
  const client = new OpenAI({ apiKey: "offline-test-key-never-sent", maxRetries: 0, fetch: async () => {
    calls += 1;
    return new Response(events.map((event, index) => `data: ${JSON.stringify({ ...event, sequence_number: index })}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  const directory = mkdtempSync(path.join(tmpdir(), "voice-full-research-"));
  const databaseUrl = `file:${path.join(directory, "isolated.db")}`;
  const repository = new GenerationCacheRepository(createClient({ url: databaseUrl }));
  let reloadedRepository: GenerationCacheRepository | undefined = undefined;
  t.after(() => { repository.close(); reloadedRepository?.close(); rmSync(directory, { recursive: true, force: true }); });
  const generation = createGenerationService({ repository, adapter: createAtlasResponsesAdapter(async () => client), mode: () => "live" });
  const input = { installationId: randomUUID(), graphId: randomUUID(), headline: headlineFixture };
  const snapshots: EventSnapshot[] = [];
  const response = await generation.start(input, undefined, { onResearch: snapshot => snapshots.push(snapshot) });
  assert.equal(response.kind, "atlas");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].facts.length, 2);
  assert.equal(snapshots[0].facts[0].text, parsed.facts[0].text);
  assert.equal(snapshots[0].facts[0].sourceIds.length, 2);
  assert.equal(snapshots[0].facts[1].text, longFact);
  assert.equal(snapshots[0].facts[1].sourceIds.length, 1);
  assert.equal(snapshots[0].summary, parsed.summary);
  assert.deepEqual(snapshots[0].uncertainties, parsed.uncertainties);
  if (response.kind !== "atlas") return;
  assert.equal(response.nodes.length, 3);
  assert.deepEqual(response.snapshot.facts, snapshots[0].facts);
  assert.ok(await repository.getRegisteredGraph(input.graphId));
  repository.close();
  reloadedRepository = new GenerationCacheRepository(createClient({ url: databaseUrl }));
  const reloaded = createGenerationService({ repository: reloadedRepository, adapter: createAtlasResponsesAdapter(async () => client), mode: () => "live" });
  const replay = await reloaded.start(input);
  assert.equal(replay.kind, "atlas");
  if (replay.kind !== "atlas") return;
  assert.deepEqual(replay.snapshot, response.snapshot);
  const cached = await reloaded.start({ ...input, installationId: randomUUID(), graphId: randomUUID() });
  assert.equal(cached.kind, "atlas");
  if (cached.kind !== "atlas") return;
  assert.equal(cached.meta.callConsumed, false);
  assert.equal(cached.snapshot.facts[1].text, longFact);
  assert.equal(cached.snapshot.summary, parsed.summary);
  assert.deepEqual(cached.snapshot.uncertainties, parsed.uncertainties);
  assert.equal(calls, 1);
});
