import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createClient } from "@libsql/client";

import type { EventSnapshot } from "../lib/atlas/contracts";
import { GenerationCacheRepository } from "../lib/atlas/server/generation-cache";
import { createGenerationService } from "../lib/atlas/server/generation-service";
import { generationCacheKey, START_PROMPT_VERSION, StartGenerationTemplateSchema } from "../lib/atlas/server/generation-templates";
import { AtlasApiError } from "../lib/atlas/server/http";
import { headlineFixture, initialParsedOutput, MockResponsesAdapter, searchedResponse } from "../lib/atlas/server/openai-test-fixtures";
import type { AtlasParsedResponse, AtlasRequestOptions, AtlasResponseProgress, AtlasResponsesAdapter, AtlasResponsesRequest } from "../lib/atlas/server/openai-client";
import { atlasSafetyIdentifier } from "../lib/atlas/server/request-guard";
import type { CuratedStory } from "../lib/story-contracts";

const context: CuratedStory = {
  ...headlineFixture, summary: "An attributed catalog summary.", whyItMatters: "A significant policy decision.",
  scope: "both", headlines: [headlineFixture], contextSources: [],
};
const model = "gpt-6.1-sol";
const startInput = () => ({ installationId: randomUUID(), graphId: randomUUID(), headline: headlineFixture });
const cacheKey = (story?: CuratedStory) => generationCacheKey({
  kind: "start", model, promptVersion: START_PROMPT_VERSION,
  source: story ? { headline: headlineFixture, initialCatalogContext: story } : headlineFixture,
});

function repositoryFor(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "voice-generation-progress-"));
  const repository = new GenerationCacheRepository(createClient({ url: `file:${path.join(directory, "isolated.db")}` }));
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  return repository;
}

function streamAdapter(run: (onProgress: (progress: AtlasResponseProgress) => void) => Promise<void> | void) {
  const response = searchedResponse(initialParsedOutput());
  const calls: AtlasResponsesRequest[] = [];
  const adapter: AtlasResponsesAdapter = {
    async parse() { throw new Error("Expected streamed initial generation."); },
    async stream<T>(request: AtlasResponsesRequest, _options: AtlasRequestOptions, onProgress: (progress: AtlasResponseProgress) => void) {
      calls.push(request);
      await run(onProgress);
      return response as AtlasParsedResponse<T>;
    },
  };
  const serialized = JSON.stringify(response.output_parsed);
  return { adapter, calls, progress: { outputText: serialized.slice(0, serialized.indexOf(',"branches":[') + 1), completedOutput: [response.output[0]] } };
}

test("generation publishes research before persistence and reuses its identity only for the completed owner", async t => {
  const repository = repositoryFor(t);
  const input = startInput();
  let finish!: () => void;
  const mapReady = new Promise<void>(resolve => { finish = resolve; });
  const streaming = streamAdapter(async onProgress => { onProgress(streaming.progress); await mapReady; });
  const generation = createGenerationService({ repository, adapter: streaming.adapter, model, mode: () => "live" });
  const snapshots: EventSnapshot[] = [];
  let researchReady!: () => void;
  const ready = new Promise<void>(resolve => { researchReady = resolve; });
  const pending = generation.start(input, undefined, { context, onResearch: snapshot => { snapshots.push(snapshot); researchReady(); } });
  await ready;
  assert.equal(await repository.get(cacheKey(context), StartGenerationTemplateSchema.options[0]), null);
  assert.equal(await repository.getRegisteredGraph(input.graphId), null);
  assert.equal(await repository.getAtlasCallsUsed(input.graphId, atlasSafetyIdentifier(input.installationId)), 1);
  assert.deepEqual(JSON.parse(streaming.calls[0].input[1].content).UNTRUSTED_DATA.initialCatalogContext, context);
  finish();
  const completed = await pending;
  assert.equal(completed.kind, "atlas");
  if (completed.kind !== "atlas") return;
  assert.equal(completed.snapshot.id, snapshots[0].id);
  assert.equal(completed.snapshot.capturedAt, snapshots[0].capturedAt);
  assert.ok(await repository.getRegisteredGraph(input.graphId));
  assert.ok(await repository.get(cacheKey(context), StartGenerationTemplateSchema.options[0]));
  const replay = await generation.start(input, undefined, { context, onResearch: snapshot => snapshots.push(snapshot) });
  assert.equal(replay.kind, "atlas");
  if (replay.kind === "atlas") assert.equal(replay.snapshot.id, completed.snapshot.id);
  const other = await generation.start(startInput(), undefined, { context, onResearch: snapshot => snapshots.push(snapshot) });
  assert.equal(other.meta.callConsumed, false);
  assert.equal(other.kind, "atlas");
  if (other.kind === "atlas") assert.notEqual(other.snapshot.id, completed.snapshot.id);
  assert.equal(snapshots.length, 1);
  assert.equal(streaming.calls.length, 1);
});

