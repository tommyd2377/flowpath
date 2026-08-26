import type { ExpansionAvailability } from "../lib/atlas-reducer";
import type { PossibilityNode } from "../lib/contracts";

const terminalLabels: Partial<Record<Exclude<ExpansionAvailability, { allowed: true }>["reason"], string>> = {
  already_expanded: "View branches",
  generating: "Generating…",
  leaf: "View leaf",
  max_depth: "View depth 5",
  call_budget: "Call limit reached",
  node_budget: "Node limit reached",
  graph_unavailable: "Unavailable",
};

export function NodeCard({
  node,
  current = false,
  availability,
  onActivate,
  onRetry,
  interactionDisabled = false,
}: {
  node: PossibilityNode;
  current?: boolean;
  availability: ExpansionAvailability;
  onActivate?: () => void;
  onRetry?: () => void;
  interactionDisabled?: boolean;
}) {
  const actionLabel =
    node.status === "error"
      ? "Try again"
      : availability.allowed
        ? "Explore this path"
        : terminalLabels[availability.reason];
  return (
    <article className={`node-card${current ? " current-node" : ""}${node.status === "leaf" ? " leaf-node" : ""}`}>
      <div className="node-meta">
        <span>Depth {node.depth}</span>
        <span className={`node-status status-${node.status}`}>
          {node.status === "leaf" ? "Leaf" : node.status === "generating" ? "Exploring" : node.status === "error" ? "Error" : "Possibility"}
        </span>
      </div>
      <h2>{node.title}</h2>
      <p className="node-summary">{node.summary}</p>
      <p className="node-horizon">Horizon: {node.horizon}</p>
      <details className="node-details">
        <summary>Why this path is plausible</summary>
        <p>{node.whyPlausible}</p>
        <dl>
          <div>
            <dt>Key assumption</dt>
            <dd>{node.keyAssumption}</dd>
          </div>
          <div>
            <dt>Less likely if</dt>
            <dd>{node.lessLikelyIf}</dd>
          </div>
        </dl>
        <p className="detail-label">Signals to watch</p>
        <ul>{node.watchFor.map((signal) => <li key={signal}>{signal}</li>)}</ul>
      </details>
      {node.leafReason ? <p className="leaf-reason">{node.leafReason}</p> : null}
      {node.errorMessage ? <p className="inline-error" role="alert">{node.errorMessage}</p> : null}
      {!current || node.status === "error" || availability.allowed ? (
        <button
          type="button"
          className="node-action"
          disabled={interactionDisabled || node.status === "generating" || (!availability.allowed && availability.reason === "graph_unavailable")}
          onClick={node.status === "error" ? onRetry : onActivate}
        >
          {actionLabel}
          {node.status !== "generating" ? <span aria-hidden="true">→</span> : null}
        </button>
      ) : null}
    </article>
  );
}
