"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ErrorResponseSchema,
  ExpandAtlasRequestSchema,
  ExpandAtlasResponseSchema,
  MAX_ATLAS_CALLS,
  MAX_ATLAS_NODES,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type AtlasGraph,
  type StorageEnvelope,
} from "../lib/contracts";
import {
  WorldEventDetailResponseSchema,
  type RippleAnalysisResponse,
  type RippleEdge,
  type WorldEventSummary,
} from "../lib/world-contracts";
import {
  atlasReducer,
  createAtlasGraph,
  expansionAvailability,
  lineageForNode,
  siblingIdsForNode,
} from "../lib/atlas-reducer";
import {
  ATLAS_STORAGE_KEY,
  clearAtlasStorage,
  loadStorageEnvelope,
  readFixtureGraphIds,
  removeAtlas,
  saveStorageEnvelope,
  setFixtureGraphMode,
  upsertAtlas,
} from "../lib/storage";
import {
  beginRippleCallAttempt,
  deleteAtlasFromBrowser,
  openWorldEvent,
  recoverRippleCallAccounting,
  resolveRippleCallAttempt,
  restartWorldAtlas,
} from "../lib/world-navigation";
import {
  loadWorldStorageEnvelope,
  pruneWorldStorage,
  rippleAnalysisKey,
  saveWorldStorageEnvelope,
  type WorldJourney,
  type WorldStorageEnvelope,
} from "../lib/world-storage";
import { AtlasOutline } from "./atlas-outline";
import { FixtureModeBanner } from "./fixture-banner";
import { MapDialog } from "./map-dialog";
import { NodeCard } from "./node-card";
import { RipplePanel } from "./ripple-panel";
import { WorldContext } from "./world-context";

type ApiFailure = { message: string; callConsumed: boolean; retryable: boolean };

function failureFrom(payload: unknown, fallback: string): ApiFailure {
  const parsed = ErrorResponseSchema.safeParse(payload);
  if (!parsed.success) return { message: fallback, callConsumed: false, retryable: true };
  return {
    message: parsed.data.error.message,
    callConsumed: parsed.data.error.callConsumed,
    retryable: parsed.data.error.retryable,
  };
}

