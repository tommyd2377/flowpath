import assert from "node:assert/strict";
import test from "node:test";

import {
  AtlasGraphSchema,
  type AtlasGraph,
  type HeadlineItem,
  type LineageNode,
  type PossibilityNode,
} from "../contracts";
import {
  createFixtureExpansionResponse,
  createFixtureStartResponse,
} from "./fixtures";
import {
  EXPANSION_PROMPT_VERSION,
  ExpansionGenerationTemplateSchema,
  expansionResponseToTemplate,
  generationCacheKey,
  generationFingerprint,
  semanticExpansionSource,
  START_PROMPT_VERSION,
  StartGenerationTemplateSchema,
  startResponseToTemplate,
} from "./generation-templates";
import { registerSavedAtlas } from "./graph-registration";
import {
  resetRegisteredGraphsForTests,
  validateRegisteredExpansion,
} from "./graph-registry";
import { AtlasApiError } from "./http";
import { headlineFixture } from "./openai-test-fixtures";
import {
  atlasSafetyIdentifier,
  resetAtlasRequestGuardForTests,
  runWithAtlasRequestGuard,
} from "./request-guard";
import { createFixtureWorldClassification } from "./world-fixtures";
import { createMemoryWorldRepository } from "./world-repository";

const installationId = "10000000-0000-4000-8000-000000000001";
const graphId = "20000000-0000-4000-8000-000000000001";

test.beforeEach(() => {
  resetRegisteredGraphsForTests();
  resetAtlasRequestGuardForTests();
});

function graphFromStart(input: {
  headline: HeadlineItem;
  worldEventId?: string;
  callsUsed?: number;
  graphId?: string;
}): AtlasGraph {
  const selectedGraphId = input.graphId ?? graphId;
  const start = createFixtureStartResponse({
    installationId,
    graphId: selectedGraphId,
    headline: input.headline,
    worldEventId: input.worldEventId,
  });
  if (start.kind !== "atlas") throw new Error("Expected fixture atlas.");
  return AtlasGraphSchema.parse({
    id: selectedGraphId,
    createdAt: "2026-08-25T16:00:00.000Z",
    updatedAt: "2026-08-25T16:00:00.000Z",
    headline: input.headline,
    status: "ready",
    snapshot: start.snapshot,
    nodes: Object.fromEntries(start.nodes.map((node) => [node.id, node])),
    rootChildIds: start.nodes.map((node) => node.id),
    focusedNodeId: start.nodes[0]!.id,
    callsUsed: input.callsUsed ?? 0,
    errorMessage: null,
    insufficientReason: null,
    insufficientSummary: null,
    insufficientSources: [],
  });
}

function lineageForGraphNode(graph: AtlasGraph, nodeId: string) {
  const result: LineageNode[] = [];
  let current: PossibilityNode | undefined = graph.nodes[nodeId];
  while (current) {
    result.unshift({
      id: current.id,
      parentId: current.parentId,
      depth: current.depth,
      title: current.title,
      summary: current.summary,
      whyPlausible: current.whyPlausible,
      keyAssumption: current.keyAssumption,
      horizon: current.horizon,
    });
    current =
      current.parentId === graph.id
        ? undefined
        : graph.nodes[current.parentId];
  }
  return result;
}

function fixtureExpandedGraph(graph: AtlasGraph, parentId: string) {
  const response = createFixtureExpansionResponse({
    installationId,
    graphId: graph.id,
    parentId,
    snapshot: graph.snapshot!,
    lineage: lineageForGraphNode(graph, parentId),
    remainingNodeCapacity:
      64 - Object.keys(graph.nodes).length - 1,
  });
  if (response.kind !== "branches") {
    throw new Error("Expected fixture branches.");
  }
  return AtlasGraphSchema.parse({
    ...graph,
    nodes: {
      ...graph.nodes,
      [parentId]: {
        ...graph.nodes[parentId]!,
        childIds: response.nodes.map((node) => node.id),
      },
      ...Object.fromEntries(response.nodes.map((node) => [node.id, node])),
    },
  });
}

