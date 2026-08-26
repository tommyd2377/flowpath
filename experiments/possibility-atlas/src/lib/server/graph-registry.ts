import { createHash } from "node:crypto";

import {
  AtlasGraphSchema,
  MAX_ATLAS_NODES,
  type AtlasGraph,
  type ExpandAtlasResponse,
  type HeadlineItem,
  type LineageNode,
  type PossibilityNode,
  type StartAtlasResponse,
} from "../contracts";
import type { RippleRequest } from "../world-contracts";
import type { ExpandAtlasRequest } from "./branch";
import { AtlasApiError } from "./http";

type StartRegistration = {
  installationId: string;
  graphId: string;
  headline: HeadlineItem;
  worldEventId?: string;
};

type GraphProvenance = {
  model: string;
  expansionEligible?: boolean;
  blockedExpansionNodeIds?: string[];
  rippleEligible?: boolean;
};

type RestoredGraphProvenance = GraphProvenance & {
  worldEventId?: string;
  mode: "live" | "fixture";
};

type RegisteredGraph = {
  installationId: string;
  worldEventId: string | null;
  model: string;
  expansionEligible: boolean;
  blockedExpansionNodeIds: Set<string>;
  rippleEligible: boolean;
  headlineFingerprint: string;
  snapshotFingerprint: string | null;
  startResponse: StartAtlasResponse;
  nodes: Map<string, PossibilityNode>;
  expansionResponses: Map<string, ExpandAtlasResponse>;
};

const registryGlobal = globalThis as typeof globalThis & {
  __possibilityAtlasGraphRegistry?: Map<string, RegisteredGraph>;
};

const graphs =
  registryGlobal.__possibilityAtlasGraphRegistry ??
  (registryGlobal.__possibilityAtlasGraphRegistry = new Map());

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function registrationError(
  code: string,
  message: string,
  status = 409,
  callConsumed = false,
) {
  return new AtlasApiError({
    code,
    message,
    status,
    retryable: false,
    callConsumed,
  });
}

function assertRegistrationOwner(
  entry: RegisteredGraph,
  input: StartRegistration,
) {
  if (
    entry.installationId !== input.installationId ||
    entry.headlineFingerprint !== fingerprint(input.headline) ||
    entry.worldEventId !== (input.worldEventId ?? null)
  ) {
    throw registrationError(
      "graph_conflict",
      "This graph identifier belongs to another local atlas.",
    );
  }
}

function invalidSavedGraph(message: string) {
  return registrationError("invalid_saved_graph", message, 400);
}

function sameIds(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((id) => right.includes(id))
  );
}

