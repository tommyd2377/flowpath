import assert from "node:assert/strict";
import test from "node:test";

import type { ExpandAtlasRequest } from "../contracts";
import type { RippleEdge, WorldEventSummary } from "../world-contracts";
import { validatePersistedCausalContext } from "./causal-context";
import { AtlasApiError } from "./http";
import { headlineFixture } from "./openai-test-fixtures";

const sourceGraphId = "20000000-0000-4000-8000-000000000001";
const sourceEventId = "70000000-0000-4000-8000-000000000001";
const targetEventId = "70000000-0000-4000-8000-000000000002";
const scenarioNodeId = "30000000-0000-4000-8000-000000000001";

const context: NonNullable<ExpandAtlasRequest["causalContext"]> = {
  sourceGraphId,
  sourceEventId,
  sourceEventTitle: "Source event",
  sourceScenarioNodeId: scenarioNodeId,
  sourceScenarioTitle: "Restricted access",
  sourceScenarioSummary: "Access resumes under a negotiated restriction.",
  targetEventId,
  targetEventTitle: "Target event",
  influence: "amplifies_impact",
  mechanism: "Higher transport costs pass through to the target event.",
};

function event(id: string, title: string): WorldEventSummary {
  return {
    id,
    canonicalTitle: title,
    summary: `${title} summary.`,
    state: "verified",
    revision: 1,
    leadHeadline: { ...headlineFixture, id: `headline-${id}` },
    headlineIds: [`headline-${id}`],
    firstSeenAt: "2026-08-25T12:00:00.000Z",
    lastSeenAt: "2026-08-25T13:00:00.000Z",
    ripplePotential: "high",
    dimensions: { impact: 3, branchability: 2, connectivity: 3, uncertainty: 2 },
  };
}

const edge: RippleEdge = {
  id: "40000000-0000-4000-8000-000000000001",
  sourceEventId,
  sourceScenarioNodeId: scenarioNodeId,
  sourceScenarioTitle: context.sourceScenarioTitle,
  sourceScenarioSummary: context.sourceScenarioSummary,
  targetEventId,
  influence: context.influence,
  strength: "strong",
  confidence: "medium",
  mechanism: context.mechanism,
  horizon: "Coming weeks",
  watchFor: ["A confirming signal"],
  analyzedAt: "2026-08-25T14:00:00.000Z",
};

function repository(overrides: { edges?: RippleEdge[] | null } = {}) {
  return {
    async getCatalogMetadata() {
      return {
        catalogVersion: 2,
        feedFingerprint: "a".repeat(64),
        scannedAt: "2026-08-25T15:00:00.000Z",
      };
    },
    async getWorldEvent(id: string) {
      if (id === sourceEventId) return event(id, context.sourceEventTitle);
      if (id === targetEventId) return event(id, context.targetEventTitle);
      return null;
    },
    async getRippleAnalysis(key: {
      graphId: string;
      scenarioNodeId: string;
      catalogVersion?: number;
    }) {
      assert.deepEqual(key, {
        graphId: sourceGraphId,
        scenarioNodeId,
        catalogVersion: 2,
      });
      return Object.hasOwn(overrides, "edges")
        ? (overrides.edges ?? null)
        : [edge];
    },
  };
}

test("conditional expansion context must exactly match a current persisted edge", async () => {
  assert.deepEqual(
    await validatePersistedCausalContext({
      context,
      targetWorldEventId: targetEventId,
      repository: repository(),
    }),
    context,
  );

  await assert.rejects(
    () =>
      validatePersistedCausalContext({
        context: { ...context, mechanism: "Client-invented mechanism." },
        targetWorldEventId: targetEventId,
        repository: repository(),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "causal_context_stale" &&
      error.callConsumed === false,
  );
});

test("conditional expansion rejects missing or wrong-target current edges", async () => {
  await assert.rejects(
    () =>
      validatePersistedCausalContext({
        context,
        targetWorldEventId: targetEventId,
        repository: repository({ edges: null }),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && /Recheck ripple links/.test(error.message),
  );
  await assert.rejects(
    () =>
      validatePersistedCausalContext({
        context,
        targetWorldEventId: sourceEventId,
        repository: repository(),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "causal_context_stale",
  );
});