test("the initial cache varies with the exact catalog context and preserves headline-only keys", async t => {
  const repository = repositoryFor(t);
  const adapter = new MockResponsesAdapter(searchedResponse(initialParsedOutput()));
  const generation = createGenerationService({ repository, adapter, model, mode: () => "live" });
  await generation.start(startInput());
  assert.ok(await repository.get(cacheKey(), StartGenerationTemplateSchema.options[0]));
  await generation.start(startInput(), undefined, { context });
  const updated = { ...context, whyItMatters: "The significance has changed." };
  await generation.start(startInput(), undefined, { context: updated });
  assert.ok(await repository.get(cacheKey(context), StartGenerationTemplateSchema.options[0]));
  assert.ok(await repository.get(cacheKey(updated), StartGenerationTemplateSchema.options[0]));
  assert.equal(adapter.calls.length, 3);
  assert.deepEqual(JSON.parse(adapter.calls[2].request.input[1].content).UNTRUSTED_DATA.initialCatalogContext, updated);
  const cached = await generation.start(startInput(), undefined, { context: updated });
  assert.equal(cached.meta.callConsumed, false);
  assert.equal(adapter.calls.length, 3);
});

test("mismatched or invalid catalog context never reaches generation or consumes a call", async t => {
  const repository = repositoryFor(t);
  const adapter = new MockResponsesAdapter(searchedResponse(initialParsedOutput()));
  const generation = createGenerationService({ repository, adapter, model, mode: () => "live" });
  const input = startInput();
  await assert.rejects(() => generation.start(input, undefined, { context: { ...context, id: "another-story-001" } }),
    (error: unknown) => error instanceof AtlasApiError && error.code === "story_context_mismatch" && !error.callConsumed);
  await assert.rejects(() => generation.start(input, undefined, { context: { ...context, summary: "" } }));
  assert.equal(adapter.calls.length, 0);
  assert.equal(await repository.getAtlasCallsUsed(input.graphId, atlasSafetyIdentifier(input.installationId)), 0);
  assert.equal(await repository.getRegisteredGraph(input.graphId), null);
});

test("refreshed curation for the same stable story ID remains usable and gets its own cache key", async t => {
  const repository = repositoryFor(t);
  const adapter = new MockResponsesAdapter(searchedResponse(initialParsedOutput()));
  const generation = createGenerationService({ repository, adapter, model, mode: () => "live" });
  const refreshed = { ...context, title: "A refreshed title for the same story", publisher: "Updated News" };
  const result = await generation.start(startInput(), undefined, { context: refreshed });
  assert.equal(result.kind, "atlas");
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(JSON.parse(adapter.calls[0].request.input[1].content).UNTRUSTED_DATA.initialCatalogContext, refreshed);
  assert.ok(await repository.get(cacheKey(refreshed), StartGenerationTemplateSchema.options[0]));
  assert.equal(await repository.get(cacheKey(context), StartGenerationTemplateSchema.options[0]), null);
});

test("stream failure after research spends one call while leaving cache and graph uncommitted", async t => {
  const repository = repositoryFor(t);
  const input = startInput();
  const streaming = streamAdapter(onProgress => { onProgress(streaming.progress); throw new Error("Interrupted stream."); });
  const generation = createGenerationService({ repository, adapter: streaming.adapter, model, mode: () => "live" });
  const snapshots: EventSnapshot[] = [];
  await assert.rejects(() => generation.start(input, undefined, { context, onResearch: snapshot => snapshots.push(snapshot) }),
    (error: unknown) => error instanceof AtlasApiError && error.callConsumed);
  assert.equal(snapshots.length, 1);
  assert.equal(streaming.calls.length, 1);
  assert.equal(await repository.get(cacheKey(context), StartGenerationTemplateSchema.options[0]), null);
  assert.equal(await repository.getRegisteredGraph(input.graphId), null);
  assert.equal(await repository.getAtlasCallsUsed(input.graphId, atlasSafetyIdentifier(input.installationId)), 1);
});

test("fixture generation emits its complete snapshot before the registered final map", async t => {
  const repository = repositoryFor(t);
  const generation = createGenerationService({ repository, mode: () => "fixture" });
  const snapshots: EventSnapshot[] = [];
  const result = await generation.start(startInput(), undefined, { context, onResearch: snapshot => snapshots.push(snapshot) });
  assert.equal(snapshots.length, 1);
  assert.equal(result.kind, "atlas");
  if (result.kind === "atlas") assert.equal(result.snapshot.id, snapshots[0].id);
});