test("registration rejects a fixture/live mismatch without touching persistence", async () => {
  let repositoryRequested = false;
  await assert.rejects(
    () =>
      registerSavedAtlas(
        {
          installationId,
          expectedMode: "fixture",
          graph: graphFromStart({ headline: headlineFixture }),
        },
        {
          mode: "live",
          getAtlasModel: () => "atlas-model",
          getWorldAtlasModel: () => "world-model",
          getWorldRepository() {
            repositoryRequested = true;
            return createMemoryWorldRepository();
          },
        },
      ),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_mode_mismatch" &&
      error.callConsumed === false,
  );
  assert.equal(repositoryRequested, false);
});

test("fixture world registration rebuilds an empty catalog after restart", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  const group = commit.groups[0]!;
  const headline = group.headlines.find((item) => item.role === "root")!.headline;
  const graph = graphFromStart({ headline, worldEventId: group.eventId });

  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "fixture",
      graph,
      worldAssociation: { eventId: group.eventId, eventRevision: 1 },
    },
    {
      mode: "fixture",
      getAtlasModel: () => "atlas-model",
      getWorldAtlasModel: () => "world-model",
      getWorldRepository: () => repository,
    },
  );

  assert.equal((await repository.getWorldEvent(group.eventId))?.state, "verified");
});

test("fixture world registration rejects tampered root or snapshot semantics", async () => {
  const commit = createFixtureWorldClassification();
  const group = commit.groups[0]!;
  const headline = group.headlines.find((item) => item.role === "root")!.headline;
  const original = graphFromStart({ headline, worldEventId: group.eventId });
  const rootId = original.rootChildIds[0]!;
  const cases: AtlasGraph[] = [
    {
      ...original,
      nodes: {
        ...original.nodes,
        [rootId]: { ...original.nodes[rootId]!, title: "Fabricated scenario" },
      },
    },
    {
      ...original,
      snapshot: {
        ...original.snapshot!,
        capturedAt: "2026-08-25T16:00:01.000Z",
      },
    },
  ];

  for (const graph of cases) {
    resetRegisteredGraphsForTests();
    const repository = createMemoryWorldRepository();
    await repository.commitClassification(commit);
    await assert.rejects(
      () =>
        registerSavedAtlas(
          {
            installationId,
            expectedMode: "fixture",
            graph,
            worldAssociation: { eventId: group.eventId, eventRevision: 1 },
          },
          {
            mode: "fixture",
            getAtlasModel: () => "atlas-model",
            getWorldAtlasModel: () => "world-model",
            getWorldRepository: () => repository,
          },
        ),
      (error: unknown) =>
        error instanceof AtlasApiError &&
        error.code === "world_scenario_provenance_mismatch",
    );
    assert.equal((await repository.getWorldEvent(group.eventId))?.state, "candidate");
  }
});

test("world resume compares semantic snapshots rather than materialized IDs", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const first = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  const second = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
    graphId: "20000000-0000-4000-8000-000000000002",
  });
  const options = {
    mode: "fixture" as const,
    getAtlasModel: () => "atlas-model",
    getWorldAtlasModel: () => "world-model",
    getWorldRepository: () => repository,
  };

  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "fixture",
      graph: first,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    options,
  );
  resetRegisteredGraphsForTests();
  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "fixture",
      graph: second,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    options,
  );
  assert.notEqual(first.snapshot!.id, second.snapshot!.id);
});

