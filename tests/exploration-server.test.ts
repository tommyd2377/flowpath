import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createClient } from "@libsql/client";

import { createExplorationService, FIXTURE_HEADLINES } from "../lib/exploration-server";
import type { EventSnapshot, HeadlineItem, PossibilityNode } from "../lib/atlas/contracts";
import { GenerationCacheRepository, resolveGenerationDatabaseConfig } from "../lib/atlas/server/generation-cache";
import { createGenerationService, type GenerationService } from "../lib/atlas/server/generation-service";
import { AtlasApiError } from "../lib/atlas/server/http";
import { createFixtureExpansionResponse, createFixtureStartResponse } from "../lib/atlas/server/fixtures";
import { commitRegisteredExpansion } from "../lib/atlas/server/graph-registry";
import { atlasSafetyIdentifier } from "../lib/atlas/server/request-guard";
import { initialParsedOutput, MockResponsesAdapter } from "../lib/atlas/server/openai-test-fixtures";
import { generationCacheKey, generationFingerprint, StartGenerationTemplateSchema } from "../lib/atlas/server/generation-templates";
import { emptyDisplay, ExplorationDisplaySchema } from "../lib/visual-contracts";

type Exploration = {
  ok: boolean;
  headline: HeadlineItem;
  graphId: string;
  currentNode: PossibilityNode | null;
  lineage: PossibilityNode[];
  choices: PossibilityNode[];
  limits: { callsUsed: number; maxCalls: number; nodesUsed: number; maxDepth: number };
  resumed: boolean;
  snapshotAgeSeconds: number;
  comparison?: Array<{ node: PossibilityNode }>;
  boundary?: { code: string; message: string };
};
const result = (value: object) => value as Exploration;

function harness(t: TestContext) {
  const directory = mkdtempSync(path.join(tmpdir(), "voice-exploration-"));
  const url = `file:${path.join(directory, "isolated.db")}`;
  const repository = new GenerationCacheRepository(createClient({ url }));
  const generation = createGenerationService({ repository, mode: () => "fixture" });
  const make = (custom: GenerationService = generation) => createExplorationService({ repository, generation: custom, headlines: async () => ({ items: FIXTURE_HEADLINES }) });
  t.after(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });
  return { service: make(), make, generation, repository, installationId: randomUUID() };
}

test("restoration is metadata-only; a selected story and path survive a new service", async t => {
  const h = harness(t);
  assert.deepEqual(await h.service.restore(h.installationId), { selectedHeadline: null });
  const start = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  assert.equal(start.choices.length, 3);
  assert.equal(start.limits.callsUsed, 1);
  const selected = result(await h.service.execute(h.installationId, "choose_path", { nodeId: start.choices[0].id }));
  assert.equal(selected.currentNode?.depth, 1);
  assert.equal(selected.choices[0].depth, 2);
  const resumed = h.make();
  const metadata = await resumed.restore(h.installationId);
  assert.deepEqual(Object.keys(metadata), ["selectedHeadline"]);
  const replay = result(await resumed.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  assert.equal(replay.currentNode?.id, selected.currentNode?.id);
  assert.equal(replay.resumed, true);
  assert.equal(replay.limits.callsUsed, 2);
  assert.ok(replay.snapshotAgeSeconds > 0);
});

test("visual restoration reads the selected path without generating or moving it", async t => {
  const h = harness(t);
  assert.deepEqual(await h.service.getDisplay(h.installationId), emptyDisplay());
  const start = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const selected = result(await h.service.execute(h.installationId, 'choose_path', { nodeId: start.choices[0].id }));
  const display = ExplorationDisplaySchema.parse(await h.make().getDisplay(h.installationId));
  assert.equal(display.headline?.id, FIXTURE_HEADLINES[0].id);
  assert.equal(display.exploration?.currentNode?.id, selected.currentNode?.id);
  assert.deepEqual(display.exploration?.choices, selected.choices);
  assert.equal(display.exploration?.limits?.callsUsed, 2);
  assert.equal(display.exploration?.resumed, true);
  assert.equal(display.view, 'exploration');
  assert.equal((await h.service.getDisplay(randomUUID())).headline, null);
  const again = ExplorationDisplaySchema.parse(await h.service.getDisplay(h.installationId));
  assert.equal(again.exploration?.limits?.callsUsed, 2);
});

test("concurrent and repeated selections and choices consume one analysis each", async t => {
  const h = harness(t);
  const [one, two] = await Promise.all([
    h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id),
    h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id),
  ]);
  const start = result(one);
  assert.equal(start.graphId, result(two).graphId);
  const selected = await Promise.all([
    h.service.execute(h.installationId, "choose_path", { nodeId: start.choices[0].id }),
    h.service.execute(h.installationId, "choose_path", { nodeId: start.choices[0].id }),
  ]);
  assert.equal(result(selected[0]).currentNode?.id, result(selected[1]).currentNode?.id);
  assert.equal(result(selected[1]).limits.callsUsed, 2);
  assert.deepEqual(result(selected[0]).choices, result(selected[1]).choices);
});

