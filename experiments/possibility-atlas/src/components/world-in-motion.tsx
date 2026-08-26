"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { WorldEventSummary } from "../lib/world-contracts";
import { openWorldEvent } from "../lib/world-navigation";
import { useWorldCatalog } from "./use-world-catalog";
import { WorldEventCard, formatWorldDate } from "./world-event-card";

export function WorldInMotion() {
  const router = useRouter();
  const { catalog, loading, refreshing, message, error, load, refresh } = useWorldCatalog();
  const [openingEventId, setOpeningEventId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const featured = catalog?.events.slice(0, 3) ?? [];

  const explore = (event: WorldEventSummary) => {
    if (openingEventId) return;
    setOpeningEventId(event.id);
    setOpenError(null);
    try {
      const opened = openWorldEvent(window.localStorage, event);
      router.push(opened.href);
    } catch {
      setOpeningEventId(null);
      setOpenError("This browser could not save the event context. Your existing atlases are unchanged.");
    }
  };

  return (
    <section className="world-panel" aria-labelledby="world-motion-heading" aria-busy={loading || refreshing}>
      <div className="world-panel-heading">
        <div>
          <p className="eyebrow">World in Motion</p>
          <h2 id="world-motion-heading">Choose an event. Then watch its possibilities ripple outward.</h2>
          <p>
            Headlines are grouped into consequential events with several plausible next states.
            Connections appear only after an event is verified.
          </p>
        </div>
        <div className="world-panel-actions">
          <button type="button" className="primary-button" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? "Building world view…" : catalog?.scannedAt ? "Refresh world view" : "Build world view"}
          </button>
          <Link href="/world" className="secondary-button">Open global snapshot</Link>
        </div>
      </div>

      {catalog?.scannedAt ? (
        <p className="world-snapshot-time">Snapshot built {formatWorldDate(catalog.scannedAt)}</p>
      ) : null}
      {message ? <p className="notice world-notice" role="status">{message}</p> : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error} Headlines below are still available.</span>
          <button type="button" className="text-button" onClick={() => void load()}>Retry</button>
        </div>
      ) : null}
      {openError ? <p className="notice error-notice" role="alert">{openError}</p> : null}

      {loading ? (
        <div className="world-event-grid" aria-label="Loading saved world view">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="world-event-card world-card-skeleton" />)}
        </div>
      ) : featured.length > 0 ? (
        <div className="world-event-grid">
          {featured.map((event) => (
            <WorldEventCard
              key={event.id}
              event={event}
              disabled={openingEventId !== null}
              onExplore={explore}
            />
          ))}
        </div>
      ) : !error ? (
        <div className="world-empty">
          <strong>No world view has been built yet.</strong>
          <p>Build one explicitly from the current feed. Loading this page never makes a model call by itself.</p>
        </div>
      ) : null}

      <p className="world-source-boundary">
        Discovery uses a limited U.S. Google News RSS feed. This is an exploratory local snapshot, not a comprehensive view of the world.
      </p>
    </section>
  );
}
