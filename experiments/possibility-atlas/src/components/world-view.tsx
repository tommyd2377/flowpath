"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { WorldEventSummary } from "../lib/world-contracts";
import { openWorldEvent } from "../lib/world-navigation";
import { useWorldCatalog } from "./use-world-catalog";
import {
  WorldEventCard,
  eventStateLabel,
  formatWorldDate,
} from "./world-event-card";

const influenceLabels = {
  raises_likelihood: "raises the likelihood of",
  lowers_likelihood: "lowers the likelihood of",
  accelerates: "accelerates",
  delays: "delays",
  amplifies_impact: "amplifies the impact of",
  reduces_pressure: "reduces pressure on",
  creates_dependency: "creates a dependency for",
} as const;

export function WorldView() {
  const router = useRouter();
  const { catalog, loading, refreshing, message, error, load, refresh } = useWorldCatalog();
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const eventsById = useMemo(
    () => new Map((catalog?.events ?? []).map((event) => [event.id, event])),
    [catalog?.events],
  );

  const explore = (event: WorldEventSummary) => {
    if (openingEventId) return;
    setOpeningEventId(event.id);
    setOpenError(null);
    try {
      const opened = openWorldEvent(window.localStorage, event);
      router.push(opened.href);
    } catch {
      setOpeningEventId(null);
      setOpenError("This browser could not save the event context. Existing atlases were not changed.");
    }
  };

  const verifiedPressurePoints =
    catalog?.pressurePoints.filter(({ event }) => event.state === "verified") ?? [];
  const pressurePoints =
    verifiedPressurePoints.length > 0
      ? verifiedPressurePoints
      : (catalog?.events.slice(0, 6).map((event) => ({ event, outboundRippleCount: 0 })) ?? []);
  const showingCandidateFallback = verifiedPressurePoints.length === 0 && pressurePoints.length > 0;

  return (
    <main className="world-shell">
      <header className="world-page-header">
        <Link href="/" className="back-link">← Headlines</Link>
        <div className="world-page-title">
          <div className="brand-mark" aria-hidden="true">WM</div>
          <div>
            <p className="eyebrow">Possibility Atlas</p>
            <h1>World in Motion</h1>
          </div>
        </div>
        <p>
          A focused snapshot of consequential events, their unresolved scenarios, and the
          conditional links already explored between them.
        </p>
        <div className="world-page-controls">
          <button type="button" className="primary-button" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? "Building world view…" : catalog?.scannedAt ? "Refresh world view" : "Build world view"}
          </button>
          <span>{catalog?.scannedAt ? `Snapshot ${formatWorldDate(catalog.scannedAt)}` : "No saved snapshot"}</span>
        </div>
      </header>

      <aside className="world-source-callout">
        <span aria-hidden="true">◎</span>
        <p>
          This local prototype discovers reporting through a limited U.S. Google News RSS feed.
          It is not a complete or geographically balanced representation of world events.
        </p>
      </aside>

      {message ? <p className="notice world-notice" role="status">{message}</p> : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" onClick={() => void load()}>Retry</button>
        </div>
      ) : null}
      {openError ? <p className="notice error-notice" role="alert">{openError}</p> : null}

      {loading ? (
        <div className="world-route-loading" aria-live="polite">
          <div className="spinner" />
          <span>Opening the saved world snapshot…</span>
        </div>
      ) : catalog && catalog.events.length > 0 ? (
        <div className="world-sections">
          <section className="world-snapshot-section" aria-labelledby="pressure-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">Largest levers</p>
                <h2 id="pressure-heading">Pressure Points</h2>
              </div>
              <span>{pressurePoints.length} active</span>
            </div>
            {showingCandidateFallback ? (
              <p className="candidate-fallback-notice">
                No verified ripple network exists yet. These are headline-derived candidates,
                not confirmed pressure points.
              </p>
            ) : null}
            <div className="world-event-grid world-event-grid-wide">
              {pressurePoints.map(({ event, outboundRippleCount }) => (
                <div key={event.id} className="pressure-point-wrap">
                  {event.state === "verified" ? (
                    <span className="outbound-count">
                      {outboundRippleCount} stored outbound {outboundRippleCount === 1 ? "connection" : "connections"}
                    </span>
                  ) : null}
                  <WorldEventCard
                    event={event}
                    disabled={openingEventId !== null}
                    onExplore={explore}
                  />
                </div>
              ))}
            </div>
          </section>

          <section className="world-snapshot-section" aria-labelledby="cross-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">Conditional connections</p>
                <h2 id="cross-heading">Verified Cross-currents</h2>
              </div>
              <span>{catalog.crossCurrents.length} links</span>
            </div>
            {catalog.crossCurrents.length > 0 ? (
              <div className="cross-current-list">
                {catalog.crossCurrents.map((edge) => {
                  const source = eventsById.get(edge.sourceEventId);
                  const target = eventsById.get(edge.targetEventId);
                  return (
                    <article className="cross-current-card" key={edge.id}>
                      <div className="cross-current-labels">
                        <span>{edge.strength} influence</span>
                        <span>{edge.confidence} evidence confidence</span>
                      </div>
                      <h3>
                        {source?.canonicalTitle ?? "A verified source event"}{" "}
                        <em>{influenceLabels[edge.influence]}</em>{" "}
                        {target?.canonicalTitle ?? "another active event"}
                      </h3>
                      <p>{edge.mechanism}</p>
                      <small>Horizon: {edge.horizon} · Analyzed {formatWorldDate(edge.analyzedAt)}</small>
                      {target ? (
                        <button type="button" className="secondary-button" disabled={openingEventId !== null} onClick={() => explore(target)}>
                          View affected event
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No verified cross-currents yet.</strong>
                <p>Verify an event, choose a primary scenario, then use Watch the world react.</p>
              </div>
            )}
          </section>

          <section className="world-snapshot-section" aria-labelledby="changed-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">New supporting signals</p>
                <h2 id="changed-heading">Recently Changed</h2>
              </div>
              <span>{catalog.recentlyChanged.length} events</span>
            </div>
            {catalog.recentlyChanged.length > 0 ? (
              <ul className="recent-change-list">
                {catalog.recentlyChanged.map((event) => (
                  <li key={event.id}>
                    <div>
                      <span className={`event-state event-state-${event.state}`}>{eventStateLabel(event)}</span>
                      <h3>{event.canonicalTitle}</h3>
                      <p>{event.summary}</p>
                    </div>
                    <button type="button" className="secondary-button" disabled={openingEventId !== null} onClick={() => explore(event)}>
                      Explore event
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No changed events in the latest saved scan.</strong>
              </div>
            )}
          </section>
        </div>
      ) : !error ? (
        <section className="empty-state route-empty">
          <p className="eyebrow">Explicit refresh</p>
          <h1>Build the first world snapshot.</h1>
          <p>Nothing runs in the background. The button above starts one bounded classification request.</p>
        </section>
      ) : null}
    </main>
  );
}