test("checked research reaches joined selections before a map is saved without another generation", async t => {
  const h = harness(t);
  let release!: () => void, began!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  let starts = 0;
  let expected!: EventSnapshot;
  const service = h.make({
    async start(input, signal, progress) {
      starts++;
      const response = createFixtureStartResponse(input);
      assert.equal(response.kind, 'atlas');
      if (response.kind !== 'atlas') throw new Error('Expected fixture map');
      expected = response.snapshot;
      progress?.onResearch?.({ ...expected, headline: FIXTURE_HEADLINES[1] });
      progress?.onResearch?.({ ...expected, facts: [] });
      progress?.onResearch?.(expected);
      began();
      await barrier;
      return h.generation.start(input, signal);
    }, expand: h.generation.expand,
  });
  const first: EventSnapshot[] = [], joined: EventSnapshot[] = [];
  const pending = service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id, undefined, snapshot => first.push(snapshot));
  await started;
  assert.deepEqual(first, [expected]);
  assert.equal((await service.getDisplay(h.installationId)).exploration, null);
  const second = service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id, undefined, snapshot => joined.push(snapshot));
  assert.deepEqual(joined, [expected]);
  release();
  const [one, two] = await Promise.all([pending, second]);
  assert.equal(result(one).graphId, result(two).graphId);
  assert.equal(starts, 1);
  assert.equal(result(one).limits.callsUsed, 1);
  assert.equal((await service.getDisplay(h.installationId)).exploration?.choices?.length, 3);
});

test("sparse research creates a reusable map without an evidence retry or extra model call", async t => {
  const h = harness(t);
  const parsed = initialParsedOutput();
  parsed.facts = [];
  parsed.sources = [];
  const adapter = new MockResponsesAdapter({ status: "completed", output: [], output_parsed: parsed });
  const service = h.make(createGenerationService({ repository: h.repository, adapter, mode: () => "live" }));
  const first = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const replay = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  assert.equal(first.choices.length, 3);
  assert.equal(first.limits.callsUsed, 1);
  assert.deepEqual(replay.choices, first.choices);
  assert.equal(replay.resumed, true);
  assert.equal(adapter.calls.length, 1);
  assert.equal(await h.repository.getAtlasCallsUsed(first.graphId, atlasSafetyIdentifier(h.installationId)), 1);
});

