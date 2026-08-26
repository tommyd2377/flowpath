"use client";

import type { WorldEventSummary } from "../lib/world-contracts";
import { eventActionLabel, formatWorldFreshness } from "../lib/world-presentation";

export function eventStateLabel(event: WorldEventSummary) {
  if (event.state === "verified") return "Source snapshot saved";
  if (event.state === "inactive") return "Inactive event";
  return "Awaiting verification";
}

export function WorldEventCard({
  event,
  onExplore,
  disabled = false,
  opening = false,
  compact = false,
}: {
  event: WorldEventSummary;
  onExplore: (event: WorldEventSummary) => void;
  disabled?: boolean;
  opening?: boolean;
  compact?: boolean;
}) {
  return (
    <article
      className={`world-event-card${compact ? " world-event-card-compact" : ""}`}
      aria-busy={opening}
    >
      <div className="world-card-topline">
        <span className={`event-state event-state-${event.state}`}>
          {eventStateLabel(event)}
        </span>
      </div>
      <h3>{event.canonicalTitle}</h3>
      <p>{event.summary}</p>
      <dl className="world-card-facts">
        <div>
          <dt>Latest signal</dt>
          <dd>{formatWorldFreshness(event.lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Reporting</dt>
          <dd>
            {event.headlineIds.length} related {event.headlineIds.length === 1 ? "headline" : "headlines"}
          </dd>
        </div>
      </dl>
      {event.state === "candidate" ? (
        <p className="candidate-boundary">
          Grouped from current headlines. Opening it checks the facts before building scenarios.
        </p>
      ) : null}
      <button
        type="button"
        className="world-card-action"
        disabled={disabled || event.state === "inactive"}
        onClick={() => onExplore(event)}
      >
        {opening ? "Opening event…" : eventActionLabel(event)}
        {!opening ? <span aria-hidden="true">→</span> : null}
      </button>
    </article>
  );
}
