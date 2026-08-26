import assert from "node:assert/strict";
import test from "node:test";

import type {
  EventSnapshot,
  ExpandAtlasResponse,
  HeadlineItem,
  PossibilityNode,
  StartAtlasResponse,
} from "./contracts";
import { MAX_ATLAS_CALLS } from "./contracts";
import {
  AtlasReducerError,
  atlasReducer,
  createAtlasGraph,
  expansionAvailability,
  lineageForNode,
} from "./atlas-reducer";

const NOW = "2026-08-25T15:00:00.000Z";
const GRAPH_ID = "00000000-0000-4000-8000-000000000999";

function uuid(index: number) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

const headline: HeadlineItem = {
  id: "headline-001",
  title: "A consequential event creates several plausible paths",
  publisher: "Example News",
  publisherUrl: "https://example.com",
  googleNewsUrl: "https://news.google.com/articles/example",
  publishedAt: "2026-08-25T13:00:00.000Z",
};

const snapshot: EventSnapshot = {
  id: uuid(100),
  headline,
  capturedAt: NOW,
  verificationStatus: "corroborated",
  summary: "The cited event is frozen for a bounded scenario exploration.",
  facts: [{ text: "The event occurred.", sourceIds: ["s1"] }],
  uncertainties: ["The next response is not yet known."],
  sources: [
    {
      id: "s1",
      title: "Primary report",
      url: "https://example.com/report",
      domain: "example.com",
    },
  ],
};

function node(index: number, parentId: string, depth: 1 | 2 | 3 | 4 | 5): PossibilityNode {
  return {
    id: uuid(index),
    parentId,
    depth,
    title: `Path ${index}`,
    summary: "A bounded possibility that follows from the current path.",
    whyPlausible: "It follows from one of the cited facts.",
    keyAssumption: "The central actor continues in the same direction.",
    watchFor: ["A public signal"],
    lessLikelyIf: "The central actor changes course.",
    horizon: "Next several weeks",
    childIds: [],
    status: "ready",
    errorMessage: null,
    leafReason: null,
  };
}

function startedGraph() {
  const graph = createAtlasGraph({ id: GRAPH_ID, headline, now: NOW });
  const response: StartAtlasResponse = {
    ok: true,
    kind: "atlas",
    snapshot,
    nodes: [node(1, GRAPH_ID, 1), node(2, GRAPH_ID, 1), node(3, GRAPH_ID, 1)],
    meta: { mode: "fixture", callConsumed: true, cacheStatus: "miss" },
  };
  return atlasReducer(graph, { type: "start_succeeded", response, at: NOW });
}

test("start response atomically installs a verified root level", () => {
  const graph = startedGraph();
  assert.equal(graph.status, "ready");
  assert.equal(graph.callsUsed, 1);
  assert.deepEqual(graph.rootChildIds, [uuid(1), uuid(2), uuid(3)]);
  assert.equal(Object.keys(graph.nodes).length, 3);
  assert.equal(graph.snapshot?.id, snapshot.id);
});

test("a newly applied ripple model call increments only the atlas call counter", () => {
  const graph = startedGraph();
  const result = atlasReducer(graph, {
    type: "ripple_call_recorded",
    at: new Date(Date.parse(NOW) + 1_000).toISOString(),
  });
  assert.equal(result.callsUsed, 2);
  assert.deepEqual(result.nodes, graph.nodes);
  assert.deepEqual(result.rootChildIds, graph.rootChildIds);
});

test("insufficient evidence preserves its summary and clickable-source data", () => {
  const graph = createAtlasGraph({ id: GRAPH_ID, headline, now: NOW });
  const response: StartAtlasResponse = {
    ok: true,
    kind: "insufficient_evidence",
    summary: "The event could not be confirmed consistently.",
    reason: "Only one current report could be tied to the claim.",
    sources: snapshot.sources,
    meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
  };
  const result = atlasReducer(graph, {
    type: "start_succeeded",
    response,
    at: NOW,
  });
  assert.equal(result.status, "insufficient_evidence");
  assert.equal(result.insufficientSummary, "The event could not be confirmed consistently.");
  assert.deepEqual(result.insufficientSources, snapshot.sources);
});

test("an invalid generated level is rejected without mutating the graph", () => {
  const graph = startedGraph();
  const original = structuredClone(graph);
  const badResponse: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId: uuid(1),
    nodes: [node(4, uuid(2), 2), node(5, uuid(1), 2), node(6, uuid(1), 2)],
    meta: { mode: "fixture", callConsumed: true, cacheStatus: "miss" },
  };
  const generating = atlasReducer(graph, {
    type: "expansion_requested",
    parentId: uuid(1),
    at: NOW,
  });
  assert.throws(
    () =>
      atlasReducer(generating, {
        type: "expansion_succeeded",
        parentId: uuid(1),
        response: badResponse,
        at: NOW,
      }),
    AtlasReducerError,
  );
  assert.deepEqual(graph, original);
});

