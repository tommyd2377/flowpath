import {
  AtlasGraphSchema,
  MAX_ATLAS_CALLS,
  MAX_ATLAS_NODES,
  type AtlasGraph,
  type ExpandAtlasResponse,
  type HeadlineItem,
  type LineageNode,
  type PossibilityNode,
  type StartAtlasResponse,
} from "./contracts";

export class AtlasReducerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlasReducerError";
  }
}

export type AtlasAction =
  | { type: "start_requested"; at: string }
  | { type: "start_succeeded"; response: StartAtlasResponse; at: string }
  | {
      type: "start_failed";
      message: string;
      callConsumed: boolean;
      at: string;
    }
  | { type: "expansion_requested"; parentId: string; at: string }
  | {
      type: "expansion_succeeded";
      parentId: string;
      response: ExpandAtlasResponse;
      at: string;
    }
  | {
      type: "expansion_failed";
      parentId: string;
      message: string;
      callConsumed: boolean;
      at: string;
    }
  | { type: "focus_changed"; nodeId: string | null }
  | { type: "ripple_call_recorded"; at: string }
  | { type: "recover_interrupted"; at: string };

export type ExpansionAvailability =
  | { allowed: true; remainingNodeCapacity: number }
  | {
      allowed: false;
      reason:
        | "graph_unavailable"
        | "already_expanded"
        | "generating"
        | "leaf"
        | "max_depth"
        | "call_budget"
        | "node_budget";
    };

function parseGraph(graph: AtlasGraph) {
  const parsed = AtlasGraphSchema.parse(graph);
  if (Object.keys(parsed.nodes).length + 1 > MAX_ATLAS_NODES) {
    throw new AtlasReducerError("The atlas exceeds its node budget.");
  }
  for (const [key, node] of Object.entries(parsed.nodes)) {
    if (key !== node.id) {
      throw new AtlasReducerError("A node record key must match its node id.");
    }
    if (node.parentId === parsed.id) {
      if (node.depth !== 1 || !parsed.rootChildIds.includes(node.id)) {
        throw new AtlasReducerError(`Node ${node.id} is not connected to the root.`);
      }
    } else {
      const parent = parsed.nodes[node.parentId];
      if (!parent) {
        throw new AtlasReducerError(`Node ${node.id} has an unavailable parent.`);
      }
      if (!parent.childIds.includes(node.id) || node.depth !== parent.depth + 1) {
        throw new AtlasReducerError(`Node ${node.id} is not connected to its parent.`);
      }
    }
    for (const childId of node.childIds) {
      const child = parsed.nodes[childId];
      if (!child || child.parentId !== node.id) {
        throw new AtlasReducerError(`Node ${node.id} has an invalid child reference.`);
      }
    }
  }
  for (const rootChildId of parsed.rootChildIds) {
    const child = parsed.nodes[rootChildId];
    if (!child || child.parentId !== parsed.id || child.depth !== 1) {
      throw new AtlasReducerError("The root has an invalid child reference.");
    }
  }
  if (parsed.focusedNodeId && !parsed.nodes[parsed.focusedNodeId]) {
    throw new AtlasReducerError("The focused node is not present in the graph.");
  }
  return parsed;
}

export function validateAtlasGraph(graph: AtlasGraph) {
  return parseGraph(graph);
}

function callsAfter(graph: AtlasGraph, consumed: boolean) {
  if (!consumed) return graph.callsUsed;
  if (graph.callsUsed >= MAX_ATLAS_CALLS) {
    throw new AtlasReducerError("The atlas call budget is already exhausted.");
  }
  return graph.callsUsed + 1;
}

function normalizeBatch({
  graph,
  nodes,
  parentId,
  depth,
}: {
  graph: AtlasGraph;
  nodes: PossibilityNode[];
  parentId: string;
  depth: number;
}) {
  const ids = new Set<string>();
  const normalized: PossibilityNode[] = [];
  for (const node of nodes) {
    if (node.id === graph.id || ids.has(node.id) || graph.nodes[node.id]) {
      throw new AtlasReducerError("A generated level contains a duplicate node id.");
    }
    if (node.parentId !== parentId || node.depth !== depth) {
      throw new AtlasReducerError("A generated node does not match the requested lineage.");
    }
    if (node.childIds.length > 0) {
      throw new AtlasReducerError("A newly generated node cannot arrive with descendants.");
    }
    if (node.status === "generating" || node.status === "error") {
      throw new AtlasReducerError("A generated node must be ready or an early leaf.");
    }
    ids.add(node.id);
    normalized.push(
      depth === 5 && node.status !== "leaf"
        ? {
            ...node,
            status: "leaf",
            leafReason: node.leafReason ?? "This path reached the maximum atlas depth.",
          }
        : node,
    );
  }
  if (Object.keys(graph.nodes).length + normalized.length + 1 > MAX_ATLAS_NODES) {
    throw new AtlasReducerError("The generated level exceeds the atlas node budget.");
  }
  return normalized;
}

