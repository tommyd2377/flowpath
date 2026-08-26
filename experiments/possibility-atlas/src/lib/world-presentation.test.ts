import assert from "node:assert/strict";
import test from "node:test";

import type { WorldEventSummary } from "./world-contracts";
import {
  clusterCountLabel,
  eventActionLabel,
  formatWorldFreshness,
  influencePhrase,
  presentCrossCurrents,
  resolveScenarioTitle,
  worldRefreshCompletionMessage,
} from "./world-presentation";

const NOW = "2026-08-26T14:00:00.000Z";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function event(index: number, state: WorldEventSummary["state"]): WorldEventSummary {
  return {
    id: uuid(index),
    canonicalTitle: `Event ${index}`,
    summary: "A consequential event with unresolved next states.",
    state,
    revision: 1,
    leadHeadline: {
      id: `headline-${index.toString().padStart(3, "0")}`,
      title: `Headline ${index}`,
      publisher: "Example News",
      publisherUrl: "https://example.com",
      googleNewsUrl: `https://news.google.com/articles/${index}`,
      publishedAt: NOW,
    },
    headlineIds: [`headline-${index.toString().padStart(3, "0")}`],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    ripplePotential: "high",
    dimensions: { impact: 2, branchability: 2, connectivity: 2, uncertainty: 2 },
  };
}

const edge = {
  id: uuid(10),
  sourceEventId: uuid(1),
  sourceScenarioNodeId: uuid(20),
  sourceScenarioTitle: "Transit stays restricted",
  sourceScenarioSummary: "Access remains available but is narrowed for several weeks.",
  targetEventId: uuid(2),
  influence: "amplifies_impact" as const,
  strength: "strong" as const,
  confidence: "medium" as const,
  mechanism: "Higher transport costs pass through to prices.",
  horizon: "Several months",
  watchFor: ["Freight rates rise"],
  analyzedAt: NOW,
};

test("world freshness uses concise relative language", () => {
  const now = Date.parse(NOW);
  assert.equal(formatWorldFreshness(null, now), "No saved scan yet");
  assert.equal(formatWorldFreshness(NOW, now), "just now");
  assert.equal(
    formatWorldFreshness(new Date(now - 17 * 60_000).toISOString(), now),
    "17m ago",
  );
  assert.equal(
    formatWorldFreshness(new Date(now - 26 * 60 * 60_000).toISOString(), now),
    "1d ago",
  );
});

test("event actions distinguish connected events from standalone headlines", () => {
  assert.equal(eventActionLabel(event(1, "candidate")), "Verify & explore event");
  assert.equal(eventActionLabel(event(1, "verified")), "Open event atlas");
  assert.equal(eventActionLabel(event(1, "inactive")), "Event inactive");
});

test("scenario titles prefer persisted edge context and retain legacy fallbacks", () => {
  assert.equal(
    resolveScenarioTitle({ ...edge, sourceScenarioTitle: "Persisted scenario" }, {
      atlasGraphs: [{ nodes: { [edge.sourceScenarioNodeId]: { title: "Transit stays restricted" } } }],
    }),
    "Persisted scenario",
  );
  assert.equal(
    resolveScenarioTitle({ ...edge, sourceScenarioTitle: "" }, {
      atlasGraphs: [{ nodes: { [edge.sourceScenarioNodeId]: { title: "Transit stays restricted" } } }],
    }),
    "Transit stays restricted",
  );
  assert.equal(
    resolveScenarioTitle({ ...edge, sourceScenarioTitle: "" }, {
      transitions: [
        {
          sourceEventId: edge.sourceEventId,
          sourceEventTitle: "Event 1",
          sourceScenarioNodeId: edge.sourceScenarioNodeId,
          sourceScenarioTitle: "Negotiated access remains narrow",
          targetEventId: edge.targetEventId,
          targetEventTitle: "Event 2",
          influence: edge.influence,
        },
      ],
    }),
    "Negotiated access remains narrow",
  );
});

test("cross-current presentation keeps only resolvable event pairs", () => {
  const source = event(1, "verified");
  const target = event(2, "candidate");
  assert.deepEqual(
    presentCrossCurrents({ events: [source, target], crossCurrents: [edge] }).map(
      ({ source: from, target: to }) => [from.id, to.id],
    ),
    [[source.id, target.id]],
  );
  assert.deepEqual(
    presentCrossCurrents({ events: [source], crossCurrents: [edge] }),
    [],
  );
});

test("refresh completion copy reports cluster count and cache behavior", () => {
  assert.equal(clusterCountLabel(1), "1 active event cluster");
  assert.equal(clusterCountLabel(3), "3 active event clusters");
  assert.match(
    worldRefreshCompletionMessage({
      events: [event(1, "candidate"), event(2, "verified")],
      feed: { fetchedAt: NOW, feedUpdatedAt: NOW, stale: false, warning: null },
      meta: { mode: "live", callConsumed: false, cacheStatus: "hit" },
    }),
    /2 active event clusters.*retained without another model call/i,
  );
  assert.equal(influencePhrase("amplifies_impact"), "amplify the impact of");
});

test("stale feed completion copy preserves the warning and retention boundary", () => {
  assert.match(
    worldRefreshCompletionMessage({
      events: [event(1, "verified")],
      feed: {
        fetchedAt: NOW,
        feedUpdatedAt: null,
        stale: true,
        warning: "Live headlines were unavailable.",
      },
      meta: { mode: "live", callConsumed: false, cacheStatus: "hit" },
    }),
    /live headlines were unavailable.*retained without reclassification/i,
  );
});
