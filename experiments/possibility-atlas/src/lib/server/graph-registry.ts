import { createHash } from "node:crypto";

import {
  MAX_ATLAS_NODES,
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

type GraphProvenance = { model: string };

type RegisteredGraph = {
  installationId: string;
  worldEventId: string | null;
  model: string;
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
