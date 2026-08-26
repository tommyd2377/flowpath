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
import { openSavedAtlasDirectly } from "../lib/world-navigation";
import {
  ATLAS_STORAGE_KEY,
  cacheHeadlines,
  loadStorageEnvelope,
  recentAtlases,
  saveStorageEnvelope,
  upsertAtlas,
} from "../lib/storage";
import { AtlasTeachingLine, ProductNavigation } from "./product-navigation";
import { useWorldCatalog } from "./use-world-catalog";
import { WorldInMotion } from "./world-in-motion";

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
  const world = useWorldCatalog();
  const envelopeRef = useRef<StorageEnvelope | null>(null);
  const selectionLockedRef = useRef(false);
  const [envelope, setEnvelope] = useState<StorageEnvelope | null>(null);
  const [headlines, setHeadlines] = useState<HeadlineItem[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [selectedHeadlineId, setSelectedHeadlineId] = useState<string | null>(null);
  const [openingSavedAtlasId, setOpeningSavedAtlasId] = useState<string | null>(null);

  const persist = useCallback((next: StorageEnvelope) => {
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
      return saved.envelope;
    } catch {
      setStorageWarning("This browser could not save more atlas data. Existing work remains on this screen.");
      throw new Error("Browser storage could not save the requested atlas change.");
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
      if (current) {
        try {
          persist(cacheHeadlines(current, parsed.items, parsed.fetchedAt));
        } catch {
          // The fresh feed remains usable even when its browser cache cannot be updated.
        }
      }
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
    if (!current || selectionLockedRef.current || world.refreshing) return;
    selectionLockedRef.current = true;
    setSelectedHeadlineId(headline.id);
    const now = new Date().toISOString();
    const graph = createAtlasGraph({ id: crypto.randomUUID(), headline, now });
    try {
      persist(upsertAtlas(current, graph));
      router.push(`/atlas/${graph.id}`);
    } catch {
      selectionLockedRef.current = false;
      setSelectedHeadlineId(null);
    }
  };

  const openSavedAtlas = (graphId: string, nodeId: string | null) => {
    if (selectionLockedRef.current || world.refreshing) return;
    selectionLockedRef.current = true;
    setOpeningSavedAtlasId(graphId);
    setStorageWarning(null);
    try {
      const opened = openSavedAtlasDirectly(window.localStorage, { graphId, nodeId });
      router.push(opened.href);
    } catch {
      selectionLockedRef.current = false;
      setOpeningSavedAtlasId(null);
      setStorageWarning("This browser could not open that saved atlas. Your existing work is unchanged.");
    }
  };

  const recent = envelope ? recentAtlases(envelope, 4) : [];

  return (
    <main className="picker-shell">
      <header className="home-header">
        <div className="brand-row home-brand-row">
          <div className="brand-mark" aria-hidden="true">PA</div>
          <div>
            <p className="eyebrow">Possibility Atlas</p>
            <h1>See what could happen next—and what it could change.</h1>
          </div>
        </div>
        <ProductNavigation page="home" />
        <AtlasTeachingLine />
      </header>

      {storageWarning ? <p className="notice warning-notice" role="status">{storageWarning}</p> : null}

      <WorldInMotion world={world} envelope={envelope} />

      <section id="saved" className="recent-section saved-section" aria-labelledby="recent-heading">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Saved in this browser</p>
            <h2 id="recent-heading">Saved atlases</h2>
          </div>
          {recent.length > 0 ? <span className="saved-atlas-count">{recent.length} recent</span> : null}
        </div>
        {recent.length > 0 ? (
          <div className="recent-grid">
            {recent.map((atlas) => (
              <button
                key={atlas.id}
                type="button"
                className="recent-card"
                disabled={world.refreshing || openingSavedAtlasId !== null}
                onClick={() => openSavedAtlas(atlas.id, atlas.focusedNodeId)}
              >
                <span>{atlas.headline.title}</span>
                <small>
                  {openingSavedAtlasId === atlas.id ? "Opening saved atlas…" : atlasStatusLabel(atlas.status)}
                  {openingSavedAtlasId !== atlas.id ? ` · ${Object.keys(atlas.nodes).length + 1} nodes` : ""}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="saved-empty-state">
            <strong>No saved atlases yet.</strong>
            <p>Open a connected event or build a standalone headline atlas. Your recent work will return here.</p>
          </div>
        )}
      </section>

      <section id="headlines" className="headline-panel standalone-headline-panel" aria-labelledby="headline-heading" aria-busy={feedState === "loading"}>
        <div className="step-strip"><span id="headline-heading">Headlines · Standalone exploration</span></div>
        <div className="standalone-explainer">
          <strong>Want to investigate one story on its own?</strong>
          <p>A standalone atlas starts from a single headline. It freezes and checks that story’s facts, but it is not connected to the world view or its cross-event ripples.</p>
        </div>
        {world.refreshing ? (
          <p className="notice world-notice" role="status">The world scan is finishing first. Standalone atlas launches will unlock when it completes.</p>
        ) : null}
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
              <button className="headline-card" key={headline.id} type="button" disabled={selectedHeadlineId !== null || world.refreshing} onClick={() => chooseHeadline(headline)}>
                <span className="headline-card-title">{headline.title}</span>
                <small>{headline.publisher ?? "Google News source"} · {formatDate(headline.publishedAt)}</small>
                <span className="headline-card-action">
                  {selectedHeadlineId === headline.id ? "Opening standalone atlas…" : "Build standalone atlas"}
                  {selectedHeadlineId !== headline.id ? <span aria-hidden="true">→</span> : null}
                </span>
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
