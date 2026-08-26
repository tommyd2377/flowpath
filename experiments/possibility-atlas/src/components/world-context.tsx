import Link from "next/link";

import type { WorldJourney } from "../lib/world-storage";

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
}: {
  eventTitle: string;
  journey: WorldJourney | null;
}) {
  const latest = journey?.transitions.at(-1) ?? null;
  return (
    <aside className="world-context-banner" aria-label="World in Motion context">
      <div>
        <p className="eyebrow">World in Motion event</p>
        {latest ? (
          <p>
            You arrived here conditionally: if <strong>{latest.sourceScenarioTitle}</strong>, it{" "}
            {influenceLabels[latest.influence]} <strong>{latest.targetEventTitle}</strong>.
          </p>
        ) : (
          <p>This event was selected from the saved global snapshot.</p>
        )}
      </div>
      <Link href="/world" className="secondary-button">View world snapshot</Link>
      <nav className="world-journey" aria-label="Conditional event journey">
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