test("all five levels, backtracking, root navigation, comparisons and saved alternatives work", async t => {
  const h = harness(t);
  const root = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  let current = root;
  for (let depth = 1; depth <= 5; depth++) {
    current = result(await h.service.execute(h.installationId, "choose_path", { nodeId: current.choices[0].id }));
    assert.equal(current.currentNode?.depth, depth);
    assert.equal(current.lineage.length, depth);
  }
  assert.equal(current.choices.length, 0);
  assert.equal(current.currentNode?.status, "leaf");
  assert.equal(current.limits.callsUsed, 5);
  const back = result(await h.service.execute(h.installationId, "navigate_path", { target: "parent" }));
  assert.equal(back.currentNode?.depth, 4);
  const home = result(await h.service.execute(h.installationId, "navigate_path", { target: "root" }));
  assert.equal(home.currentNode, null);
  assert.deepEqual(home.choices.map(node => node.id), root.choices.map(node => node.id));
  const comparison = result(await h.service.execute(h.installationId, "compare_paths", { nodeIds: home.choices.slice(0, 2).map(node => node.id) }));
  assert.equal(comparison.comparison?.length, 2);
  const old = result(await h.service.execute(h.installationId, "navigate_path", { target: "node", nodeId: back.currentNode!.id }));
  assert.equal(old.currentNode?.id, back.currentNode?.id);
  assert.equal(old.limits.callsUsed, 5);
});

test("unknown headlines, cross-installation nodes and forged tool arguments never generate", async t => {
  const h = harness(t);
  await assert.rejects(() => h.service.selectStory(h.installationId, "unknown-headline"), /no longer available/);
  const root = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const secondInstallation = randomUUID();
  await h.service.selectStory(secondInstallation, FIXTURE_HEADLINES[1].id);
  for (const [name, args] of [
    ["choose_path", { nodeId: randomUUID() }],
    ["choose_path", { nodeId: root.choices[0].id, snapshot: {} }],
    ["navigate_path", { target: "node", nodeId: root.choices[1].id }],
    ["compare_paths", { nodeIds: [root.choices[0].id, randomUUID()] }],
    ["get_exploration", { installationId: secondInstallation }],
    ["invent_path", {}],
  ] as Array<[string, Record<string, unknown>]>) {
    await assert.rejects(() => h.service.execute(h.installationId, name, args), error => error instanceof AtlasApiError);
  }
  await assert.rejects(() => h.service.execute(secondInstallation, "choose_path", { nodeId: root.choices[0].id }), /current possibilities/);
  assert.equal(result(await h.service.execute(h.installationId, "get_exploration", {})).limits.callsUsed, 1);
});

test("changing stories during research discards the old selection and keeps graph mappings", async t => {
  const h = harness(t);
  let release!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let starts = 0;
  const service = h.make({
    async start(input, signal) {
      starts++;
      const response = await h.generation.start(input, signal);
      if (input.headline.id === FIXTURE_HEADLINES[0].id) { began(); await barrier; }
      return response;
    }, expand: h.generation.expand,
  });
  const old = service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id);
  const rejected = assert.rejects(old, { name: "AbortError" });
  await started;
  const next = service.selectStory(h.installationId, FIXTURE_HEADLINES[1].id);
  release();
  await rejected;
  const selected = result(await next);
  assert.equal(selected.headline.id, FIXTURE_HEADLINES[1].id);
  assert.equal((await service.restore(h.installationId)).selectedHeadline?.id, FIXTURE_HEADLINES[1].id);
  const recovered = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  assert.equal(recovered.resumed, true);
  assert.equal(starts, 2);
});

