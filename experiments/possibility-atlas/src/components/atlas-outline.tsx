import type { AtlasGraph } from "../lib/contracts";

function OutlineBranch({
  graph,
  nodeId,
  focusedNodeId,
  onSelect,
}: {
  graph: AtlasGraph;
  nodeId: string;
  focusedNodeId: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const node = graph.nodes[nodeId];
  if (!node) return null;
  return (
    <li>
      <button
        type="button"
        className="outline-node"
        aria-current={focusedNodeId === node.id ? "true" : undefined}
        aria-expanded={node.childIds.length > 0 ? true : undefined}
        onClick={() => onSelect(node.id)}
      >
        <span className="outline-depth">L{node.depth}</span>
        <span>{node.title}</span>
        {node.status === "leaf" ? <span className="outline-state">End of path</span> : null}
        {node.status === "generating" ? <span className="outline-state">Loading</span> : null}
        {node.status === "error" ? <span className="outline-state error-text">Error</span> : null}
      </button>
      {node.childIds.length > 0 ? (
        <ol>
          {node.childIds.map((childId) => (
            <OutlineBranch
              key={childId}
              graph={graph}
              nodeId={childId}
              focusedNodeId={focusedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function AtlasOutline({
  graph,
  onSelect,
  rootTitle,
}: {
  graph: AtlasGraph;
  onSelect: (nodeId: string | null) => void;
  rootTitle?: string;
}) {
  return (
    <nav className="atlas-outline" aria-label="Full atlas outline">
      <button
        type="button"
        className="outline-node outline-root"
        aria-current={graph.focusedNodeId === null ? "true" : undefined}
        aria-expanded={graph.rootChildIds.length > 0}
        onClick={() => onSelect(null)}
      >
        <span className="outline-depth">Root</span>
        <span>{rootTitle ?? graph.headline.title}</span>
      </button>
      <ol>
        {graph.rootChildIds.map((nodeId) => (
          <OutlineBranch
            key={nodeId}
            graph={graph}
            nodeId={nodeId}
            focusedNodeId={graph.focusedNodeId}
            onSelect={(id) => onSelect(id)}
          />
        ))}
      </ol>
    </nav>
  );
}
