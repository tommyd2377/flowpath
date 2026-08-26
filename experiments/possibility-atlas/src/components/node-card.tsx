import type { ExpansionAvailability } from "../lib/atlas-reducer";
import type { PossibilityNode } from "../lib/contracts";

const terminalLabels: Partial<Record<Exclude<ExpansionAvailability, { allowed: true }>["reason"], string>> = {
  already_expanded: "View branches",
  generating: "Generating…",
  leaf: "End of path",
  max_depth: "Level 5 reached",
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
  hideAction = false,
  actionLabel,
  errorRetryable = true,
  onChooseAnother,
  scenarioFocus = false,
}: {
  node: PossibilityNode;
  current?: boolean;
  availability: ExpansionAvailability;
  onActivate?: () => void;
  onRetry?: () => void;
  interactionDisabled?: boolean;
  hideAction?: boolean;
  actionLabel?: string;
  errorRetryable?: boolean;
  onChooseAnother?: () => void;
  scenarioFocus?: boolean;
}) {
  const resolvedActionLabel =
    node.status === "error"
      ? errorRetryable
        ? "Try again"
        : "Choose another path"
      : actionLabel ??
        (availability.allowed
          ? "Explore this path"
          : terminalLabels[availability.reason]);
  return (
    <article className={`node-card${current ? " current-node" : ""}${node.status === "leaf" ? " leaf-node" : ""}${scenarioFocus ? " selected-scenario-card scenario-focus-anchor" : ""}`}>
      <div className="node-meta">
        <span>Level {node.depth}</span>
        <span className={`node-status status-${node.status}`}>
          {node.status === "leaf" ? "End of path" : node.status === "generating" ? "Exploring" : node.status === "error" ? "Error" : "Possibility"}
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
      {!hideAction && (!current || node.status === "error" || availability.allowed) ? (
        <button
          type="button"
          className="node-action"
          disabled={interactionDisabled || node.status === "generating" || (!availability.allowed && availability.reason === "graph_unavailable")}
          onClick={
            node.status === "error"
              ? errorRetryable
                ? onRetry
                : onChooseAnother
              : onActivate
          }
        >
          {resolvedActionLabel}
          {node.status !== "generating" ? <span aria-hidden="true">→</span> : null}
        </button>
      ) : null}
    </article>
  );
}