test("fixture resume proves completed levels and keeps untouched primary scenarios expandable", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const original = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  const expandedRootId = original.rootChildIds[0]!;
  const graph = fixtureExpandedGraph(original, expandedRootId);
  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "fixture",
      graph,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    {
      mode: "fixture",
      getAtlasModel: () => "atlas-model",
      getWorldAtlasModel: () => "world-model",
      getWorldRepository: () => repository,
    },
  );

  const sibling = graph.nodes[graph.rootChildIds[1]!]!;
  assert.equal(
    validateRegisteredExpansion({
      installationId,
      graphId: graph.id,
      parentId: sibling.id,
      snapshot: graph.snapshot!,
      lineage: lineageForGraphNode(graph, sibling.id),
      remainingNodeCapacity: 57,
    }).parent.id,
    sibling.id,
  );

  const provenChild = graph.nodes[graph.nodes[expandedRootId]!.childIds[0]!]!;
  assert.equal(
    validateRegisteredExpansion({
      installationId,
      graphId: graph.id,
      parentId: provenChild.id,
      snapshot: graph.snapshot!,
      lineage: lineageForGraphNode(graph, provenChild.id),
      remainingNodeCapacity: 57,
    }).parent.id,
    provenChild.id,
  );
});

test("fixture resume rejects descendants whose semantics were changed in browser storage", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const original = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  const expanded = fixtureExpandedGraph(original, original.rootChildIds[0]!);
  const childId = expanded.nodes[expanded.rootChildIds[0]!]!.childIds[0]!;
  const tampered = AtlasGraphSchema.parse({
    ...expanded,
    nodes: {
      ...expanded.nodes,
      [childId]: {
        ...expanded.nodes[childId]!,
        title: "Browser-fabricated descendant",
      },
    },
  });

  await assert.rejects(
    () =>
      registerSavedAtlas(
        {
          installationId,
          expectedMode: "fixture",
          graph: tampered,
          worldAssociation: { eventId: event.id, eventRevision: event.revision },
        },
        {
          mode: "fixture",
          getAtlasModel: () => "atlas-model",
          getWorldAtlasModel: () => "world-model",
          getWorldRepository: () => repository,
        },
      ),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_expansion_provenance_mismatch",
  );
});

test("registration validates exact world revision, headline, and frozen snapshot", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const graph = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  await repository.markEventVerified(event.id, graph.snapshot!);
  const options = {
    mode: "fixture" as const,
    getAtlasModel: () => "atlas-model",
    getWorldAtlasModel: () => "world-model",
    getWorldRepository: () => repository,
  };

  assert.deepEqual(
    await registerSavedAtlas(
      {
        installationId,
        expectedMode: "fixture",
        graph,
        worldAssociation: {
          eventId: event.id,
          eventRevision: event.revision,
        },
      },
      options,
    ),
    { ok: true, graphId, restored: true, callsUsed: 0 },
  );

  resetRegisteredGraphsForTests();
  await assert.rejects(
    () =>
      registerSavedAtlas(
        {
          installationId,
          expectedMode: "fixture",
          graph,
          worldAssociation: {
            eventId: event.id,
            eventRevision: event.revision + 1,
          },
        },
        options,
      ),
    (error: unknown) =>
      error instanceof AtlasApiError && error.code === "world_event_changed",
  );
});

test("live world registration matches roots to the exact start cache record", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const graph = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  await repository.markEventVerified(event.id, graph.snapshot!);
  const model = "world-model";
  const source = { worldEventId: event.id, revision: event.revision };
  const key = generationCacheKey({
    kind: "start",
    model,
    promptVersion: START_PROMPT_VERSION,
    source,
  });
  const response = createFixtureStartResponse({
    installationId,
    graphId,
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  await repository.putGenerationTemplate(
    {
      key,
      kind: "start",
      model,
      promptVersion: START_PROMPT_VERSION,
      sourceFingerprint: generationFingerprint(source),
      payload: startResponseToTemplate(response),
      createdAt: graph.snapshot!.capturedAt,
    },
    StartGenerationTemplateSchema,
  );
  const options = {
    mode: "live" as const,
    getAtlasModel: () => "atlas-model",
    getWorldAtlasModel: () => model,
    getWorldRepository: () => repository,
  };
  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "live",
      graph,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    options,
  );

  resetRegisteredGraphsForTests();
  const rootId = graph.rootChildIds[0]!;
  await assert.rejects(
    () =>
      registerSavedAtlas(
        {
          installationId,
          expectedMode: "live",
          graph: {
            ...graph,
            nodes: {
              ...graph.nodes,
              [rootId]: { ...graph.nodes[rootId]!, summary: "Tampered path." },
            },
          },
          worldAssociation: { eventId: event.id, eventRevision: event.revision },
        },
        options,
      ),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "world_scenario_provenance_mismatch",
  );
});

