import { createHash } from "node:crypto";

import { z } from "zod";

import {
  ExpandAtlasResponseSchema,
  MAX_ATLAS_NODES,
  PossibilityNodeSchema,
  StartAtlasResponseSchema,
  type ExpandAtlasResponse,
  type HeadlineItem,
  type LineageNode,
  type PossibilityNode,
  type StartAtlasResponse,
} from "../contracts";
import type { ExpandAtlasRequest } from "./branch";
import {
  GenerationCacheRepository,
  getGenerationCacheRepository,
} from "./generation-cache";
import { AtlasApiError } from "./http";

type StartRegistration = {
  installationId: string;
  graphId: string;
  headline: HeadlineItem;
};

type RegisteredGraph = {
  installationFingerprint: string;
  headlineFingerprint: string;
  snapshotFingerprint: string | null;
  startResponse: StartAtlasResponse;
  nodes: Map<string, PossibilityNode>;
  expansionResponses: Map<string, ExpandAtlasResponse>;
  version: number;
};

export type GraphRegistryOptions = {
  repository?: GenerationCacheRepository | null;
  now?: () => string;
};

const RegisteredGraphStateSchema = z
  .object({
    startResponse: StartAtlasResponseSchema,
    nodes: z.record(z.string(), PossibilityNodeSchema),
    expansionResponses: z.record(z.string(), ExpandAtlasResponseSchema),
  })
  .strict();

const localGraphs = new Map<string, RegisteredGraph>();

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

