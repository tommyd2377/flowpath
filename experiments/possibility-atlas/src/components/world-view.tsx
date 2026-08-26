"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { WorldEventSummary } from "../lib/world-contracts";
import {
  crossCurrentIdsWithCausalContext,
  openCrossCurrentEvent,
  openWorldEvent,
} from "../lib/world-navigation";
import {
  clusterCountLabel,
  eventActionLabel,
  formatWorldFreshness,
  influencePhrase,
  presentCrossCurrents,
  type PresentedCrossCurrent,
} from "../lib/world-presentation";
import { AtlasTeachingLine, ProductNavigation } from "./product-navigation";
import { useWorldCatalog } from "./use-world-catalog";
import {
  WorldEventCard,
  eventStateLabel,
} from "./world-event-card";

export function WorldView() {
  const router = useRouter();
  const {
    catalog,
    loading,
    refreshing,
    refreshLongRunning,
    message,
    messageTone,
    error,
    refresh,
  } = useWorldCatalog();
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [causalEdgeIds, setCausalEdgeIds] = useState<ReadonlySet<string>>(new Set());

  const explore = (event: WorldEventSummary, crossCurrent?: PresentedCrossCurrent) => {
    if (openingEventId || refreshing) return;
    setOpeningEventId(event.id);
    setOpenError(null);
    try {
      const opened = crossCurrent
        ? openCrossCurrentEvent(window.localStorage, crossCurrent)
        : openWorldEvent(window.localStorage, event);
      router.push(opened.href);
    } catch {
      setOpeningEventId(null);
      setOpenError("This browser could not save the event context. Existing atlases were not changed.");
    }
  };

  const pressurePoints =
    catalog?.pressurePoints.filter(({ event }) => event.state === "verified") ?? [];
  const awaitingVerification =
    catalog?.featuredCandidates.filter((event) => event.state === "candidate") ?? [];
  const crossCurrents = useMemo(() => presentCrossCurrents(catalog), [catalog]);
  const interactionsLocked = openingEventId !== null || refreshing;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCausalEdgeIds(crossCurrentIdsWithCausalContext(window.localStorage, crossCurrents));
    });
    return () => {
      cancelled = true;
    };
  }, [crossCurrents]);

  return (
    <main className="world-shell">
      <ProductNavigation page="world" />

      <header className="world-page-header">
        <div className="world-page-title">
          <div className="brand-mark" aria-hidden="true">PA</div>
          <div>
            <p className="eyebrow">Possibility Atlas · World</p>
            <h1>World in Motion</h1>
          </div>
        </div>
        <p>
          A focused view of consequential events, their unresolved scenarios, and the
          conditional connections you have already explored between them.
        </p>
        <div className="world-page-controls">
          <button type="button" className="primary-button" disabled={loading || refreshing || openingEventId !== null} onClick={() => void refresh()}>
            {refreshing ? "Scanning for changes…" : "Scan for changes"}
          </button>
          <span>
            {catalog?.scannedAt
              ? `Last scan · ${formatWorldFreshness(catalog.scannedAt)} · ${clusterCountLabel(catalog.events.length)}`
              : "No saved scan yet"}
          </span>
        </div>
      </header>

      <AtlasTeachingLine />

      {refreshing ? (
        <div className="world-refresh-progress world-route-refresh-progress" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <div>
            <strong>{refreshLongRunning ? "Still working—this scan can take around 30 seconds." : "Checking the headline feed for changes…"}</strong>
            <p>If the feed is fresh and changed, the server will compare saved events, regroup related reporting, and replace this snapshot only when the scan is complete.</p>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`notice world-notice${messageTone === "warning" ? " stale-notice" : ""}`} role="status">{message}</p>
      ) : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" disabled={refreshing} onClick={() => void refresh()}>Retry scan</button>
        </div>
      ) : null}
      {openError ? <p className="notice error-notice" role="alert">{openError}</p> : null}

      {loading ? (
        <div className="world-route-loading" aria-live="polite">
          <div className="spinner" />
          <span>Opening the saved world view…</span>
        </div>
      ) : catalog && catalog.events.length > 0 ? (
        <div className="world-sections">
          <section className="world-snapshot-section" aria-labelledby="pressure-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">Events with the widest explored reach</p>
                <h2 id="pressure-heading">Pressure Points</h2>
              </div>
              <span>{pressurePoints.length} checked</span>
            </div>
            {pressurePoints.length > 0 ? (
              <div className="world-event-grid world-event-grid-wide">
                {pressurePoints.map(({ event, outboundRippleCount }) => (
                  <div key={event.id} className="pressure-point-wrap">
                    <span className="outbound-count">
                      {outboundRippleCount === 0
                        ? "No explored connections yet"
                        : `${outboundRippleCount} explored ${outboundRippleCount === 1 ? "connection" : "connections"}`}
                    </span>
                    <WorldEventCard
                      event={event}
                      disabled={interactionsLocked}
                      opening={openingEventId === event.id}
                      onExplore={explore}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No checked pressure points yet.</strong>
                <p>Open an event from Awaiting verification to check its source snapshot and begin exploring scenarios.</p>
              </div>
            )}
          </section>

          <section className="world-snapshot-section" aria-labelledby="cross-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">Only when a specific scenario unfolds</p>
                <h2 id="cross-heading">Cross-currents</h2>
              </div>
              <span>{crossCurrents.length} explored {crossCurrents.length === 1 ? "connection" : "connections"}</span>
            </div>
            {crossCurrents.length > 0 ? (
              <div className="cross-current-list">
                {crossCurrents.map((crossCurrent) => {
                  const { edge, source, target, scenarioTitle } = crossCurrent;
                  const canContinueCausally = causalEdgeIds.has(edge.id);
                  return (
                  <article className="cross-current-card scenario-cross-current-card" key={edge.id}>
                    <p className="cross-current-condition-label">If this scenario unfolds</p>
                    <h3>
                      Within {source.canonicalTitle}: <em>“{scenarioTitle ?? edge.sourceScenarioTitle}”</em>
                    </h3>
                    <p className="cross-current-consequence">
                      It could {influencePhrase(edge.influence)} <strong>{target.canonicalTitle}</strong>.
                    </p>
                    <p>{edge.mechanism}</p>
                    <small>
                      Explored {formatWorldFreshness(edge.analyzedAt)} · Horizon: {edge.horizon} · Evidence confidence: {edge.confidence}
                    </small>
                    <small>
                      {canContinueCausally
                        ? "The matching source scenario is saved in this browser."
                        : "The source atlas is unavailable; opening this event will be independent."}
                    </small>
                    <button type="button" className="secondary-button" disabled={interactionsLocked} onClick={() => explore(target, crossCurrent)}>
                      {openingEventId === target.id
                        ? "Opening event…"
                        : canContinueCausally
                          ? "Continue this causal chain"
                          : "Explore independently"}
                    </button>
                  </article>
                  );
                })}
              </div>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No explored cross-currents yet.</strong>
                <p>Open a checked event, choose a primary scenario, then use Watch the world react.</p>
              </div>
            )}
          </section>

          <section className="world-snapshot-section" aria-labelledby="changed-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">Grouped reporting changed in the latest scan</p>
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
                    <button type="button" className="secondary-button" disabled={interactionsLocked} onClick={() => explore(event)}>
                      {openingEventId === event.id ? "Opening event…" : eventActionLabel(event)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No grouped reporting changed in the latest saved scan.</strong>
              </div>
            )}
          </section>

          <section className="world-snapshot-section awaiting-verification-section" aria-labelledby="awaiting-heading">
            <div className="world-section-heading">
              <div>
                <p className="eyebrow">All active headline-derived candidates</p>
                <h2 id="awaiting-heading">Awaiting verification</h2>
              </div>
              <span>{awaitingVerification.length} events</span>
            </div>
            <p className="awaiting-verification-intro">
              These clusters are visible before verification so the world view never hides active candidates. Open one to check its source facts and build its event atlas.
            </p>
            {awaitingVerification.length > 0 ? (
              <div className="world-event-grid world-event-grid-wide">
                {awaitingVerification.map((event) => (
                  <WorldEventCard
                    key={event.id}
                    event={event}
                    disabled={interactionsLocked}
                    opening={openingEventId === event.id}
                    onExplore={explore}
                  />
                ))}
              </div>
            ) : (
              <div className="world-empty compact-empty">
                <strong>No active events are waiting for verification.</strong>
              </div>
            )}
          </section>
        </div>
      ) : !error ? (
        <section className="empty-state route-empty">
          <p className="eyebrow">World view</p>
          <h1>Scan the feed for the first event clusters.</h1>
          <p>Nothing runs in the background. Scan for changes starts one bounded classification request only when the feed is fresh and different.</p>
        </section>
      ) : null}

      <aside className="world-source-callout world-source-callout-footer">
        <span aria-hidden="true">◎</span>
        <p>
          This local prototype discovers reporting through a limited U.S. Google News RSS feed.
          It is not a complete or geographically balanced representation of world events.
        </p>
      </aside>
    </main>
  );
}