test("a missing historical expansion cache blocks only that unproven subtree", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const original = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  const graph = fixtureExpandedGraph(original, original.rootChildIds[0]!);
  await repository.markEventVerified(event.id, graph.snapshot!);
  const model = "world-model";
  const source = { worldEventId: event.id, revision: event.revision };
  await repository.putGenerationTemplate(
    {
      key: generationCacheKey({
        kind: "start",
        model,
        promptVersion: START_PROMPT_VERSION,
        source,
      }),
      kind: "start",
      model,
      promptVersion: START_PROMPT_VERSION,
      sourceFingerprint: generationFingerprint(source),
      payload: startResponseToTemplate(
        createFixtureStartResponse({
          installationId,
          graphId,
          headline: event.leadHeadline,
          worldEventId: event.id,
        }),
      ),
      createdAt: graph.snapshot!.capturedAt,
    },
    StartGenerationTemplateSchema,
  );

  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "live",
      graph,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    {
      mode: "live",
      getAtlasModel: () => "atlas-model",
      getWorldAtlasModel: () => model,
      getWorldRepository: () => repository,
    },
  );

  const sibling = graph.nodes[graph.rootChildIds[1]!]!;
  assert.equal(
    validateRegisteredExpansion({
      installationId,
      graphId,
      parentId: sibling.id,
      snapshot: graph.snapshot!,
      lineage: lineageForGraphNode(graph, sibling.id),
      remainingNodeCapacity: 57,
    }).parent.id,
    sibling.id,
  );

  const unprovenChild = graph.nodes[graph.nodes[graph.rootChildIds[0]!]!.childIds[0]!]!;
  assert.throws(
    () =>
      validateRegisteredExpansion({
        installationId,
        graphId,
        parentId: unprovenChild.id,
        snapshot: graph.snapshot!,
        lineage: lineageForGraphNode(graph, unprovenChild.id),
        remainingNodeCapacity: 57,
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_branch_provenance_unavailable",
  );
});

