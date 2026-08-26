import assert from "node:assert/strict";
import test from "node:test";

import type { WorldEventSummary } from "../world-contracts";
import { createFixtureStartResponse } from "./fixtures";
import { AtlasApiError } from "./http";
import {
  headlineFixture,
  MockResponsesAdapter,
  snapshotFixture,
  TEST_UUIDS,
} from "./openai-test-fixtures";
import {
  createRippleGenerationTemplateWithOpenAI,
  loadSavedRippleAnalysis,
  materializeRippleTemplate,
} from "./ripple";
import {
  createMemoryWorldRepository,
  type WorldRepository,
} from "./world-repository";

const installationId = "10000000-0000-4000-8000-000000000001";
const graphId = "20000000-0000-4000-8000-000000000001";
const sourceEventId = "70000000-0000-4000-8000-000000000001";

const start = createFixtureStartResponse({
  installationId,
  graphId,
  headline: headlineFixture,
  worldEventId: sourceEventId,
});
if (start.kind !== "atlas") throw new Error("Expected fixture atlas.");
const scenario = start.nodes[0];

function target(index: number): WorldEventSummary {
  return {
    id: `70000000-0000-4000-8000-${(index + 2).toString().padStart(12, "0")}`,
    canonicalTitle: `Target event ${index}`,
    summary: `Headline-derived target event ${index}.`,
    state: "verified",
    revision: 1,
    leadHeadline: { ...headlineFixture, id: `target-headline-${index}` },
    headlineIds: [`target-headline-${index}`],
    firstSeenAt: "2026-08-25T12:00:00.000Z",
    lastSeenAt: "2026-08-25T13:00:00.000Z",
    ripplePotential: "high",
    dimensions: { impact: 3, branchability: 2, connectivity: 3, uncertainty: 2 },
  };
}

function modelResponse(links = [
  {
    targetEventId: target(0).id,
    influence: "raises_likelihood" as const,
    strength: "moderate" as const,
    confidence: "medium" as const,
    mechanism: "The conditional scenario changes a shared policy pressure.",
    horizon: "Coming weeks",
    watchFor: ["A confirming announcement"],
  },
]) {
  return {
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "{}", annotations: [] }],
      },
    ],
    output_parsed: {
      kind: "ripples",
      links,
      noCredibleReason: null,
    },
  };
}

function context(targetEvents = [target(0), target(1)]) {
  return {
    input: {
      installationId,
      graphId,
      worldEventId: sourceEventId,
      scenarioNodeId: scenario.id,
    },
    snapshot: snapshotFixture,
    scenario,
    targetEvents,
  };
}

test("ripple analysis is a single strict, stateless Sol request with no tools", async () => {
  const adapter = new MockResponsesAdapter(modelResponse());
  const template = await createRippleGenerationTemplateWithOpenAI(context(), {
    adapter,
    model: "gpt-5.6-sol",
  });

  assert.equal(adapter.calls.length, 1);
  const call = adapter.calls[0];
  assert.equal(call.request.model, "gpt-5.6-sol");
  assert.equal(call.request.store, false);
  assert.deepEqual(call.request.reasoning, { effort: "low" });
  assert.equal(Object.hasOwn(call.request, "tools"), false);
  assert.equal(Object.hasOwn(call.request, "tool_choice"), false);
  assert.equal(Object.hasOwn(call.request, "previous_response_id"), false);
  assert.equal(call.options.timeout, 40_000);
  assert.equal(call.options.maxRetries, 0);
  const format = call.request.text.format as Record<string, unknown>;
  assert.equal(format.type, "json_schema");
  assert.equal(format.name, "possibility_atlas_ripple_analysis");
  assert.equal(format.strict, true);
  assert.equal(template.kind, "ripples");

  const response = materializeRippleTemplate(
    template,
    {
      sourceEventId,
      sourceScenarioNodeId: scenario.id,
      sourceScenarioTitle: scenario.title,
      sourceScenarioSummary: scenario.summary,
      targetEvents: context().targetEvents,
    },
    {
      mode: "live",
      callConsumed: true,
      cacheStatus: "miss",
      now: () => new Date("2026-08-25T14:00:00.000Z"),
      createId: () => TEST_UUIDS[5],
    },
  );
  assert.equal(response.kind, "ripples");
  if (response.kind !== "ripples") return;
  assert.equal(response.edges[0].sourceEventId, sourceEventId);
  assert.equal(response.edges[0].sourceScenarioNodeId, scenario.id);
  assert.equal(response.edges[0].analyzedAt, "2026-08-25T14:00:00.000Z");
  assert.equal(response.targetEvents[0].id, target(0).id);
});