function installationFingerprint(installationId: string) {
  return fingerprint(installationId);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function replayResponse<
  T extends StartAtlasResponse | ExpandAtlasResponse,
>(response: T): T {
  const replay = clone(response);
  return {
    ...replay,
    meta: { ...replay.meta, cacheStatus: "hit" },
  } as T;
}

function registrationError(
  code: string,
  message: string,
  status = 409,
  callConsumed = false,
  retryable = false,
  retryAfterSeconds?: number,
) {
  return new AtlasApiError({
    code,
    message,
    status,
    retryable,
    callConsumed,
    retryAfterSeconds,
  });
}

function repositoryFor(options?: GraphRegistryOptions) {
  if (options && Object.hasOwn(options, "repository")) {
    return options.repository ?? null;
  }
  return getGenerationCacheRepository();
}

function nowFor(options?: GraphRegistryOptions) {
  return options?.now?.() ?? new Date().toISOString();
}

function stateFromEntry(entry: RegisteredGraph) {
  return RegisteredGraphStateSchema.parse({
    startResponse: entry.startResponse,
    nodes: Object.fromEntries(entry.nodes),
    expansionResponses: Object.fromEntries(entry.expansionResponses),
  });
}

function assertStoredGraphIntegrity(graphId: string, entry: RegisteredGraph) {
  if (entry.nodes.size + 1 > MAX_ATLAS_NODES) {
    throw registrationError(
      "graph_state_invalid",
      "The saved atlas graph is invalid.",
      500,
    );
  }

  if (entry.startResponse.kind === "insufficient_evidence") {
    if (entry.snapshotFingerprint !== null || entry.nodes.size !== 0) {
      throw registrationError(
        "graph_state_invalid",
        "The saved atlas graph is invalid.",
        500,
      );
    }
    return;
  }

  if (
    entry.snapshotFingerprint !== fingerprint(entry.startResponse.snapshot)
  ) {
    throw registrationError(
      "graph_state_invalid",
      "The saved atlas graph is invalid.",
      500,
    );
  }

  const rootIds = new Set(entry.startResponse.nodes.map((node) => node.id));
  for (const node of entry.nodes.values()) {
    if (node.parentId === graphId) {
      if (node.depth !== 1 || !rootIds.has(node.id)) {
        throw registrationError(
          "graph_state_invalid",
          "The saved atlas graph is invalid.",
          500,
        );
      }
    } else {
      const parent = entry.nodes.get(node.parentId);
      if (
        !parent ||
        node.depth !== parent.depth + 1 ||
        !parent.childIds.includes(node.id)
      ) {
        throw registrationError(
          "graph_state_invalid",
          "The saved atlas graph is invalid.",
          500,
        );
      }
    }
    for (const childId of node.childIds) {
      const child = entry.nodes.get(childId);
      if (!child || child.parentId !== node.id || child.depth !== node.depth + 1) {
        throw registrationError(
          "graph_state_invalid",
          "The saved atlas graph is invalid.",
          500,
        );
      }
    }
  }
  if (
    rootIds.size !== entry.startResponse.nodes.length ||
    [...rootIds].some((id) => !entry.nodes.has(id))
  ) {
    throw registrationError(
      "graph_state_invalid",
      "The saved atlas graph is invalid.",
      500,
    );
  }
}

type StoredGraphRecord = NonNullable<
  Awaited<ReturnType<GenerationCacheRepository["getRegisteredGraph"]>>
>;

function entryFromStoredRecord(graphId: string, record: StoredGraphRecord) {
  const parsed = RegisteredGraphStateSchema.safeParse(record.state);
  if (!parsed.success) {
    throw registrationError(
      "graph_state_invalid",
      "The saved atlas graph is invalid.",
      500,
    );
  }
  const entry: RegisteredGraph = {
    installationFingerprint: record.installationFingerprint,
    headlineFingerprint: record.headlineFingerprint,
    snapshotFingerprint: record.snapshotFingerprint,
    startResponse: parsed.data.startResponse,
    nodes: new Map(Object.entries(parsed.data.nodes)),
    expansionResponses: new Map(
      Object.entries(parsed.data.expansionResponses),
    ),
    version: record.version,
  };
  assertStoredGraphIntegrity(graphId, entry);
  return entry;
}

async function loadEntry(
  graphId: string,
  repository: GenerationCacheRepository | null,
) {
  if (!repository) return localGraphs.get(graphId) ?? null;
  const stored = await repository.getRegisteredGraph(graphId);
  return stored ? entryFromStoredRecord(graphId, stored) : null;
}

function assertRegistrationOwner(
  entry: RegisteredGraph,
  input: StartRegistration,
) {
  if (
    entry.installationFingerprint !==
      installationFingerprint(input.installationId) ||
    entry.headlineFingerprint !== fingerprint(input.headline)
  ) {
    throw registrationError(
      "graph_conflict",
      "This graph identifier belongs to another atlas.",
    );
  }
}

function createRegisteredGraph(
  input: StartRegistration,
  response: StartAtlasResponse,
) {
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
  return {
    installationFingerprint: installationFingerprint(input.installationId),
    headlineFingerprint: fingerprint(input.headline),
    snapshotFingerprint:
      response.kind === "atlas" ? fingerprint(response.snapshot) : null,
    startResponse: clone(response),
    nodes,
    expansionResponses: new Map<string, ExpandAtlasResponse>(),
    version: 1,
  } satisfies RegisteredGraph;
}

export async function getRegisteredStartResponse(
  input: StartRegistration,
  options?: GraphRegistryOptions,
): Promise<StartAtlasResponse | null> {
  const entry = await loadEntry(input.graphId, repositoryFor(options));
  if (!entry) return null;
  assertRegistrationOwner(entry, input);
  return entry.startResponse.kind === "atlas" ? replayResponse(entry.startResponse) : null;
}

export async function registerStartedGraph(
  input: StartRegistration,
  response: StartAtlasResponse,
  options?: GraphRegistryOptions,
) {
  const repository = repositoryFor(options);
  const existing = await loadEntry(input.graphId, repository);
  if (existing) {
    assertRegistrationOwner(existing, input);
    if (existing.startResponse.kind === "atlas") return replayResponse(existing.startResponse);
    if (response.kind === "atlas") {
      const replacement = createRegisteredGraph(input, response);
      if (!repository) {
        replacement.version = existing.version + 1;
        localGraphs.set(input.graphId, replacement);
        return clone(response);
      }
      const replaced = await repository.compareAndSwapRegisteredGraph({
        graphId: input.graphId, expectedVersion: existing.version,
        snapshotFingerprint: replacement.snapshotFingerprint,
        state: stateFromEntry(replacement), updatedAt: nowFor(options),
      });
      if (replaced) return clone(response);
      const latest = await loadEntry(input.graphId, repository);
      if (latest) {
        assertRegistrationOwner(latest, input);
        if (latest.startResponse.kind === "atlas") return replayResponse(latest.startResponse);
      }
      throw registrationError("graph_update_conflict", "The story changed while its analysis was being saved. Try again.", 409, response.meta.callConsumed, true);
    }
  }

  // Legacy negative verification results use the short-lived generation-template TTL.
  // Do not turn them into 90-day exact graph replays that could outlive newer
  // reporting and prevent a later verification attempt from recovering.
  if (response.kind === "insufficient_evidence") return clone(response);

  const entry = createRegisteredGraph(input, response);
  if (!repository) {
    localGraphs.set(input.graphId, entry);
    return clone(response);
  }

  const inserted = await repository.insertRegisteredGraph({
    graphId: input.graphId,
    installationFingerprint: entry.installationFingerprint,
    headlineFingerprint: entry.headlineFingerprint,
    snapshotFingerprint: entry.snapshotFingerprint,
    state: stateFromEntry(entry),
    version: entry.version,
    updatedAt: nowFor(options),
  });
  if (inserted) return clone(response);

  const raced = await loadEntry(input.graphId, repository);
  if (!raced) {
    throw registrationError(
      "graph_update_conflict",
      "The atlas changed while it was being saved. Try again.",
      409,
      response.meta.callConsumed,
      true,
      1,
    );
  }
  assertRegistrationOwner(raced, input);
  return replayResponse(raced.startResponse);
}

async function entryForExpansion(
  input: ExpandAtlasRequest,
  repository: GenerationCacheRepository | null,
) {
  const entry = await loadEntry(input.graphId, repository);
  if (!entry) {
    throw registrationError(
      "atlas_session_expired",
      "This atlas analysis session expired. Restart the atlas before creating more paths.",
    );
  }
  if (
    entry.installationFingerprint !== installationFingerprint(input.installationId)
  ) {
    throw registrationError(
      "graph_conflict",
      "This graph identifier belongs to another installation.",
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

function validateExpansionAgainstEntry(
  input: ExpandAtlasRequest,
  entry: RegisteredGraph,
) {
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
  return { remainingNodeCapacity: expectedCapacity, parent: clone(parent) };
}

export async function getRegisteredExpansionResponse(
  input: ExpandAtlasRequest,
  requestKey: string,
  options?: GraphRegistryOptions,
) {
  const entry = await entryForExpansion(input, repositoryFor(options));
  const response = entry.expansionResponses.get(requestKey);
  return response ? replayResponse(response) : null;
}

export async function validateRegisteredExpansion(
  input: ExpandAtlasRequest,
  options?: GraphRegistryOptions,
) {
  const entry = await entryForExpansion(input, repositoryFor(options));
  return validateExpansionAgainstEntry(input, entry);
}

function nextEntryForExpansion(
  input: ExpandAtlasRequest,
  requestKey: string,
  response: ExpandAtlasResponse,
  entry: RegisteredGraph,
) {
  const { parent } = validateExpansionAgainstEntry(input, entry);
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

  const expansionResponses = new Map(entry.expansionResponses);
  expansionResponses.set(requestKey, clone(response));
  return {
    ...entry,
    nodes: nextNodes,
    expansionResponses,
  };
}

export async function commitRegisteredExpansion(
  input: ExpandAtlasRequest,
  requestKey: string,
  response: ExpandAtlasResponse,
  options?: GraphRegistryOptions,
) {
  const repository = repositoryFor(options);
  const entry = await entryForExpansion(input, repository);
  const replay = entry.expansionResponses.get(requestKey);
  if (replay) return replayResponse(replay);

  const nextEntry = nextEntryForExpansion(input, requestKey, response, entry);
  if (!repository) {
    nextEntry.version += 1;
    localGraphs.set(input.graphId, nextEntry);
    return clone(response);
  }

  const committed = await repository.compareAndSwapRegisteredGraph({
    graphId: input.graphId,
    expectedVersion: entry.version,
    snapshotFingerprint: nextEntry.snapshotFingerprint,
    state: stateFromEntry(nextEntry),
    updatedAt: nowFor(options),
  });
  if (committed) return clone(response);

  const latest = await entryForExpansion(input, repository);
  const concurrentReplay = latest.expansionResponses.get(requestKey);
  if (concurrentReplay) return replayResponse(concurrentReplay);
  throw registrationError(
    "graph_update_conflict",
    "The atlas changed while this path was being saved. Try again.",
    409,
    response.meta.callConsumed,
    true,
    1,
  );
}

export function resetRegisteredGraphsForTests() {
  localGraphs.clear();
}

/** The voice cursor reads server-owned relationships, never client-supplied graphs. */
export async function readRegisteredGraph(
  input: StartRegistration,
  options?: GraphRegistryOptions,
) {
  const entry = await loadEntry(input.graphId, repositoryFor(options));
  if (!entry) return null;
  assertRegistrationOwner(entry, input);
  if (entry.startResponse.kind !== "atlas") return null;
  return {
    startResponse: clone(entry.startResponse),
    nodes: Object.fromEntries([...entry.nodes].map(([id, node]) => [id, clone(node)])),
  };
}