test("aborted expansion cannot move the persisted cursor", async t => {
  const h = harness(t);
  const abort = new AbortController();
  const service = h.make({ start: h.generation.start, async expand(input, signal) {
    const response = await h.generation.expand(input, signal);
    abort.abort();
    return response;
  } });
  const root = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  await assert.rejects(() => service.execute(h.installationId, "choose_path", { nodeId: root.choices[0].id }, abort.signal), { name: "AbortError" });
  const restored = result(await h.make().selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  assert.equal(restored.currentNode, null);
  const resumed = result(await h.make().execute(h.installationId, "choose_path", { nodeId: root.choices[0].id }));
  assert.equal(resumed.limits.callsUsed, 2);
});

test("the ten-call cap stops generation while allowing a spoken discussion of the selected path", async t => {
  const h = harness(t);
  const root = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  for (let count = 1; count < 10; count++) await h.repository.reserveAtlasCall({ graphId: root.graphId, installationKey: atlasSafetyIdentifier(h.installationId), now: new Date().toISOString() });
  const bounded = result(await h.service.execute(h.installationId, "choose_path", { nodeId: root.choices[0].id }));
  assert.equal(bounded.boundary?.code, "atlas_call_limit_reached");
  assert.equal(bounded.currentNode?.id, root.choices[0].id);
  const compared = result(await h.service.execute(h.installationId, "compare_paths", { nodeIds: root.choices.slice(0, 2).map(node => node.id) }));
  assert.equal(compared.limits.callsUsed, 10);
});

test("hourly guard is durable across service instances and applies in fixture mode", async t => {
  const h = harness(t);
  const root = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  for (let count = 1; count < 20; count++) await h.repository.reserveInstallationRequest({ installationKey: atlasSafetyIdentifier(h.installationId), reservationToken: randomUUID(), now: Date.now() });
  await assert.rejects(() => h.make().execute(h.installationId, "choose_path", { nodeId: root.choices[0].id }), error => error instanceof AtlasApiError && error.code === "rate_limit_exceeded");
  assert.equal(result(await h.service.execute(h.installationId, "get_exploration", {})).limits.callsUsed, 1);
});

test("local database configuration isolates fixture data and ignores legacy hosted settings", () => {
  assert.equal(resolveGenerationDatabaseConfig({ NODE_ENV: "test" }).url, "file:./data/the-voice.db");
  assert.equal(resolveGenerationDatabaseConfig({ NODE_ENV: "test", VOICE_FIXTURE_MODE: "1" }).url, "file:./data/the-voice-fixture.db");
  assert.equal(resolveGenerationDatabaseConfig({ NODE_ENV: "test", POSSIBILITY_ATLAS_DATABASE_URL: "libsql://flowpath.example" }).url, "file:./data/the-voice.db");
  assert.throws(() => resolveGenerationDatabaseConfig({ NODE_ENV: "test", VOICE_DATABASE_URL: "libsql://remote.example" }), /not authenticated/);
  assert.throws(() => resolveGenerationDatabaseConfig({ NODE_ENV: "test", VOICE_DATABASE_URL: "file:../flowpath/data/atlas.db" }), /invalid/);
});

test("reconnecting to the same article after cancellation does not reuse an aborted promise", async t => {
  const h = harness(t);
  const abort = new AbortController();
  const first = h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id, abort.signal);
  abort.abort();
  const failure = assert.rejects(first, { name: "AbortError" });
  const second = h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id);
  await failure;
  assert.equal(result(await second).headline.id, FIXTURE_HEADLINES[0].id);
});