function validateSavedGraph(rawGraph: AtlasGraph) {
  const graph = AtlasGraphSchema.parse(rawGraph);
  if (graph.status !== "ready" || !graph.snapshot) {
    throw invalidSavedGraph(
      "Only a completed atlas with frozen evidence can resume analysis.",
    );
  }
  const snapshot = graph.snapshot;
  if (
    fingerprint(snapshot.headline) !== fingerprint(graph.headline)
  ) {
    throw invalidSavedGraph(
      "The saved atlas headline does not match its frozen evidence.",
    );
  }

  const entries = Object.entries(graph.nodes);
  if (entries.length + 1 > MAX_ATLAS_NODES) {
    throw invalidSavedGraph("The saved atlas exceeds its node limit.");
  }
  const nodes = new Map<string, PossibilityNode>();
  for (const [key, node] of entries) {
    if (key !== node.id || nodes.has(node.id)) {
      throw invalidSavedGraph("The saved atlas contains conflicting node IDs.");
    }
    nodes.set(node.id, clone(node));
  }

  const rootIds = [...nodes.values()]
    .filter((node) => node.parentId === graph.id)
    .map((node) => node.id);
  if (
    rootIds.length < 3 ||
    rootIds.length > 5 ||
    !sameIds(rootIds, graph.rootChildIds)
  ) {
    throw invalidSavedGraph(
      "The saved atlas does not have one valid set of primary scenarios.",
    );
  }

  for (const node of nodes.values()) {
    if (new Set(node.childIds).size !== node.childIds.length) {
      throw invalidSavedGraph("A saved possibility repeats a child node.");
    }
    if (node.childIds.length > 0 && node.childIds.length < 3) {
      throw invalidSavedGraph(
        "A saved expansion must contain one complete set of possibilities.",
      );
    }
    if (node.parentId === graph.id) {
      if (node.depth !== 1) {
        throw invalidSavedGraph("A primary scenario has an invalid depth.");
      }
    } else {
      const parent = nodes.get(node.parentId);
      if (!parent || node.depth !== parent.depth + 1) {
        throw invalidSavedGraph(
          "A saved possibility is disconnected from its parent.",
        );
      }
      if (!parent.childIds.includes(node.id)) {
        throw invalidSavedGraph(
          "A saved parent-child relationship is not reciprocal.",
        );
      }
    }
    if (
      (node.status === "leaf" || node.depth === 5) &&
      node.childIds.length > 0
    ) {
      throw invalidSavedGraph("A terminal possibility cannot have children.");
    }
    for (const childId of node.childIds) {
      const child = nodes.get(childId);
      if (
        !child ||
        child.parentId !== node.id ||
        child.depth !== node.depth + 1
      ) {
        throw invalidSavedGraph(
          "A saved child does not match its registered parent.",
        );
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [...graph.rootChildIds];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    const node = nodes.get(id);
    if (!node) {
      throw invalidSavedGraph("A primary scenario is unavailable.");
    }
    reachable.add(id);
    queue.push(...node.childIds);
  }
  if (reachable.size !== nodes.size) {
    throw invalidSavedGraph("The saved atlas contains an unreachable path.");
  }
  if (graph.focusedNodeId && !nodes.has(graph.focusedNodeId)) {
    throw invalidSavedGraph("The focused possibility is unavailable.");
  }
  return { graph, nodes, snapshot };
}

export function validateSavedGraphForRegistration(graph: AtlasGraph) {
  validateSavedGraph(graph);
}

export function restoreRegisteredGraph(
  input: { installationId: string; graph: AtlasGraph },
  provenance: RestoredGraphProvenance,
) {
  const { graph, nodes, snapshot } = validateSavedGraph(input.graph);
  const worldEventId = provenance.worldEventId ?? null;
  const existing = graphs.get(graph.id);
  if (existing) {
    if (
      existing.installationId !== input.installationId ||
      existing.worldEventId !== worldEventId ||
      existing.headlineFingerprint !== fingerprint(graph.headline) ||
      existing.snapshotFingerprint !== fingerprint(snapshot) ||
      existing.nodes.size !== nodes.size ||
      [...nodes].some(
        ([id, node]) =>
          !existing.nodes.has(id) ||
          fingerprint(existing.nodes.get(id)) !== fingerprint(node),
      )
    ) {
      throw registrationError(
        "graph_conflict",
        "This graph identifier belongs to a different saved atlas.",
      );
    }
    existing.expansionEligible =
      existing.expansionEligible || Boolean(provenance.expansionEligible);
    existing.blockedExpansionNodeIds = new Set(
      provenance.blockedExpansionNodeIds ?? existing.blockedExpansionNodeIds,
    );
    existing.rippleEligible =
      existing.rippleEligible || Boolean(provenance.rippleEligible);
    return { graphId: graph.id, restored: true as const };
  }

  const rootNodes = graph.rootChildIds.map((id) => nodes.get(id)!);
  const startResponse: StartAtlasResponse = {
    ok: true,
    kind: "atlas",
    snapshot: clone(snapshot),
    nodes: rootNodes.map(clone),
    meta: {
      mode: provenance.mode,
      callConsumed: false,
      cacheStatus: "hit",
    },
  };
  graphs.set(graph.id, {
    installationId: input.installationId,
    worldEventId,
    model: provenance.model,
    expansionEligible: Boolean(provenance.expansionEligible),
    blockedExpansionNodeIds: new Set(provenance.blockedExpansionNodeIds ?? []),
    rippleEligible: Boolean(provenance.rippleEligible),
    headlineFingerprint: fingerprint(graph.headline),
    snapshotFingerprint: fingerprint(snapshot),
    startResponse,
    nodes,
    expansionResponses: new Map(),
  });
  return { graphId: graph.id, restored: true as const };
}

export function getRegisteredStartResponse(
  input: StartRegistration,
): StartAtlasResponse | null {
  const entry = graphs.get(input.graphId);
  if (!entry) return null;
  assertRegistrationOwner(entry, input);
  return clone(entry.startResponse);
}

export function registerStartedGraph(
  input: StartRegistration,
  response: StartAtlasResponse,
  provenance: GraphProvenance = { model: "gpt-5.6-terra" },
) {
  const existing = graphs.get(input.graphId);
  if (existing) {
    assertRegistrationOwner(existing, input);
    return clone(existing.startResponse);
  }

  const nodes = new Map<string, PossibilityNode>();
  if (response.kind === "atlas") {
    if (response.snapshot.headline.id !== input.headline.id) {
      throw registrationError(
        "graph_conflict",
        "The verified snapshot does not match the selected headline.",
        500,
      );
    }
    for (const node of response.nodes) {
      if (
        nodes.has(node.id) ||
        node.parentId !== input.graphId ||
        node.depth !== 1 ||
        node.childIds.length !== 0
      ) {
        throw registrationError(
          "invalid_graph_response",
          "The initial graph response could not be registered safely.",
          500,
        );
      }
      nodes.set(node.id, clone(node));
    }
  }

  if (nodes.size + 1 > MAX_ATLAS_NODES) {
    throw registrationError(
      "node_limit_exceeded",
      "The initial graph exceeds its node limit.",
      500,
    );
  }

  graphs.set(input.graphId, {
    installationId: input.installationId,
    worldEventId: input.worldEventId ?? null,
    model: provenance.model,
    expansionEligible: provenance.expansionEligible ?? true,
    blockedExpansionNodeIds: new Set(provenance.blockedExpansionNodeIds ?? []),
    rippleEligible:
      provenance.rippleEligible ??
      Boolean(input.worldEventId && response.kind === "atlas"),
    headlineFingerprint: fingerprint(input.headline),
    snapshotFingerprint:
      response.kind === "atlas" ? fingerprint(response.snapshot) : null,
    startResponse: clone(response),
    nodes,
    expansionResponses: new Map(),
  });
  return clone(response);
}

function entryForExpansion(input: ExpandAtlasRequest) {
  const entry = graphs.get(input.graphId);
  if (!entry) {
    throw registrationError(
      "atlas_session_expired",
      "This atlas analysis session expired. Restart the atlas before creating more paths.",
    );
  }
  if (entry.installationId !== input.installationId) {
    throw registrationError(
      "graph_conflict",
      "This graph identifier belongs to another local installation.",
    );
  }
  if (
    !entry.snapshotFingerprint ||
    entry.snapshotFingerprint !== fingerprint(input.snapshot)
  ) {
    throw registrationError(
      "snapshot_mismatch",
      "The frozen event snapshot does not match this atlas.",
      400,
    );
  }
  if (!entry.expansionEligible) {
    throw registrationError(
      "atlas_provenance_unavailable",
      "This restored atlas cannot create more paths safely. Restart it to continue analysis.",
    );
  }
  if (entry.blockedExpansionNodeIds.has(input.parentId)) {
    throw registrationError(
      "atlas_branch_provenance_unavailable",
      "This saved branch cannot create more paths safely. Choose another saved branch or restart the atlas.",
    );
  }
  return entry;
}

function lineageNodeFrom(node: PossibilityNode): LineageNode {
  return {
    id: node.id,
    parentId: node.parentId,
    depth: node.depth,
    title: node.title,
    summary: node.summary,
    whyPlausible: node.whyPlausible,
    keyAssumption: node.keyAssumption,
    horizon: node.horizon,
  };
}

export function getRegisteredExpansionResponse(
  input: ExpandAtlasRequest,
  requestKey: string,
) {
  const entry = entryForExpansion(input);
  const response = entry.expansionResponses.get(requestKey);
  return response ? clone(response) : null;
}

export function validateRegisteredExpansion(input: ExpandAtlasRequest) {
  const entry = entryForExpansion(input);
  const expectedCapacity = MAX_ATLAS_NODES - entry.nodes.size - 1;
  if (input.remainingNodeCapacity !== expectedCapacity) {
    throw registrationError(
      "node_capacity_mismatch",
      "The supplied node capacity does not match the registered atlas.",
      400,
    );
  }
  if (expectedCapacity < 3) {
    throw registrationError(
      "node_limit_reached",
      "This atlas has fewer than three node slots remaining.",
    );
  }

  for (const supplied of input.lineage) {
    const registered = entry.nodes.get(supplied.id);
    if (
      !registered ||
      fingerprint(lineageNodeFrom(registered)) !== fingerprint(supplied)
    ) {
      throw registrationError(
        "invalid_lineage",
        "The selected path does not match the registered atlas lineage.",
        400,
      );
    }
  }

  const parent = entry.nodes.get(input.parentId);
  if (!parent || input.lineage.at(-1)?.id !== parent.id) {
    throw registrationError(
      "invalid_lineage",
      "The selected parent is not registered in this atlas.",
      400,
    );
  }
  if (parent.childIds.length > 0) {
    throw registrationError(
      "already_expanded",
      "This possibility has already been expanded.",
    );
  }
  if (parent.status === "leaf" || parent.depth >= 5) {
    throw registrationError(
      "max_depth_reached",
      "This possibility is already a terminal leaf.",
    );
  }
  return {
    remainingNodeCapacity: expectedCapacity,
    parent: clone(parent),
    model: entry.model,
    worldEventId: entry.worldEventId,
  };
}

export function validateRegisteredRippleContext(input: RippleRequest) {
  const entry = graphs.get(input.graphId);
  if (!entry) {
    throw registrationError(
      "atlas_session_expired",
      "This atlas analysis session expired. Restart it before watching the world react.",
    );
  }
  if (entry.installationId !== input.installationId) {
    throw registrationError(
      "graph_conflict",
      "This graph identifier belongs to another local installation.",
    );
  }
  if (!entry.worldEventId || entry.worldEventId !== input.worldEventId) {
    throw registrationError(
      "world_event_mismatch",
      "This atlas is not registered to the supplied world event.",
      400,
    );
  }
  if (entry.startResponse.kind !== "atlas") {
    throw registrationError(
      "event_not_verified",
      "This world event does not have a verified source snapshot.",
    );
  }
  if (!entry.rippleEligible) {
    throw registrationError(
      "world_scenario_provenance_unavailable",
      "This restored atlas cannot recheck ripple links safely. Restart it from the current world event.",
    );
  }
  const scenario = entry.nodes.get(input.scenarioNodeId);
  if (!scenario || scenario.depth !== 1 || scenario.parentId !== input.graphId) {
    throw registrationError(
      "invalid_ripple_scenario",
      "World reactions can only be analyzed from a registered primary scenario.",
      400,
    );
  }
  return {
    worldEventId: entry.worldEventId,
    model: entry.model,
    snapshot: clone(entry.startResponse.snapshot),
    scenario: clone(scenario),
  };
}

export function commitRegisteredExpansion(
  input: ExpandAtlasRequest,
  requestKey: string,
  response: ExpandAtlasResponse,
) {
  const replay = getRegisteredExpansionResponse(input, requestKey);
  if (replay) return replay;

  const { parent } = validateRegisteredExpansion(input);
  const entry = entryForExpansion(input);
  if (response.parentId !== parent.id) {
    throw registrationError(
      "invalid_graph_response",
      "The expansion response belongs to another possibility.",
      500,
      response.meta.callConsumed,
    );
  }

  const nextNodes = new Map(entry.nodes);
  const registeredParent = nextNodes.get(parent.id);
  if (!registeredParent) {
    throw registrationError(
      "invalid_graph_response",
      "The expansion parent is unavailable.",
      500,
      response.meta.callConsumed,
    );
  }

  if (response.kind === "leaf") {
    nextNodes.set(parent.id, {
      ...registeredParent,
      status: "leaf",
      leafReason: response.reason,
      errorMessage: null,
    });
  } else {
    const newIds = new Set<string>();
    for (const node of response.nodes) {
      if (
        newIds.has(node.id) ||
        nextNodes.has(node.id) ||
        node.parentId !== parent.id ||
        node.depth !== parent.depth + 1 ||
        node.childIds.length !== 0
      ) {
        throw registrationError(
          "invalid_graph_response",
          "The generated level could not be registered atomically.",
          500,
          response.meta.callConsumed,
        );
      }
      newIds.add(node.id);
    }
    if (nextNodes.size + response.nodes.length + 1 > MAX_ATLAS_NODES) {
      throw registrationError(
        "node_limit_exceeded",
        "The generated level exceeds the atlas node limit.",
        500,
        response.meta.callConsumed,
      );
    }
    nextNodes.set(parent.id, {
      ...registeredParent,
      status: "ready",
      childIds: response.nodes.map((node) => node.id),
      errorMessage: null,
      leafReason: null,
    });
    for (const node of response.nodes) nextNodes.set(node.id, clone(node));
  }

  entry.nodes = nextNodes;
  entry.expansionResponses.set(requestKey, clone(response));
  return clone(response);
}

export function resetRegisteredGraphsForTests() {
  graphs.clear();
}