export function createAtlasGraph({
  id,
  headline,
  now = new Date().toISOString(),
}: {
  id: string;
  headline: HeadlineItem;
  now?: string;
}): AtlasGraph {
  return parseGraph({
    id,
    createdAt: now,
    updatedAt: now,
    headline,
    status: "verifying",
    snapshot: null,
    nodes: {},
    rootChildIds: [],
    focusedNodeId: null,
    callsUsed: 0,
    errorMessage: null,
    insufficientReason: null,
    insufficientSummary: null,
    insufficientSources: [],
  });
}

export function remainingNodeCapacity(graph: AtlasGraph) {
  return MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1;
}

export function expansionAvailability(
  graph: AtlasGraph,
  nodeId: string,
): ExpansionAvailability {
  if (graph.status !== "ready" || !graph.snapshot) {
    return { allowed: false, reason: "graph_unavailable" };
  }
  const node = graph.nodes[nodeId];
  if (!node) return { allowed: false, reason: "graph_unavailable" };
  if (node.childIds.length > 0) return { allowed: false, reason: "already_expanded" };
  if (node.status === "generating") return { allowed: false, reason: "generating" };
  if (node.status === "leaf") return { allowed: false, reason: "leaf" };
  if (node.depth >= 5) return { allowed: false, reason: "max_depth" };
  if (graph.callsUsed >= MAX_ATLAS_CALLS) {
    return { allowed: false, reason: "call_budget" };
  }
  const remaining = remainingNodeCapacity(graph);
  if (remaining < 3) return { allowed: false, reason: "node_budget" };
  return { allowed: true, remainingNodeCapacity: remaining };
}

export function lineageForNode(graph: AtlasGraph, nodeId: string): LineageNode[] {
  const lineage: PossibilityNode[] = [];
  const visited = new Set<string>();
  let current: PossibilityNode | undefined = graph.nodes[nodeId];
  while (current) {
    if (visited.has(current.id)) {
      throw new AtlasReducerError("The atlas contains a lineage cycle.");
    }
    visited.add(current.id);
    lineage.unshift(current);
    current = current.parentId === graph.id ? undefined : graph.nodes[current.parentId];
  }
  if (lineage.length === 0 || lineage.at(-1)?.id !== nodeId) {
    throw new AtlasReducerError("The requested node is not present in the atlas.");
  }
  return lineage.map(({ id, parentId, depth, title, summary, whyPlausible, keyAssumption, horizon }) => ({
    id,
    parentId,
    depth,
    title,
    summary,
    whyPlausible,
    keyAssumption,
    horizon,
  }));
}

export function siblingIdsForNode(graph: AtlasGraph, nodeId: string) {
  const node = graph.nodes[nodeId];
  if (!node) return [];
  const ids = node.parentId === graph.id ? graph.rootChildIds : graph.nodes[node.parentId]?.childIds ?? [];
  return ids.filter((id) => id !== nodeId);
}