async function readPayload(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function availabilityText(reason: ReturnType<typeof expansionAvailability> extends infer T ? T : never) {
  if (reason.allowed) return "Ready to explore";
  const labels = {
    graph_unavailable: "Graph unavailable",
    already_expanded: "Branches generated",
    generating: "Generating branches",
    leaf: "Early leaf",
    max_depth: "Maximum depth reached",
    call_budget: "16-call limit reached",
    node_budget: "64-node limit reached",
  } as const;
  return labels[reason.reason];
}

function LoadingBranches() {
  return (
    <div className="loading-branches" aria-live="polite" aria-label="Exploring this path">
      <p>Exploring this path…</p>
      {Array.from({ length: 3 }, (_, index) => (
        <div className="node-card node-skeleton" key={index} aria-hidden="true">
          <span />
          <strong />
          <span />
        </div>
      ))}
    </div>
  );
}

function RootSnapshot({ graph }: { graph: AtlasGraph }) {
  const snapshot = graph.snapshot;
  if (!snapshot) return null;
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  return (
    <article className="root-card">
      <div className="root-card-topline">
        <span>Frozen event snapshot</span>
        <span className={`verification-badge verification-${snapshot.verificationStatus}`}>
          {snapshot.verificationStatus === "corroborated" ? "Corroborated" : "Partially verified"}
        </span>
      </div>
      <h2>{snapshot.headline.title}</h2>
      <p className="snapshot-source">
        {snapshot.headline.publisher ?? "Google News source"} · {formatDate(snapshot.headline.publishedAt)} ·{" "}
        <a href={snapshot.headline.googleNewsUrl} target="_blank" rel="noopener noreferrer">Open headline source</a>
      </p>
      <p className="snapshot-summary">{snapshot.summary}</p>
      <details className="snapshot-details">
        <summary>Verified facts and sources</summary>
        <ol className="fact-list">
          {snapshot.facts.map((fact, index) => (
            <li key={`${index}-${fact.text}`}>
              <span>{fact.text}</span>
              <span className="fact-citations" aria-label="Sources">
                {fact.sourceIds.map((sourceId) => {
                  const source = sources.get(sourceId);
                  return source ? (
                    <a key={sourceId} href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
                      {sourceId}
                    </a>
                  ) : null;
                })}
              </span>
            </li>
          ))}
        </ol>
        {snapshot.uncertainties.length > 0 ? (
          <div className="uncertainties">
            <h2>Still uncertain</h2>
            <ul>{snapshot.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        ) : null}
        <div className="source-list">
          <h2>Sources</h2>
          <ul>
            {snapshot.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
                <span>{source.domain}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
      <p className="snapshot-frozen-note">Captured {formatDate(snapshot.capturedAt)}. This atlas will not update automatically.</p>
    </article>
  );
}

export function AtlasView({ graphId }: { graphId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNodeId = searchParams.get("node");
  const envelopeRef = useRef<StorageEnvelope | null>(null);
  const worldEnvelopeRef = useRef<WorldStorageEnvelope | null>(null);
  const graphRef = useRef<AtlasGraph | null>(null);
  const startAttemptedRef = useRef(new Set<string>());
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(false);
  const [busyParentId, setBusyParentId] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [worldEventId, setWorldEventId] = useState<string | null>(null);
  const [worldEventTitle, setWorldEventTitle] = useState<string | null>(null);
  const [worldEvent, setWorldEvent] = useState<WorldEventSummary | null>(null);
  const [worldJourney, setWorldJourney] = useState<WorldJourney | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);

  const persistGraph = useCallback((next: AtlasGraph) => {
    graphRef.current = next;
    setGraph(next);
    const currentEnvelope = envelopeRef.current;
    if (!currentEnvelope) return;
    const nextEnvelope = upsertAtlas(currentEnvelope, next);
    envelopeRef.current = nextEnvelope;
    try {
      const saved = saveStorageEnvelope(window.localStorage, nextEnvelope);
      envelopeRef.current = saved.envelope;
      if (worldEnvelopeRef.current) {
        const prunedWorld = pruneWorldStorage(
          worldEnvelopeRef.current,
          Object.keys(saved.envelope.atlases),
          next.updatedAt,
        );
        worldEnvelopeRef.current = saveWorldStorageEnvelope(window.localStorage, prunedWorld);
      }
      if (saved.prunedAtlasIds.length > 0) {
        setStorageWarning("Older atlases were removed to preserve this active atlas.");
      }
      if (saved.droppedHeadlineCache) {
        setStorageWarning("The cached headline list was removed to preserve this atlas.");
      }
    } catch {
      setStorageWarning("This browser could not persist the latest atlas change.");
    }
  }, []);

  const recordMode = useCallback((mode: "live" | "fixture") => {
    setFixtureMode(mode === "fixture");
    try {
      setFixtureGraphMode(window.localStorage, graphId, mode === "fixture");
    } catch {
      // The banner still remains visible for this session.
    }
  }, [graphId]);

  const runStart = useCallback(async (startingGraph: AtlasGraph) => {
    const envelope = envelopeRef.current;
    if (!envelope || busyParentId) return;
    setBusyParentId("root");
    try {
      const request = StartAtlasRequestSchema.parse({
        installationId: envelope.installationId,
        graphId: startingGraph.id,
        headline: startingGraph.headline,
        worldEventId:
          worldEnvelopeRef.current?.graphAssociations[startingGraph.id]?.eventId,
      });
      const response = await fetch("/api/atlas/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const failure = failureFrom(payload, "The event snapshot could not be created.");
        throw Object.assign(new Error(failure.message), failure);
      }
      const parsed = StartAtlasResponseSchema.parse(payload);
      recordMode(parsed.meta.mode);
      const latest = graphRef.current ?? startingGraph;
      persistGraph(atlasReducer(latest, { type: "start_succeeded", response: parsed, at: new Date().toISOString() }));
    } catch (error) {
      const failure = error as Partial<ApiFailure> & Error;
      const latest = graphRef.current ?? startingGraph;
      try {
        persistGraph(
          atlasReducer(latest, {
            type: "start_failed",
            message: failure.message || "The event snapshot could not be created.",
            callConsumed: failure.callConsumed ?? false,
            at: new Date().toISOString(),
          }),
        );
      } catch {
        setStorageWarning("The start response could not be applied safely.");
      }
    } finally {
      setBusyParentId(null);
    }
  }, [busyParentId, persistGraph, recordMode]);

  useEffect(() => {
    let cancelled = false;
    let recoveryWarning: string | null = null;
    try {
      recoverRippleCallAccounting(window.localStorage);
    } catch {
      recoveryWarning = "A previous ripple call could not be reconciled with browser storage yet.";
    }
    const loaded = loadStorageEnvelope(window.localStorage);
    envelopeRef.current = loaded.envelope;
    const loadedWorld = loadWorldStorageEnvelope(window.localStorage);
    const prunedWorld = pruneWorldStorage(
      loadedWorld.envelope,
      Object.keys(loaded.envelope.atlases),
      new Date().toISOString(),
    );
    worldEnvelopeRef.current = prunedWorld;
    try {
      saveWorldStorageEnvelope(window.localStorage, prunedWorld);
    } catch {
      recoveryWarning = "World in Motion context could not be restored in this browser.";
    }
    const stored = loaded.envelope.atlases[graphId] ?? null;
    let recovered: AtlasGraph | null = stored;
    if (stored) {
      try {
        recovered = atlasReducer(stored, { type: "recover_interrupted", at: new Date().toISOString() });
      } catch {
        recovered = null;
        recoveryWarning = "This saved atlas failed its graph integrity check and was not opened.";
      }
      graphRef.current = recovered;
    } else {
      graphRef.current = null;
    }
    const storedFixtureMode = readFixtureGraphIds(window.localStorage).has(graphId);
    queueMicrotask(() => {
      if (cancelled) return;
      setStorageWarning(recoveryWarning ?? loaded.warning);
      if (stored && recovered && recovered !== stored) persistGraph(recovered);
      else setGraph(recovered);
      setFixtureMode(storedFixtureMode);
      const association = prunedWorld.graphAssociations[graphId];
      setWorldEventId(association?.eventId ?? null);
      setWorldJourney(prunedWorld.journeys[graphId] ?? null);
      setInstallationId(loaded.envelope.installationId);
      setHydrated(true);
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ATLAS_STORAGE_KEY) return;
      const refreshed = loadStorageEnvelope(window.localStorage);
      envelopeRef.current = refreshed.envelope;
      const next = refreshed.envelope.atlases[graphId] ?? null;
      graphRef.current = next;
      setGraph(next);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, [graphId, persistGraph]);

  useEffect(() => {
    if (!worldEventId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setWorldEvent(null);
    });
    void (async () => {
      try {
        const response = await fetch(`/api/world/events/${encodeURIComponent(worldEventId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const parsed = WorldEventDetailResponseSchema.parse(await readPayload(response));
        if (!cancelled) {
          setWorldEvent(parsed.event);
          setWorldEventTitle(parsed.event.canonicalTitle);
        }
      } catch {
        // The frozen atlas remains usable if its catalog context is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [worldEventId]);

  useEffect(() => {
    if (!hydrated || graph?.status !== "verifying" || startAttemptedRef.current.has(graph.id)) return;
    startAttemptedRef.current.add(graph.id);
    void runStart(graph);
  }, [graph, hydrated, runStart]);

  useEffect(() => {
    if (!graph || graph.status !== "ready") return;
    const desired = requestedNodeId && graph.nodes[requestedNodeId] ? requestedNodeId : null;
    if (requestedNodeId && !graph.nodes[requestedNodeId]) {
      router.replace(`/atlas/${graph.id}`, { scroll: false });
      return;
    }
    if (graph.focusedNodeId !== desired) {
      queueMicrotask(() => {
        const latest = graphRef.current;
        if (!latest || latest.focusedNodeId === desired) return;
        persistGraph(atlasReducer(latest, { type: "focus_changed", nodeId: desired }));
      });
    }
  }, [graph, persistGraph, requestedNodeId, router]);

  const navigateToNode = useCallback((nodeId: string | null, replace = false) => {
    const href = nodeId ? `/atlas/${graphId}?node=${encodeURIComponent(nodeId)}` : `/atlas/${graphId}`;
    if (replace) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
  }, [graphId, router]);

  const expandNode = useCallback(async (nodeId: string) => {
    const current = graphRef.current;
    const envelope = envelopeRef.current;
    if (!current || !envelope || busyParentId || !current.snapshot) return;
    const availability = expansionAvailability(current, nodeId);
    if (!availability.allowed) return;

    let generating: AtlasGraph;
    try {
      generating = atlasReducer(current, {
        type: "expansion_requested",
        parentId: nodeId,
        at: new Date().toISOString(),
      });
      persistGraph(generating);
    } catch (error) {
      setStorageWarning(error instanceof Error ? error.message : "This path cannot be expanded.");
      return;
    }

    setBusyParentId(nodeId);
    try {
      const request = ExpandAtlasRequestSchema.parse({
        installationId: envelope.installationId,
        graphId: current.id,
        parentId: nodeId,
        snapshot: current.snapshot,
        lineage: lineageForNode(current, nodeId),
        remainingNodeCapacity: availability.remainingNodeCapacity,
      });
      const response = await fetch("/api/atlas/expand", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const failure = failureFrom(payload, "This path could not be explored.");
        throw Object.assign(new Error(failure.message), failure);
      }
      const parsed = ExpandAtlasResponseSchema.parse(payload);
      recordMode(parsed.meta.mode);
      const latest = graphRef.current ?? generating;
      persistGraph(
        atlasReducer(latest, {
          type: "expansion_succeeded",
          parentId: nodeId,
          response: parsed,
          at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      const failure = error as Partial<ApiFailure> & Error;
      const latest = graphRef.current ?? generating;
      try {
        persistGraph(
          atlasReducer(latest, {
            type: "expansion_failed",
            parentId: nodeId,
            message: failure.message || "This path could not be explored.",
            callConsumed: failure.callConsumed ?? false,
            at: new Date().toISOString(),
          }),
        );
      } catch (reducerError) {
        setStorageWarning(
          reducerError instanceof Error ? reducerError.message : "The failed expansion could not be recorded.",
        );
      }
    } finally {
      setBusyParentId(null);
    }
  }, [busyParentId, persistGraph, recordMode]);

  const activateNode = useCallback((nodeId: string) => {
    const current = graphRef.current;
    if (!current) return;
    navigateToNode(nodeId);
    const worldAssociated = Boolean(
      worldEnvelopeRef.current?.graphAssociations[current.id],
    );
    if (worldAssociated && current.nodes[nodeId]?.depth === 1) return;
    if (expansionAvailability(current, nodeId).allowed) void expandNode(nodeId);
  }, [expandNode, navigateToNode]);

  const retryStart = () => {
    const current = graphRef.current;
    if (!current || busyParentId || current.callsUsed >= MAX_ATLAS_CALLS) return;
    const retrying = atlasReducer(current, { type: "start_requested", at: new Date().toISOString() });
    persistGraph(retrying);
    void runStart(retrying);
  };

  const restartAtlas = () => {
    const current = graphRef.current;
    const envelope = envelopeRef.current;
    if (!current || !envelope || !window.confirm("Restart this atlas? Its generated paths will be deleted from this browser.")) return;
    const now = new Date().toISOString();
    const nextGraphId = crypto.randomUUID();
    let next = createAtlasGraph({ id: nextGraphId, headline: current.headline, now });
    try {
      if (worldEnvelopeRef.current?.graphAssociations[current.id]) {
        if (!worldEvent || worldEvent.id !== worldEventId) {
          setStorageWarning("Restart needs the current World in Motion event. Try again after its context finishes loading.");
          return;
        }
        const restarted = restartWorldAtlas(window.localStorage, {
          previousGraphId: current.id,
          nextGraphId,
          event: worldEvent,
          at: now,
        });
        next = restarted.graph;
        envelopeRef.current = restarted.atlasEnvelope;
        worldEnvelopeRef.current = restarted.worldEnvelope;
      } else {
        let nextEnvelope = removeAtlas(envelope, current.id, now);
        nextEnvelope = upsertAtlas(nextEnvelope, next);
        envelopeRef.current = saveStorageEnvelope(window.localStorage, nextEnvelope).envelope;
      }
    } catch {
      setStorageWarning("Restart could not be saved. The current atlas and its world context were restored.");
      return;
    }
    try { setFixtureGraphMode(window.localStorage, current.id, false); } catch { /* no-op */ }
    router.replace(`/atlas/${next.id}`);
  };

  const deleteAtlas = () => {
    const current = graphRef.current;
    const envelope = envelopeRef.current;
    if (!current || !envelope || !window.confirm("Delete this atlas from this browser? This cannot be undone.")) return;
    const now = new Date().toISOString();
    try {
      const deleted = deleteAtlasFromBrowser(window.localStorage, {
        graphId: current.id,
        at: now,
      });
      envelopeRef.current = deleted.atlasEnvelope;
      worldEnvelopeRef.current = deleted.worldEnvelope;
    } catch {
      setStorageWarning("Delete could not be saved. The atlas and its world context were restored.");
      return;
    }
    try { setFixtureGraphMode(window.localStorage, current.id, false); } catch { /* no-op */ }
    router.replace("/");
  };

  const clearAll = () => {
    if (!window.confirm("Clear every Possibility Atlas saved in this browser? This cannot be undone.")) return;
    clearAtlasStorage(window.localStorage);
    router.replace("/");
  };

  const beginRippleAttempt = useCallback((analysisKey: string) => {
    const current = graphRef.current;
    if (!current) return;
    const now = new Date().toISOString();
    const pending = beginRippleCallAttempt(window.localStorage, {
      graphId: current.id,
      analysisKey,
      at: now,
    });
    envelopeRef.current = pending.atlasEnvelope;
    worldEnvelopeRef.current = pending.worldEnvelope;
  }, []);

  const recordRippleCall = useCallback((
    analysisKey: string,
    callConsumed: boolean,
  ) => {
    const current = graphRef.current;
    if (!current) return;
    const now = new Date().toISOString();
    try {
      const recorded = resolveRippleCallAttempt(window.localStorage, {
        graphId: current.id,
        analysisKey,
        callConsumed,
        at: now,
      });
      envelopeRef.current = recorded.atlasEnvelope;
      worldEnvelopeRef.current = recorded.worldEnvelope;
      graphRef.current = recorded.graph;
      setGraph(recorded.graph);
    } catch {
      const refreshed = loadStorageEnvelope(window.localStorage);
      envelopeRef.current = refreshed.envelope;
      const durable = refreshed.envelope.atlases[current.id];
      if (durable) {
        graphRef.current = durable;
        setGraph(durable);
      }
      setStorageWarning("The model call was recorded, but its browser dedupe marker still needs recovery.");
    }
  }, []);

  const applyRippleResponse = useCallback((
    response: RippleAnalysisResponse,
    scenarioNodeId: string,
    attemptId: string,
  ) => {
    recordMode(response.meta.mode);
    const current = graphRef.current;
    if (!current) return;
    recordRippleCall(
      `${rippleAnalysisKey(current.id, scenarioNodeId)}:${attemptId}`,
      response.meta.callConsumed,
    );
  }, [recordMode, recordRippleCall]);

  const openRippleTarget = useCallback((
    event: WorldEventSummary,
    edge: RippleEdge,
    scenarioNodeId: string,
  ) => {
    const current = graphRef.current;
    const scenario = current?.nodes[scenarioNodeId];
    const sourceEventId =
      current && worldEnvelopeRef.current?.graphAssociations[current.id]?.eventId;
    if (!current || !scenario || !sourceEventId) return;
    try {
      const opened = openWorldEvent(window.localStorage, event, {
        sourceGraphId: current.id,
        transition: {
          sourceEventId,
          sourceEventTitle: worldEventTitle ?? current.headline.title,
          sourceScenarioNodeId: scenario.id,
          sourceScenarioTitle: scenario.title,
          targetEventId: event.id,
          targetEventTitle: event.canonicalTitle,
          influence: edge.influence,
        },
      });
      router.push(opened.href);
    } catch {
      setStorageWarning("This browser could not save the conditional event journey.");
    }
  }, [router, worldEventTitle]);

  const focusedNode = graph?.focusedNodeId ? graph.nodes[graph.focusedNodeId] : null;
  const focusedLineage = useMemo(
    () => (graph && focusedNode ? lineageForNode(graph, focusedNode.id) : []),
    [focusedNode, graph],
  );
  const childIds = graph ? (focusedNode ? focusedNode.childIds : graph.rootChildIds) : [];
  const siblingIds = graph && focusedNode ? siblingIdsForNode(graph, focusedNode.id) : [];
  const anyGenerating = Boolean(busyParentId || (graph && Object.values(graph.nodes).some((node) => node.status === "generating")));
  const focusedWorldScenario = worldEventId && focusedNode?.depth === 1 ? focusedNode : null;

  if (!hydrated) {
    return <main className="atlas-shell"><div className="route-loading"><div className="spinner" /><p>Opening your saved atlas…</p></div></main>;
  }

  if (!graph) {
    return (
      <main className="atlas-shell">
        <section className="empty-state route-empty">
          <p className="eyebrow">Saved only in this browser</p>
          <h1>This atlas is not available here.</h1>
          <p>It may have been created in another browser, deleted, or removed when local storage was cleared.</p>
          <Link className="primary-button" href="/">Choose a headline</Link>
        </section>
      </main>
    );
  }

  if (graph.status === "verifying") {
    return (
      <main className="atlas-shell">
        <header className="atlas-topbar"><Link href={worldEventId ? "/world" : "/"} className="back-link">← {worldEventId ? "World" : "Headlines"}</Link></header>
        {fixtureMode ? <FixtureModeBanner /> : null}
        <section className="verifying-card" aria-live="polite">
          <p className="eyebrow">Freezing cited event snapshot</p>
          <h1>{graph.headline.title}</h1>
          <div className="verification-progress"><div className="spinner" /><span>Verifying the event and creating the first possible paths…</span></div>
          <p>The selected headline is becoming the fixed root of this atlas.</p>
        </section>
      </main>
    );
  }

  if (graph.status === "error") {
    const callBudgetExhausted = graph.callsUsed >= MAX_ATLAS_CALLS;
    return (
      <main className="atlas-shell">
        <header className="atlas-topbar"><Link href={worldEventId ? "/world" : "/"} className="back-link">← {worldEventId ? "World" : "Headlines"}</Link></header>
        <section className="empty-state route-empty">
          <p className="eyebrow">Atlas interrupted</p>
          <h1>The event snapshot could not be created.</h1>
          <p role="alert">{graph.errorMessage}</p>
          {callBudgetExhausted ? (
            <p>This atlas reached its 16-call analysis limit. Restart it or choose another headline.</p>
          ) : null}
          <div className="button-row">
            <button type="button" className="primary-button" onClick={retryStart} disabled={Boolean(busyParentId) || callBudgetExhausted}>
              {callBudgetExhausted ? "Call limit reached" : "Try again"}
            </button>
            <button type="button" className="secondary-button" onClick={deleteAtlas}>Delete atlas</button>
          </div>
        </section>
      </main>
    );
  }

  if (graph.status === "insufficient_evidence") {
    return (
      <main className="atlas-shell">
        <header className="atlas-topbar"><Link href={worldEventId ? "/world" : "/"} className="back-link">← {worldEventId ? "World" : "Headlines"}</Link></header>
        {fixtureMode ? <FixtureModeBanner /> : null}
        <section className="empty-state route-empty">
          <p className="eyebrow">Evidence boundary</p>
          <h1>There is not enough corroborated information for a useful atlas.</h1>
          {graph.insufficientSummary ? <p>{graph.insufficientSummary}</p> : null}
          <p>{graph.insufficientReason}</p>
          {graph.insufficientSources.length > 0 ? (
            <div className="insufficient-sources">
              <h2>Sources consulted</h2>
              <ul>
                {graph.insufficientSources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                    <span>{source.domain}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="button-row">
            <Link className="primary-button" href="/">Choose another headline</Link>
            <button type="button" className="secondary-button" onClick={deleteAtlas}>Delete atlas</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="atlas-shell">
      {fixtureMode ? <FixtureModeBanner /> : null}
      <header className="atlas-topbar">
        <Link href={worldEventId ? "/world" : "/"} className="back-link">← {worldEventId ? "World" : "Headlines"}</Link>
        <div className="atlas-actions">
          <button type="button" className="secondary-button map-button" onClick={() => setMapOpen(true)}>Map</button>
          <details className="atlas-menu">
            <summary className="icon-button" aria-label="Atlas options">•••</summary>
            <div className="menu-popover">
              <button type="button" onClick={restartAtlas}>Restart this atlas</button>
              <button type="button" onClick={deleteAtlas}>Delete this atlas</button>
              <button type="button" className="danger-action" onClick={clearAll}>Clear all browser data</button>
            </div>
          </details>
        </div>
      </header>

      {storageWarning ? <p className="notice warning-notice" role="status">{storageWarning}</p> : null}

      {worldEventId ? (
        <WorldContext
          eventTitle={worldEventTitle ?? graph.headline.title}
          journey={worldJourney}
        />
      ) : null}

      <section className="atlas-heading" aria-labelledby="atlas-title">
        <div>
          <p className="eyebrow">Possibility Atlas</p>
          <h1 id="atlas-title">Explore the paths around this event.</h1>
        </div>
        <div className="atlas-counters" aria-label="Atlas limits">
          <span>{MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1} node slots left</span>
          <span>{MAX_ATLAS_CALLS - graph.callsUsed} calls left</span>
          <span>Saved only in this browser</span>
        </div>
      </section>

      <nav className="path-breadcrumbs" aria-label="Focused path">
        <button type="button" onClick={() => navigateToNode(null)} aria-current={!focusedNode ? "page" : undefined}>Headline</button>
        {focusedLineage.map((item) => (
          <span key={item.id}>
            <span aria-hidden="true">›</span>
            <button type="button" onClick={() => navigateToNode(item.id)} aria-current={focusedNode?.id === item.id ? "page" : undefined}>{item.title}</button>
          </span>
        ))}
      </nav>

      <div className="atlas-layout">
        <aside className="outline-sidebar">
          <div className="sidebar-heading"><p className="eyebrow">Atlas outline</p><span>{Object.keys(graph.nodes).length + 1} nodes</span></div>
          <AtlasOutline graph={graph} onSelect={(nodeId) => nodeId ? activateNode(nodeId) : navigateToNode(null)} />
        </aside>

        <section className="focused-tree" aria-label="Focused possibility tree">
          {!focusedNode ? <RootSnapshot graph={graph} /> : (
            <NodeCard
              node={focusedNode}
              current
              availability={expansionAvailability(graph, focusedNode.id)}
              onActivate={() => void expandNode(focusedNode.id)}
              onRetry={() => void expandNode(focusedNode.id)}
              interactionDisabled={Boolean(busyParentId && busyParentId !== focusedNode.id)}
              hideAction={Boolean(focusedWorldScenario)}
            />
          )}

          {focusedWorldScenario && installationId && worldEventId ? (
            <RipplePanel
              installationId={installationId}
              graphId={graph.id}
              worldEventId={worldEventId}
              scenario={focusedWorldScenario}
              generationDisabled={anyGenerating || graph.callsUsed >= MAX_ATLAS_CALLS}
              deeperDisabled={!expansionAvailability(graph, focusedWorldScenario.id).allowed || anyGenerating}
              deeperLabel={
                expansionAvailability(graph, focusedWorldScenario.id).allowed
                  ? "Explore deeper"
                  : availabilityText(expansionAvailability(graph, focusedWorldScenario.id))
              }
              onExploreDeeper={() => void expandNode(focusedWorldScenario.id)}
              onAttemptStarted={(attemptId) => {
                beginRippleAttempt(
                  `${rippleAnalysisKey(graph.id, focusedWorldScenario.id)}:${attemptId}`,
                );
              }}
              onResponseApplied={(response, attemptId) =>
                applyRippleResponse(
                  response,
                  focusedWorldScenario.id,
                  attemptId,
                )
              }
              onFailureApplied={(callConsumed, attemptId) => {
                recordRippleCall(
                  `${rippleAnalysisKey(graph.id, focusedWorldScenario.id)}:${attemptId}`,
                  callConsumed,
                );
              }}
              onOpenTarget={(event, edge) => openRippleTarget(event, edge, focusedWorldScenario.id)}
            />
          ) : null}

          {siblingIds.length > 0 ? (
            <div className="change-path">
              <p>Change path</p>
              <div className="sibling-scroller">
                {siblingIds.map((id) => (
                  <button key={id} type="button" onClick={() => activateNode(id)} disabled={anyGenerating}>{graph.nodes[id]?.title}</button>
                ))}
              </div>
            </div>
          ) : null}

          {focusedNode?.status === "generating" || busyParentId === "root" ? <LoadingBranches /> : null}

          {childIds.length > 0 ? (
            <section className="children-section" aria-labelledby="branches-heading">
              <div className="section-heading-row branch-heading">
                <div>
                  <p className="eyebrow">Next level</p>
                  <h2 id="branches-heading">{childIds.length} possible {childIds.length === 1 ? "path" : "paths"}</h2>
                </div>
                {focusedNode ? <span>Depth {focusedNode.depth + 1} of 5</span> : <span>Depth 1 of 5</span>}
              </div>
              <ol className="children-list">
                {childIds.map((childId) => {
                  const child = graph.nodes[childId];
                  if (!child) return null;
                  const availability = expansionAvailability(graph, child.id);
                  return (
                    <li key={child.id} className="branch-item">
                      <NodeCard
                        node={child}
                        availability={availability}
                        onActivate={() => activateNode(child.id)}
                        onRetry={() => activateNode(child.id)}
                        interactionDisabled={anyGenerating}
                        actionLabel={worldEventId && child.depth === 1 ? "Consider this scenario" : undefined}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : focusedNode && focusedNode.status !== "generating" && !focusedWorldScenario ? (
            <div className="path-end" role="status">
              <strong>{availabilityText(expansionAvailability(graph, focusedNode.id))}</strong>
              <p>{focusedNode.status === "leaf" ? "This path ends here based on the available evidence." : "Return to an earlier point to compare another possibility."}</p>
              <button type="button" className="secondary-button" onClick={() => navigateToNode(focusedNode.parentId === graph.id ? null : focusedNode.parentId)}>Back one level</button>
            </div>
          ) : null}

          <p className="possibility-disclaimer">These paths are speculative possibilities grounded in the frozen sources above. They are not predictions or professional advice.</p>
        </section>
      </div>

      <MapDialog graph={graph} open={mapOpen} onClose={() => setMapOpen(false)} onSelect={(nodeId) => nodeId ? activateNode(nodeId) : navigateToNode(null)} />
    </main>
  );
}
