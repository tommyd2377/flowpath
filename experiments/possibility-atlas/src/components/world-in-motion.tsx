"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import type { StorageEnvelope } from "../lib/contracts";
import type { WorldEventSummary } from "../lib/world-contracts";
import {
  crossCurrentIdsWithCausalContext,
  openCrossCurrentEvent,
  openWorldEvent,
} from "../lib/world-navigation";
import {
  clusterCountLabel,
  formatWorldFreshness,
  presentCrossCurrents,
  type PresentedCrossCurrent,
} from "../lib/world-presentation";
import type { WorldCatalogController } from "./use-world-catalog";
import { WorldEventCard } from "./world-event-card";
import { WorldReactionFeature } from "./world-reaction-feature";

export function WorldInMotion({
  world,
  envelope,
}: {
  world: WorldCatalogController;
  envelope: StorageEnvelope | null;
}) {
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
  } = world;
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [causalEdgeIds, setCausalEdgeIds] = useState<ReadonlySet<string>>(new Set());
  const featured = catalog?.events.slice(0, 3) ?? [];
  const crossCurrents = useMemo(
    () => presentCrossCurrents(catalog, { atlasGraphs: Object.values(envelope?.atlases ?? {}) }),
    [catalog, envelope],
  );

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
      setOpenError("This browser could not save the event context. Your existing atlases are unchanged.");
    }
  };

  const interactionsLocked = openingEventId !== null || refreshing;

  return (
    <section id="world" className="world-panel home-world-panel" aria-labelledby="world-motion-heading" aria-busy={loading || refreshing}>
      <div className="world-panel-heading">
        <div>
          <p className="eyebrow">World · Connected events</p>
          <h2 id="world-motion-heading">Start with an event. Then watch one possibility move through the world.</h2>
        </div>
        <div className="world-panel-actions">
          <button type="button" className="primary-button" disabled={loading || refreshing || openingEventId !== null} onClick={() => void refresh()}>
            {refreshing ? "Scanning for changes…" : "Scan for changes"}
          </button>
          <Link href="/world" className="secondary-button">Open full world view</Link>
        </div>
      </div>

      <WorldReactionFeature
        catalog={catalog}
        atlasGraphs={Object.values(envelope?.atlases ?? {})}
        disabled={interactionsLocked}
        openingEventId={openingEventId}
        causalEdgeIds={causalEdgeIds}
        onExplore={(crossCurrent) => explore(crossCurrent.target, crossCurrent)}
      />

      {catalog?.scannedAt ? (
        <p className="world-snapshot-time">
          Last scan · {formatWorldFreshness(catalog.scannedAt)} · {clusterCountLabel(catalog.events.length)}
        </p>
      ) : null}

      {refreshing ? (
        <div className="world-refresh-progress" role="status" aria-live="polite">
          <div className="spinner" aria-hidden="true" />
          <div>
            <strong>{refreshLongRunning ? "Still working—this scan can take around 30 seconds." : "Checking the headline feed for changes…"}</strong>
            <p>If the feed is fresh and changed, the server will compare saved events, regroup related reporting, and replace the snapshot only when the scan is complete.</p>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className={`notice world-notice${messageTone === "warning" ? " stale-notice" : ""}`} role="status">{message}</p>
      ) : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error} Standalone headlines below are still available.</span>
          <button type="button" className="text-button" disabled={refreshing} onClick={() => void refresh()}>Retry scan</button>
        </div>
      ) : null}
      {openError ? <p className="notice error-notice" role="alert">{openError}</p> : null}

      {loading ? (
        <div className="world-event-grid" aria-label="Loading saved world view">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="world-event-card world-card-skeleton" />)}
        </div>
      ) : featured.length > 0 ? (
        <div className="world-event-section">
          <div className="world-event-section-heading">
            <h3>Choose a connected event</h3>
            <span>{featured.length} featured</span>
          </div>
          <div className="world-event-grid">
            {featured.map((event) => (
              <WorldEventCard
                key={event.id}
                event={event}
                disabled={interactionsLocked}
                opening={openingEventId === event.id}
                onExplore={explore}
              />
            ))}
          </div>
        </div>
      ) : !error ? (
        <div className="world-empty">
          <strong>No connected-event snapshot yet.</strong>
          <p>Scan for changes to group the current feed into event clusters. Loading this page never starts that scan by itself.</p>
        </div>
      ) : null}

      <p className="world-source-boundary">
        Discovery uses a limited U.S. Google News RSS feed. This exploratory local snapshot is not a complete or geographically balanced view of world events.
      </p>
    </section>
  );
}