test("cached verification is reused across isolated installations with fresh graph relationships", async t => {
  const h = harness(t);
  const first = result(await h.service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const other = result(await h.service.selectStory(randomUUID(), FIXTURE_HEADLINES[0].id));
  assert.equal(first.limits.callsUsed, 1);
  assert.equal(other.limits.callsUsed, 0);
  assert.notEqual(first.graphId, other.graphId);
  assert.notEqual(first.choices[0].id, other.choices[0].id);
});

test("the 64-node boundary keeps the selected path usable without attempting another expansion", async t => {
  const h = harness(t);
  let expansions = 0;
  // Seed branches as cache replays, isolating the node cap from the model-call cap.
  const service = h.make({ start: h.generation.start, async expand(input) {
    expansions++;
    return commitRegisteredExpansion(input, randomUUID(), createFixtureExpansionResponse(input), { repository: h.repository });
  } });
  const root = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const queue = [...root.choices];
  for (let index = 0; index < 20; index++) {
    const node = queue[index];
    await service.execute(h.installationId, "navigate_path", node.parentId === root.graphId ? { target: "root" } : { target: "node", nodeId: node.parentId });
    const expanded = result(await service.execute(h.installationId, "choose_path", { nodeId: node.id }));
    queue.push(...expanded.choices);
  }
  const node = queue[20];
  await service.execute(h.installationId, "navigate_path", { target: "node", nodeId: node.parentId });
  const bounded = result(await service.execute(h.installationId, "choose_path", { nodeId: node.id }));
  assert.equal(bounded.limits.nodesUsed, 64);
  assert.equal(bounded.boundary?.code, "node_limit_reached");
  assert.equal(bounded.currentNode?.id, node.id);
  await service.execute(h.installationId, "choose_path", { nodeId: node.id });
  assert.equal(expansions, 20);
});

test("a natural endpoint is saved and discussed without repeatedly generating children", async t => {
  const h = harness(t);
  let expansions = 0;
  const service = h.make({ start: h.generation.start, async expand(input) {
    expansions++;
    return commitRegisteredExpansion(input, randomUUID(), {
      ok: true, kind: "leaf", parentId: input.parentId,
      reason: "Further detail would require facts we do not have.",
      meta: { mode: "fixture", callConsumed: false, cacheStatus: "miss" },
    }, { repository: h.repository });
  } });
  const root = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  const end = result(await service.execute(h.installationId, "choose_path", { nodeId: root.choices[0].id }));
  assert.equal(end.currentNode?.status, "leaf");
  assert.match(end.currentNode?.leafReason ?? "", /facts/);
  assert.deepEqual(end.choices, []);
  await service.execute(h.installationId, "choose_path", { nodeId: root.choices[0].id });
  assert.equal(expansions, 1);
});

test("a failed story switch cannot expose or modify the previously selected exploration", async t => {
  const h = harness(t);
  let expansions = 0;
  const service = h.make({
    async start(input, signal) {
      if (input.headline.id === FIXTURE_HEADLINES[1].id) throw new Error("Simulated research failure.");
      return h.generation.start(input, signal);
    },
    async expand(input, signal) { expansions++; return h.generation.expand(input, signal); },
  });
  const original = result(await service.selectStory(h.installationId, FIXTURE_HEADLINES[0].id));
  await assert.rejects(() => service.selectStory(h.installationId, FIXTURE_HEADLINES[1].id), /Simulated/);
  for (const [name, args] of [
    ["get_exploration", {}],
    ["choose_path", { nodeId: original.choices[0].id }],
  ] as Array<[string, Record<string, unknown>]>) {
    await assert.rejects(() => service.execute(h.installationId, name, args, undefined, FIXTURE_HEADLINES[1].id), error => error instanceof AtlasApiError && error.code === "story_selection_mismatch");
  }
  const unchanged = result(await service.execute(h.installationId, "get_exploration", {}, undefined, FIXTURE_HEADLINES[0].id));
  assert.equal(unchanged.currentNode, null);
  assert.equal(unchanged.limits.callsUsed, 1);
  assert.equal(expansions, 0);
});


test("old negative research templates do not block a fresh analysis of the same headline", async t => {
  const h = harness(t);
  const headline = FIXTURE_HEADLINES[0];
  const model = "gpt-5.6-luna";
  const promptVersion = "start-v4-context-luna";
  await h.repository.put({
    key: generationCacheKey({ kind: "start", model, promptVersion, source: headline }), kind: "start", model, promptVersion,
    sourceFingerprint: generationFingerprint(headline), createdAt: new Date().toISOString(), expiresAt: Date.now() + 600000,
    payload: { kind: "insufficient_evidence", summary: "Old evidence failure", reason: "A citation could not be matched", sources: [] },
  }, StartGenerationTemplateSchema);
  const adapter = new MockResponsesAdapter({ status: "completed", output: [], output_parsed: initialParsedOutput() });
  const service = h.make(createGenerationService({ repository: h.repository, adapter, model, mode: () => "live" }));
  const start = result(await service.selectStory(h.installationId, headline.id));
  assert.equal(start.choices.length, 3);
  assert.equal(start.limits.callsUsed, 1);
  assert.equal(adapter.calls.length, 1);
});