test("live resume recursively proves a completed level from its semantic expansion cache", async () => {
  const repository = createMemoryWorldRepository();
  const commit = createFixtureWorldClassification();
  await repository.commitClassification(commit);
  const event = (await repository.getWorldEvent(commit.groups[0]!.eventId))!;
  const original = graphFromStart({
    headline: event.leadHeadline,
    worldEventId: event.id,
  });
  const expandedRootId = original.rootChildIds[0]!;
  const graph = fixtureExpandedGraph(original, expandedRootId);
  await repository.markEventVerified(event.id, graph.snapshot!);
  const model = "world-model";
  const startSource = { worldEventId: event.id, revision: event.revision };
  await repository.putGenerationTemplate(
    {
      key: generationCacheKey({
        kind: "start",
        model,
        promptVersion: START_PROMPT_VERSION,
        source: startSource,
      }),
      kind: "start",
      model,
      promptVersion: START_PROMPT_VERSION,
      sourceFingerprint: generationFingerprint(startSource),
      payload: startResponseToTemplate(
        createFixtureStartResponse({
          installationId,
          graphId,
          headline: event.leadHeadline,
          worldEventId: event.id,
        }),
      ),
      createdAt: graph.snapshot!.capturedAt,
    },
    StartGenerationTemplateSchema,
  );
  const expansionRequest = {
    installationId,
    graphId,
    parentId: expandedRootId,
    snapshot: graph.snapshot!,
    lineage: lineageForGraphNode(graph, expandedRootId),
    remainingNodeCapacity: 60,
  };
  const expansionSource = semanticExpansionSource({
    snapshot: expansionRequest.snapshot,
    lineage: expansionRequest.lineage,
    maxBranches: 5,
  });
  await repository.putGenerationTemplate(
    {
      key: generationCacheKey({
        kind: "expand",
        model,
        promptVersion: EXPANSION_PROMPT_VERSION,
        source: expansionSource,
      }),
      kind: "expand",
      model,
      promptVersion: EXPANSION_PROMPT_VERSION,
      sourceFingerprint: generationFingerprint(expansionSource),
      payload: expansionResponseToTemplate(
        createFixtureExpansionResponse(expansionRequest),
      ),
      createdAt: "2026-08-25T16:00:01.000Z",
    },
    ExpansionGenerationTemplateSchema,
  );

  await registerSavedAtlas(
    {
      installationId,
      expectedMode: "live",
      graph,
      worldAssociation: { eventId: event.id, eventRevision: event.revision },
    },
    {
      mode: "live",
      getAtlasModel: () => "atlas-model",
      getWorldAtlasModel: () => model,
      getWorldRepository: () => repository,
    },
  );

  const child = graph.nodes[graph.nodes[expandedRootId]!.childIds[0]!]!;
  assert.equal(
    validateRegisteredExpansion({
      installationId,
      graphId,
      parentId: child.id,
      snapshot: graph.snapshot!,
      lineage: lineageForGraphNode(graph, child.id),
      remainingNodeCapacity: 57,
    }).parent.id,
    child.id,
  );
});

test("registration seeds the server guard from browser call accounting", async () => {
  const repository = createMemoryWorldRepository();
  await repository.seedAtlasCallUsage({
    installationKey: atlasSafetyIdentifier(installationId),
    graphId,
    callsUsed: 9,
  });
  const graph = graphFromStart({ headline: headlineFixture, callsUsed: 2 });
  assert.deepEqual(
    await registerSavedAtlas(
    { installationId, expectedMode: "fixture", graph },
    {
      mode: "fixture",
      getAtlasModel: () => "atlas-model",
      getWorldAtlasModel: () => "world-model",
      getWorldRepository: () => repository,
    },
    ),
    { ok: true, graphId, restored: true, callsUsed: 9 },
  );
  await runWithAtlasRequestGuard({
    installationId,
    graphId,
    consumesAtlasCall: true,
    key: "last-call",
    operation: async () => ({ meta: { callConsumed: true } }),
  });
  await assert.rejects(
    () =>
      runWithAtlasRequestGuard({
        installationId,
        graphId,
        consumesAtlasCall: true,
        key: "over-limit",
        operation: async () => ({ meta: { callConsumed: true } }),
      }),
    (error: unknown) =>
      error instanceof AtlasApiError &&
      error.code === "atlas_call_limit_reached",
  );
});

test("standalone fixture resume remains available when the world database is down", async () => {
  const repository = createMemoryWorldRepository();
  repository.initialize = async () => {
    throw new Error("database unavailable");
  };
  const graph = graphFromStart({ headline: headlineFixture, callsUsed: 2 });

  assert.deepEqual(
    await registerSavedAtlas(
      { installationId, expectedMode: "fixture", graph },
      {
        mode: "fixture",
        getAtlasModel: () => "atlas-model",
        getWorldAtlasModel: () => "world-model",
        getWorldRepository: () => repository,
      },
    ),
    { ok: true, graphId, restored: true, callsUsed: 2 },
  );
  const root = graph.nodes[graph.rootChildIds[0]!]!;
  assert.equal(
    validateRegisteredExpansion({
      installationId,
      graphId,
      parentId: root.id,
      snapshot: graph.snapshot!,
      lineage: lineageForGraphNode(graph, root.id),
      remainingNodeCapacity: 60,
    }).parent.id,
    root.id,
  );
});