test("expansion commits children and lineage together", () => {
  const graph = startedGraph();
  const generating = atlasReducer(graph, {
    type: "expansion_requested",
    parentId: uuid(1),
    at: NOW,
  });
  const response: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId: uuid(1),
    nodes: [node(4, uuid(1), 2), node(5, uuid(1), 2), node(6, uuid(1), 2)],
    meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
  };
  const expanded = atlasReducer(generating, {
    type: "expansion_succeeded",
    parentId: uuid(1),
    response,
    at: NOW,
  });
  assert.equal(expanded.callsUsed, 2);
  assert.deepEqual(expanded.nodes[uuid(1)].childIds, [uuid(4), uuid(5), uuid(6)]);
  assert.deepEqual(
    lineageForNode(expanded, uuid(4)).map((item) => item.id),
    [uuid(1), uuid(4)],
  );

  const replayed = atlasReducer(expanded, {
    type: "expansion_succeeded",
    parentId: uuid(1),
    response,
    at: NOW,
  });
  assert.deepEqual(replayed, expanded);
});

test("a late failed replay cannot corrupt an already-expanded parent", () => {
  const graph = startedGraph();
  const generating = atlasReducer(graph, {
    type: "expansion_requested",
    parentId: uuid(1),
    at: NOW,
  });
  const response: ExpandAtlasResponse = {
    ok: true,
    kind: "branches",
    parentId: uuid(1),
    nodes: [node(4, uuid(1), 2), node(5, uuid(1), 2), node(6, uuid(1), 2)],
    meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
  };
  const expanded = atlasReducer(generating, {
    type: "expansion_succeeded",
    parentId: uuid(1),
    response,
    at: NOW,
  });
  const afterLateFailure = atlasReducer(expanded, {
    type: "expansion_failed",
    parentId: uuid(1),
    message: "Late duplicate failed.",
    callConsumed: true,
    at: NOW,
  });
  assert.deepEqual(afterLateFailure, expanded);
});

test("a leaf response closes only the requested path", () => {
  const graph = atlasReducer(startedGraph(), {
    type: "expansion_requested",
    parentId: uuid(2),
    at: NOW,
  });
  const response: ExpandAtlasResponse = {
    ok: true,
    kind: "leaf",
    parentId: uuid(2),
    reason: "The available evidence no longer supports useful branching.",
    meta: { mode: "live", callConsumed: true, cacheStatus: "miss" },
  };
  const result = atlasReducer(graph, {
    type: "expansion_succeeded",
    parentId: uuid(2),
    response,
    at: NOW,
  });
  assert.equal(result.nodes[uuid(2)].status, "leaf");
  assert.match(result.nodes[uuid(2)].leafReason ?? "", /no longer supports/);
  assert.equal(result.nodes[uuid(1)].status, "ready");
});

test("availability permits a cache lookup at the call limit", () => {
  const graph = startedGraph();
  assert.equal(expansionAvailability(graph, uuid(1)).allowed, true);
  const exhausted = { ...graph, callsUsed: MAX_ATLAS_CALLS };
  assert.deepEqual(expansionAvailability(exhausted, uuid(1)), {
    allowed: true,
    remainingNodeCapacity: 60,
  });
});

test("registration reconciliation raises the browser call count but never lowers it", () => {
  const graph = startedGraph();
  const reconciled = atlasReducer(graph, {
    type: "calls_reconciled",
    callsUsed: 4,
    at: new Date(Date.parse(NOW) + 1_000).toISOString(),
  });
  assert.equal(reconciled.callsUsed, 4);
  assert.equal(
    atlasReducer(reconciled, {
      type: "calls_reconciled",
      callsUsed: 2,
      at: new Date(Date.parse(NOW) + 2_000).toISOString(),
    }).callsUsed,
    4,
  );
});

test("interrupted generation becomes a retryable inline error", () => {
  const graph = atlasReducer(startedGraph(), {
    type: "expansion_requested",
    parentId: uuid(3),
    at: NOW,
  });
  const recovered = atlasReducer(graph, { type: "recover_interrupted", at: NOW });
  assert.equal(recovered.nodes[uuid(3)].status, "error");
  assert.match(recovered.nodes[uuid(3)].errorMessage ?? "", /interrupted/i);
  assert.equal(recovered.nodes[uuid(3)].errorRetryable, true);
});

test("start and expansion failures preserve whether an explicit retry is safe", () => {
  const initial = createAtlasGraph({ id: GRAPH_ID, headline, now: NOW });
  const failedStart = atlasReducer(initial, {
    type: "start_failed",
    message: "The request cannot be retried.",
    callConsumed: false,
    retryable: false,
    at: NOW,
  });
  assert.equal(failedStart.errorRetryable, false);
  const retryingStart = atlasReducer(failedStart, { type: "start_requested", at: NOW });
  assert.equal(retryingStart.errorRetryable, null);

  const generating = atlasReducer(startedGraph(), {
    type: "expansion_requested",
    parentId: uuid(1),
    at: NOW,
  });
  const failedExpansion = atlasReducer(generating, {
    type: "expansion_failed",
    parentId: uuid(1),
    message: "This lineage is no longer valid.",
    callConsumed: true,
    retryable: false,
    at: NOW,
  });
  assert.equal(failedExpansion.nodes[uuid(1)].errorRetryable, false);
  assert.equal(failedExpansion.callsUsed, 2);
});
