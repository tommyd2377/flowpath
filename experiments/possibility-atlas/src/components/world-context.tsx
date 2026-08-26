import Link from "next/link";

import type {
  WorldJourney,
  WorldJourneyExplorationMode,
} from "../lib/world-storage";

const influenceLabels = {
  raises_likelihood: "raises likelihood of",
  lowers_likelihood: "lowers likelihood of",
  accelerates: "accelerates",
  delays: "delays",
  amplifies_impact: "amplifies",
  reduces_pressure: "reduces pressure on",
  creates_dependency: "creates a dependency for",
} as const;

export function WorldContext({
  eventTitle,
  journey,
  explorationMode,
  canContinueCausally,
  onContinueCausally,
  onExploreIndependently,
}: {
  eventTitle: string;
  journey: WorldJourney | null;
  explorationMode: WorldJourneyExplorationMode | null;
  canContinueCausally: boolean;
  onContinueCausally: () => void;
  onExploreIndependently: () => void;
}) {
  const latest = journey?.transitions.at(-1) ?? null;
  if (!latest) {
    return (
      <aside className="world-context-inline" aria-label="World in Motion context">
        <span>World in Motion</span>
        <span aria-hidden="true">·</span>
        <Link href="/world">View snapshot</Link>
      </aside>
    );
  }
  return (
    <aside className="world-context-banner conditional-world-context" aria-label="World in Motion context">
      <div>
        <p className="eyebrow">World in Motion event</p>
        <p>
          You arrived here conditionally: if <strong>{latest.sourceScenarioTitle}</strong>, it{" "}
          {influenceLabels[latest.influence]} <strong>{latest.targetEventTitle}</strong>.
        </p>
        <div className="causal-mode-choice" aria-label="Choose how to explore this affected event">
          <p>How should new paths use that conditional link?</p>
          <div className="button-row causal-mode-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!canContinueCausally}
              aria-pressed={explorationMode === "causal"}
              onClick={onContinueCausally}
            >
              Continue this causal chain
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={explorationMode === "independent"}
              onClick={onExploreIndependently}
            >
              Explore this event independently
            </button>
          </div>
          {!canContinueCausally ? (
            <p className="context-note">
              This older saved link lacks enough detail to continue safely. Independent exploration is still available.
            </p>
          ) : null}
          {explorationMode ? (
            <p className="context-mode-status" role="status">
              {explorationMode === "causal"
                ? "New levels will keep the source scenario in view."
                : "New levels will analyze this event on its own."}
            </p>
          ) : null}
        </div>
      </div>
      <Link href="/world" className="secondary-button">View world snapshot</Link>
      <nav className="world-journey scroll-affordance-x" aria-label="Conditional event journey">
        <span>World</span>
        {journey?.transitions.map((transition, index) => (
          <span key={`${transition.sourceScenarioNodeId}-${transition.targetEventId}-${index}`}>
            <span aria-hidden="true">›</span>
            <span>{transition.sourceEventTitle}</span>
            <span aria-hidden="true">›</span>
            <span>{transition.sourceScenarioTitle}</span>
            <span aria-hidden="true">›</span>
            <em>{influenceLabels[transition.influence]}</em>
          </span>
        ))}
        <span aria-current="page"><span aria-hidden="true">›</span> {eventTitle}</span>
      </nav>
    </aside>
  );
}
