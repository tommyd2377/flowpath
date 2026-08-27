"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ErrorResponseSchema,
  HeadlinesResponseSchema,
  type HeadlineItem,
  type StorageEnvelope,
} from "../lib/contracts";
import { createAtlasGraph } from "../lib/atlas-reducer";
import {
  ATLAS_STORAGE_KEY,
  cacheHeadlines,
  loadStorageEnvelope,
  recentAtlases,
  saveStorageEnvelope,
  upsertAtlas,
} from "../lib/storage";

type FeedState = "loading" | "ready" | "stale" | "error";

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );
}

function atlasStatusLabel(status: string) {
  if (status === "ready") return "Resume atlas";
  if (status === "verifying") return "Continue verification";
  if (status === "insufficient_evidence") return "Review evidence result";
  return "Review interrupted atlas";
}

export function HeadlinePicker() {
  const router = useRouter();
  const envelopeRef = useRef<StorageEnvelope | null>(null);
  const selectionLockedRef = useRef(false);
  const [envelope, setEnvelope] = useState<StorageEnvelope | null>(null);
  const [headlines, setHeadlines] = useState<HeadlineItem[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [selectedHeadlineId, setSelectedHeadlineId] = useState<string | null>(null);

  const persist = useCallback((next: StorageEnvelope) => {
    envelopeRef.current = next;
    setEnvelope(next);
    try {
      const saved = saveStorageEnvelope(window.localStorage, next);
      envelopeRef.current = saved.envelope;
      setEnvelope(saved.envelope);
      if (saved.prunedAtlasIds.length > 0) {
        setStorageWarning("Older atlases were removed to keep browser storage within its limit.");
      }
      if (saved.droppedHeadlineCache) {
        setStorageWarning("The cached headline list was removed to preserve your active atlas.");
      }
    } catch {
      setStorageWarning("This browser could not save more atlas data. Existing work remains on this screen.");
    }
  }, []);

  const fetchHeadlines = useCallback(async () => {
    const cached = envelopeRef.current?.lastHeadlines ?? [];
    setFeedState(cached.length > 0 ? "stale" : "loading");
    setMessage(cached.length > 0 ? "Refreshing headlines… Showing the saved list for now." : null);
    try {
      const response = await fetch("/api/headlines", { cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsedError = ErrorResponseSchema.safeParse(payload);
        throw new Error(parsedError.success ? parsedError.data.error.message : "Headlines are unavailable.");
      }
      const parsed = HeadlinesResponseSchema.parse(payload);
      setHeadlines(parsed.items);
      setFeedState(parsed.stale ? "stale" : "ready");
      setMessage(parsed.warning ?? (parsed.stale ? "The source returned a cached headline list." : null));
      const current = envelopeRef.current;
      if (current) persist(cacheHeadlines(current, parsed.items, parsed.fetchedAt));
    } catch (error) {
      if (cached.length > 0) {
        setHeadlines(cached);
        setFeedState("stale");
        setMessage("Live headlines could not be refreshed. Showing the last list saved in this browser.");
      } else {
        setFeedState("error");
        setMessage(error instanceof Error ? error.message : "Headlines could not be loaded.");
      }
    }
  }, [persist]);

  useEffect(() => {
    let cancelled = false;
    const loaded = loadStorageEnvelope(window.localStorage);
    envelopeRef.current = loaded.envelope;
    queueMicrotask(() => {
      if (cancelled) return;
      setEnvelope(loaded.envelope);
      setStorageWarning(loaded.warning);
      if (loaded.envelope.lastHeadlines.length > 0) {
        setHeadlines(loaded.envelope.lastHeadlines);
      }
      void fetchHeadlines();
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ATLAS_STORAGE_KEY) return;
      const refreshed = loadStorageEnvelope(window.localStorage);
      envelopeRef.current = refreshed.envelope;
      setEnvelope(refreshed.envelope);
      if (refreshed.envelope.lastHeadlines.length > 0) {
        setHeadlines(refreshed.envelope.lastHeadlines);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, [fetchHeadlines]);

  const chooseHeadline = (headline: HeadlineItem) => {
    const current = envelopeRef.current;
    if (!current || selectionLockedRef.current) return;
    selectionLockedRef.current = true;
    setSelectedHeadlineId(headline.id);
    const now = new Date().toISOString();
    const graph = createAtlasGraph({ id: crypto.randomUUID(), headline, now });
    persist(upsertAtlas(current, graph));
    router.push(`/atlas/${graph.id}`);
  };

  const recent = envelope ? recentAtlases(envelope, 4) : [];

  return (
    <main className="picker-shell">
      <header className="brand-row">
        <div className="brand-mark" aria-hidden="true">PA</div>
        <div>
          <p className="eyebrow">Possibility Atlas</p>
          <h1>See what could happen next.</h1>
        </div>
      </header>

      {storageWarning ? <p className="notice warning-notice" role="status">{storageWarning}</p> : null}

      {recent.length > 0 ? (
        <section className="recent-section" aria-labelledby="recent-heading">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Saved only in this browser</p>
              <h2 id="recent-heading">Recent atlases</h2>
            </div>
          </div>
          <div className="recent-grid">
            {recent.map((atlas) => (
              <button key={atlas.id} type="button" className="recent-card" onClick={() => router.push(`/atlas/${atlas.id}${atlas.focusedNodeId ? `?node=${atlas.focusedNodeId}` : ""}`)}>
                <span>{atlas.headline.title}</span>
                <small>{atlasStatusLabel(atlas.status)} · {Object.keys(atlas.nodes).length + 1} nodes</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="headline-panel" aria-labelledby="headline-heading" aria-busy={feedState === "loading"}>
        <div className="step-strip"><span id="headline-heading">Headline</span></div>
        <p className="instruction">Choose a headline to explore its possible paths.</p>
        {message ? (
          <div className={`notice ${feedState === "error" ? "error-notice" : "stale-notice"}`} role={feedState === "error" ? "alert" : "status"}>
            <span>{message}</span>
            <button type="button" className="text-button" onClick={() => void fetchHeadlines()}>Retry</button>
          </div>
        ) : null}

        {feedState === "loading" ? (
          <div className="headline-grid" aria-label="Loading headlines">
            {Array.from({ length: 9 }, (_, index) => <div key={index} className="headline-card headline-skeleton" />)}
          </div>
        ) : headlines.length > 0 ? (
          <div className="headline-grid" aria-busy={selectedHeadlineId !== null}>
            {headlines.map((headline) => (
              <button className="headline-card" key={headline.id} type="button" disabled={selectedHeadlineId !== null} onClick={() => chooseHeadline(headline)}>
                <span>{selectedHeadlineId === headline.id ? "Opening atlas…" : headline.title}</span>
                <small>{headline.publisher ?? "Google News source"} · {formatDate(headline.publishedAt)}</small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h2>No headlines are available right now.</h2>
            <p>Try the feed again without losing any atlases already saved in this browser.</p>
            <button type="button" className="primary-button" onClick={() => void fetchHeadlines()}>Try again</button>
          </div>
        )}
      </section>

      <aside className="preview-note">
        <span className="note-dot" aria-hidden="true" />
        <span>Current facts become a frozen, cited snapshot. Everything below it is labeled as possibility—not prediction.</span>
      </aside>
    </main>
  );
}
