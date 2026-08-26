"use client";

import { useMemo } from "react";

import type { AtlasGraph } from "../lib/contracts";
import type {
  WorldEventsResponse,
} from "../lib/world-contracts";
import type { WorldJourneyTransition } from "../lib/world-storage";
import {
  influencePhrase,
  presentCrossCurrents,
  type PresentedCrossCurrent,
} from "../lib/world-presentation";

export function WorldReactionFeature({
  catalog,
  atlasGraphs = [],
  transitions = [],
  disabled,
  openingEventId,
  causalEdgeIds,
  onExplore,
}: {
  catalog: WorldEventsResponse | null;
  atlasGraphs?: AtlasGraph[];
  transitions?: WorldJourneyTransition[];
  disabled: boolean;
  openingEventId: string | null;
  causalEdgeIds: ReadonlySet<string>;
  onExplore: (crossCurrent: PresentedCrossCurrent) => void;
}) {
  const crossCurrent = useMemo(
    () => presentCrossCurrents(catalog, { atlasGraphs, transitions })[0] ?? null,
    [atlasGraphs, catalog, transitions],
  );

  const sourceTitle = crossCurrent?.source.canonicalTitle ?? "Shipping access changes";
  const scenarioTitle = crossCurrent?.scenarioTitle ?? "Restricted transit lasts several weeks";
  const targetTitle = crossCurrent?.target.canonicalTitle ?? "Delivery costs and price pressure rise";
  const canContinueCausally = crossCurrent
    ? causalEdgeIds.has(crossCurrent.edge.id)
    : false;

  return (
    <section className="world-reaction-feature" aria-labelledby="world-reaction-heading">
      <div className="world-reaction-heading">
        <div>
          <p className="eyebrow">
            {crossCurrent ? "Explored cross-current" : "Illustrative path · no analysis call"}
          </p>
          <h3 id="world-reaction-heading">Touch a possible future. See what it could affect.</h3>
        </div>
        {crossCurrent ? <span className="world-reaction-status">Scenario-conditional</span> : null}
      </div>

      <div className="world-reaction-path">
        <article className="world-reaction-step world-reaction-event">
          <span>Current event</span>
          <strong>{sourceTitle}</strong>
        </article>
        <div className="world-reaction-connector" aria-hidden="true">
          <span>↓</span>
        </div>
        <article className="world-reaction-step world-reaction-scenario">
          <span>Possible next state</span>
          <strong>{scenarioTitle}</strong>
        </article>
        <div className="world-reaction-connector" aria-hidden="true">
          <span>↓</span>
          {crossCurrent ? <small>{influencePhrase(crossCurrent.edge.influence)}</small> : <small>could affect</small>}
        </div>
        <article className="world-reaction-step world-reaction-affected">
          <span>Affected event</span>
          <strong>{targetTitle}</strong>
        </article>
      </div>

      {crossCurrent ? (
        <div className="world-reaction-detail">
          <p>
            If <strong>“{scenarioTitle}”</strong> unfolds within {sourceTitle}, it could {influencePhrase(crossCurrent.edge.influence)} {targetTitle}.
            {" "}{crossCurrent.edge.mechanism}
          </p>
          <p>
            {canContinueCausally
              ? "Open the affected event with this saved condition attached."
              : "This is a saved relationship preview. Its source atlas is unavailable here, so the affected event will open independently."}
          </p>
          <button
            type="button"
            className="secondary-button world-reaction-action"
            disabled={disabled}
            onClick={() => onExplore(crossCurrent)}
          >
            {openingEventId === crossCurrent.target.id
              ? "Opening event…"
              : canContinueCausally
                ? "Continue this causal chain"
                : "Explore independently"}
          </button>
        </div>
      ) : (
        <p className="world-reaction-example-note">
          This is a teaching example, not a claim about current events. Explore a connected event and trace a scenario to replace it with a saved cross-current.
        </p>
      )}
    </section>
  );
}