export function atlasReducer(graph: AtlasGraph, action: AtlasAction): AtlasGraph {
  const current = parseGraph(graph);

  switch (action.type) {
    case "start_requested":
      return parseGraph({
        ...current,
        status: "verifying",
        errorMessage: null,
        insufficientReason: null,
        insufficientSummary: null,
        insufficientSources: [],
        updatedAt: action.at,
      });

    case "start_succeeded": {
      const callsUsed = callsAfter(current, action.response.meta.callConsumed);
      if (action.response.kind === "insufficient_evidence") {
        return parseGraph({
          ...current,
          status: "insufficient_evidence",
          snapshot: null,
          nodes: {},
          rootChildIds: [],
          focusedNodeId: null,
          callsUsed,
          errorMessage: null,
          insufficientReason: action.response.reason,
          insufficientSummary: action.response.summary,
          insufficientSources: action.response.sources,
          updatedAt: action.at,
        });
      }
      const responseRootIds = action.response.nodes.map((node) => node.id);
      if (
        current.status === "ready" &&
        current.snapshot?.id === action.response.snapshot.id &&
        current.rootChildIds.length === responseRootIds.length &&
        current.rootChildIds.every((id, index) => id === responseRootIds[index])
      ) {
        return current;
      }
      if (action.response.snapshot.headline.id !== current.headline.id) {
        throw new AtlasReducerError("The verified snapshot does not match this headline.");
      }
      const nodes = normalizeBatch({
        graph: current,
        nodes: action.response.nodes,
        parentId: current.id,
        depth: 1,
      });
      const nodeRecord = Object.fromEntries(nodes.map((node) => [node.id, node]));
      return parseGraph({
        ...current,
        status: "ready",
        snapshot: action.response.snapshot,
        nodes: nodeRecord,
        rootChildIds: nodes.map((node) => node.id),
        focusedNodeId: null,
        callsUsed,
        errorMessage: null,
        insufficientReason: null,
        insufficientSummary: null,
        insufficientSources: [],
        updatedAt: action.at,
      });
    }

    case "start_failed":
      return parseGraph({
        ...current,
        status: "error",
        callsUsed: callsAfter(current, action.callConsumed),
        errorMessage: action.message.slice(0, 300),
        updatedAt: action.at,
      });

    case "expansion_requested": {
      const availability = expansionAvailability(current, action.parentId);
      if (!availability.allowed) {
        throw new AtlasReducerError(`This node cannot be expanded: ${availability.reason}.`);
      }
      const parent = current.nodes[action.parentId];
      return parseGraph({
        ...current,
        nodes: {
          ...current.nodes,
          [parent.id]: {
            ...parent,
            status: "generating",
            errorMessage: null,
          },
        },
        updatedAt: action.at,
      });
    }

    case "expansion_succeeded": {
      const parent = current.nodes[action.parentId];
      if (!parent) {
        throw new AtlasReducerError("The expanded node is not awaiting a response.");
      }
      if (action.response.parentId !== action.parentId) {
        throw new AtlasReducerError("The expansion response belongs to another node.");
      }
      if (parent.status !== "generating") {
        if (
          action.response.kind === "leaf" &&
          parent.status === "leaf" &&
          parent.leafReason === action.response.reason
        ) {
          return current;
        }
        if (
          action.response.kind === "branches" &&
          parent.childIds.length === action.response.nodes.length &&
          parent.childIds.every(
            (id, index) =>
              id ===
                (action.response.kind === "branches"
                  ? action.response.nodes[index]?.id
                  : undefined) && Boolean(current.nodes[id]),
          )
        ) {
          return current;
        }
        throw new AtlasReducerError("The expanded node is not awaiting a response.");
      }
      const callsUsed = callsAfter(current, action.response.meta.callConsumed);
      if (action.response.kind === "leaf") {
        return parseGraph({
          ...current,
          nodes: {
            ...current.nodes,
            [parent.id]: {
              ...parent,
              status: "leaf",
              errorMessage: null,
              leafReason: action.response.reason,
            },
          },
          callsUsed,
          updatedAt: action.at,
        });
      }
      const nodes = normalizeBatch({
        graph: current,
        nodes: action.response.nodes,
        parentId: parent.id,
        depth: parent.depth + 1,
      });
      return parseGraph({
        ...current,
        nodes: {
          ...current.nodes,
          [parent.id]: {
            ...parent,
            status: "ready",
            errorMessage: null,
            leafReason: null,
            childIds: nodes.map((node) => node.id),
          },
          ...Object.fromEntries(nodes.map((node) => [node.id, node])),
        },
        callsUsed,
        updatedAt: action.at,
      });
    }

    case "expansion_failed": {
      const parent = current.nodes[action.parentId];
      if (!parent) throw new AtlasReducerError("The failed node is unavailable.");
      if (parent.status !== "generating" && parent.status !== "error") {
        return current;
      }
      return parseGraph({
        ...current,
        nodes: {
          ...current.nodes,
          [parent.id]: {
            ...parent,
            status: "error",
            errorMessage: action.message.slice(0, 300),
          },
        },
        callsUsed: callsAfter(current, action.callConsumed),
        updatedAt: action.at,
      });
    }

    case "focus_changed":
      if (action.nodeId !== null && !current.nodes[action.nodeId]) {
        throw new AtlasReducerError("The requested focus node is unavailable.");
      }
      return parseGraph({ ...current, focusedNodeId: action.nodeId });

    case "ripple_call_recorded":
      return parseGraph({
        ...current,
        callsUsed: callsAfter(current, true),
        updatedAt: action.at,
      });

    case "recover_interrupted": {
      let changed = false;
      const nodes = Object.fromEntries(
        Object.entries(current.nodes).map(([id, node]) => {
          if (node.status !== "generating") return [id, node];
          changed = true;
          return [
            id,
            {
              ...node,
              status: "error" as const,
              errorMessage: "This exploration was interrupted. Try again.",
            },
          ];
        }),
      );
      return changed ? parseGraph({ ...current, nodes, updatedAt: action.at }) : current;
    }
  }
}