test("ripple analysis rejects unknown and duplicate target IDs atomically", async () => {
  const duplicate = {
    ...modelResponse().output_parsed.links[0],
  };
  const adapter = new MockResponsesAdapter(modelResponse([duplicate, duplicate]));
  await assert.rejects(
    () =>
      createRippleGenerationTemplateWithOpenAI(context(), {
        adapter,
        model: "gpt-5.6-sol",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "model_output_invalid",
  );
  assert.equal(adapter.calls.length, 1);

  const unknownAdapter = new MockResponsesAdapter(
    modelResponse([
      { ...duplicate, targetEventId: "70000000-0000-4000-8000-999999999999" },
    ]),
  );
  await assert.rejects(
    () =>
      createRippleGenerationTemplateWithOpenAI(context(), {
        adapter: unknownAdapter,
        model: "gpt-5.6-sol",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "model_output_invalid",
  );
  assert.equal(unknownAdapter.calls.length, 1);
});

test("no eligible targets returns an early no-link template without a model call", async () => {
  const adapter = new MockResponsesAdapter(modelResponse());
  const result = await createRippleGenerationTemplateWithOpenAI(context([]), {
    adapter,
    model: "gpt-5.6-sol",
  });
  assert.equal(result.kind, "no_credible_links");
  assert.equal(adapter.calls.length, 0);
});

test("incomplete ripple output fails without a repair call", async () => {
  const response = modelResponse();
  response.status = "incomplete";
  const adapter = new MockResponsesAdapter({
    ...response,
    incomplete_details: { reason: "max_output_tokens" },
  });
  await assert.rejects(
    () =>
      createRippleGenerationTemplateWithOpenAI(context(), {
        adapter,
        model: "gpt-5.6-sol",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "model_incomplete",
  );
  assert.equal(adapter.calls.length, 1);
});

test("graph ripple analysis hits within one catalog version and replaces on change", async () => {
  const repository = createMemoryWorldRepository();
  const baseEdge = {
    id: TEST_UUIDS[5],
    sourceEventId,
    sourceScenarioNodeId: scenario.id,
    sourceScenarioTitle: scenario.title,
    sourceScenarioSummary: scenario.summary,
    targetEventId: target(0).id,
    influence: "raises_likelihood" as const,
    strength: "moderate" as const,
    confidence: "medium" as const,
    mechanism: "The scenario changes a shared policy pressure.",
    horizon: "Coming weeks",
    watchFor: ["A confirming announcement"],
    analyzedAt: "2026-08-25T14:00:00.000Z",
  };
  const key = { graphId, scenarioNodeId: scenario.id };

  await repository.commitRippleAnalysis({
    ...key,
    sourceEventId,
    sourceScenarioTitle: scenario.title,
    sourceScenarioSummary: scenario.summary,
    catalogVersion: 1,
    analyzedAt: baseEdge.analyzedAt,
    edges: [baseEdge],
  });
  assert.deepEqual(
    await repository.getRippleAnalysis({ ...key, catalogVersion: 1 }),
    [baseEdge],
  );
  assert.equal(
    await repository.getRippleAnalysis({ ...key, catalogVersion: 2 }),
    null,
  );

  const replacement = {
    ...baseEdge,
    id: "00000000-0000-4000-8000-000000000099",
    influence: "delays" as const,
    mechanism: "New catalog evidence changes the credible relationship.",
    analyzedAt: "2026-08-25T15:00:00.000Z",
  };
  await repository.commitRippleAnalysis({
    ...key,
    sourceEventId,
    sourceScenarioTitle: scenario.title,
    sourceScenarioSummary: scenario.summary,
    catalogVersion: 2,
    analyzedAt: replacement.analyzedAt,
    edges: [replacement],
  });
  assert.deepEqual(await repository.getRippleAnalysis(key), [replacement]);
  assert.equal(
    await repository.getRippleAnalysis({ ...key, catalogVersion: 1 }),
    null,
  );
});

type SavedRippleRepository = Pick<
  WorldRepository,
  | "getCatalogMetadata"
  | "getRippleAnalysisResult"
  | "getWorldEvent"
  | "listEligibleTargetEvents"
>;

const savedEdge = {
  id: TEST_UUIDS[5],
  sourceEventId,
  sourceScenarioNodeId: scenario.id,
  sourceScenarioTitle: scenario.title,
  sourceScenarioSummary: scenario.summary,
  targetEventId: target(0).id,
  influence: "raises_likelihood" as const,
  strength: "moderate" as const,
  confidence: "medium" as const,
  mechanism: "The scenario changes a shared policy pressure.",
  horizon: "Coming weeks",
  watchFor: ["A confirming announcement"],
  analyzedAt: "2026-08-25T14:00:00.000Z",
};

function savedRippleRepository(options: {
  sourceState?: WorldEventSummary["state"];
  currentEdges?: typeof savedEdge[] | null;
  priorEdges?: typeof savedEdge[] | null;
  eligibleTargets?: WorldEventSummary[];
  noCredibleReason?: string | null;
} = {}): SavedRippleRepository {
  const currentEdges = Object.hasOwn(options, "currentEdges")
    ? (options.currentEdges ?? null)
    : [savedEdge];
  const priorEdges = Object.hasOwn(options, "priorEdges")
    ? (options.priorEdges ?? null)
    : currentEdges;
  return {
    async getCatalogMetadata() {
      return {
        catalogVersion: 2,
        feedFingerprint: "a".repeat(64),
        scannedAt: "2026-08-25T15:00:00.000Z",
      };
    },
    async getRippleAnalysisResult(key) {
      const edges = key.catalogVersion === undefined
        ? priorEdges
        : currentEdges;
      return edges === null
        ? null
        : {
            edges,
            noCredibleReason: options.noCredibleReason ?? null,
          };
    },
    async getWorldEvent(id) {
      if (id !== sourceEventId) return null;
      return { ...target(2), id, state: options.sourceState ?? "verified" };
    },
    async listEligibleTargetEvents() {
      return options.eligibleTargets ?? [target(0)];
    },
  };
}

const savedRippleRequest = {
  installationId,
  graphId,
  worldEventId: sourceEventId,
  scenarioNodeId: scenario.id,
};

test("saved ripple replay requires the current catalog and eligible targets", async () => {
  const result = await loadSavedRippleAnalysis({
    repository: savedRippleRepository(),
    request: savedRippleRequest,
    mode: "live",
  });
  assert.equal(result.kind, "ripples");
  assert.deepEqual(result.meta, {
    mode: "live",
    callConsumed: false,
    cacheStatus: "hit",
  });
  if (result.kind === "ripples") {
    assert.equal(result.targetEvents[0].id, target(0).id);
  }

  await assert.rejects(
    () =>
      loadSavedRippleAnalysis({
        repository: savedRippleRepository({
          currentEdges: null,
          priorEdges: [savedEdge],
        }),
        request: savedRippleRequest,
        mode: "live",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "ripple_analysis_stale" &&
      error.callConsumed === false,
  );

  await assert.rejects(
    () =>
      loadSavedRippleAnalysis({
        repository: savedRippleRepository({ eligibleTargets: [] }),
        request: savedRippleRequest,
        mode: "live",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "ripple_analysis_stale" &&
      error.callConsumed === false,
  );
});

test("saved no-link replay preserves the validated reason exactly", async () => {
  const result = await loadSavedRippleAnalysis({
    repository: savedRippleRepository({
      currentEdges: [],
      priorEdges: [],
      noCredibleReason: "The candidate paths do not share a credible mechanism.",
    }),
    request: savedRippleRequest,
    mode: "live",
  });
  assert.equal(result.kind, "no_credible_links");
  if (result.kind === "no_credible_links") {
    assert.equal(
      result.reason,
      "The candidate paths do not share a credible mechanism.",
    );
  }
});

test("saved ripple replay rejects an unverified source without consuming a call", async () => {
  await assert.rejects(
    () =>
      loadSavedRippleAnalysis({
        repository: savedRippleRepository({ sourceState: "candidate" }),
        request: savedRippleRequest,
        mode: "fixture",
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "ripple_source_unavailable" &&
      error.callConsumed === false,
  );
});
