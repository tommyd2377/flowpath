"use client";

import type { WorldEventSummary } from "../lib/world-contracts";

export function formatWorldDate(value: string | null) {
  if (!value) return "Not built yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ripplePotentialLabel(value: WorldEventSummary["ripplePotential"]) {
  if (value === "very_high") return "Very high ripple potential";
  if (value === "high") return "High ripple potential";
  return "Moderate ripple potential";
}

export function eventStateLabel(event: WorldEventSummary) {
  if (event.state === "verified") return "Verified event";
  if (event.state === "inactive") return "Inactive event";
  return "From current headlines · Verification pending";
}

export function WorldEventCard({
  event,
  onExplore,
  disabled = false,
  compact = false,
}: {
  event: WorldEventSummary;
  onExplore: (event: WorldEventSummary) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <article
      className={`world-event-card${compact ? " world-event-card-compact" : ""}`}
    >
      <div className="world-card-topline">
        <span className={`event-state event-state-${event.state}`}>
          {eventStateLabel(event)}
        </span>
        <span className={`ripple-band ripple-${event.ripplePotential}`}>
          {ripplePotentialLabel(event.ripplePotential)}
        </span>
      </div>
      <h3>{event.canonicalTitle}</h3>
      <p>{event.summary}</p>
      <dl className="world-card-facts">
        <div>
          <dt>Latest signal</dt>
          <dd>{formatWorldDate(event.lastSeenAt)}</dd>
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
          This summary is derived from headlines and has not yet been independently verified.
        </p>
      ) : null}
      <button
        type="button"
        className="world-card-action"
        disabled={disabled || event.state === "inactive"}
        onClick={() => onExplore(event)}
      >
        {disabled ? "Opening event…" : "Explore event"}
        {!disabled ? <span aria-hidden="true">→</span> : null}
      </button>
    </article>
  );
}
