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
  RegisterAtlasRequestSchema,
  RegisterAtlasResponseSchema,
  StartAtlasRequestSchema,
  StartAtlasResponseSchema,
  type AtlasGraph,
  type StorageEnvelope,
} from "../lib/contracts";
import {
  WorldEventDetailResponseSchema,
  type RippleAnalysisResponse,
  type RippleEdge,
  type WorldEventHeadline,
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
  causalContextForJourney,
  isStaleCausalRegistrationError,
  loadWorldStorageEnvelope,
  pruneWorldStorage,
  rippleAnalysisKey,
  saveWorldStorageEnvelope,
  setWorldJourneyExplorationMode,
  shouldResumeWorldAtlasIndependently,
  type WorldJourney,
  type WorldJourneyExplorationMode,
  type WorldStorageEnvelope,
} from "../lib/world-storage";
import { AtlasOutline } from "./atlas-outline";
import { FixtureModeBanner } from "./fixture-banner";
import { MapDialog } from "./map-dialog";
import { NodeCard } from "./node-card";
import { RipplePanel } from "./ripple-panel";
import { WorldContext } from "./world-context";

type ApiFailure = {
  code: string | null;
  message: string;
  callConsumed: boolean;
  retryable: boolean;
};

function failureFrom(payload: unknown, fallback: string): ApiFailure {
  const parsed = ErrorResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return { code: null, message: fallback, callConsumed: false, retryable: false };
  }
  return {
    code: parsed.data.error.code,
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
    leaf: "End of path",
    max_depth: "Maximum level reached",
    node_budget: "64-node limit reached",
  } as const;
  return labels[reason.reason];
}

function shortenedTitle(value: string, maxLength = 42) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function errorIsRetryable(value: unknown) {
  if (!value || typeof value !== "object" || !("errorRetryable" in value)) return true;
  return value.errorRetryable !== false;
}

function LoadingReassurance({ kind }: { kind: "start" | "expansion" }) {
  const [message, setMessage] = useState(
    kind === "start"
      ? "Building a cited snapshot and possible paths…"
      : "Exploring what could follow from this possibility…",
  );

  useEffect(() => {
    const patientTimer = window.setTimeout(() => {
      setMessage("Still working—careful analysis can take 15–30 seconds.");
    }, 8_000);
    const longTimer = window.setTimeout(() => {
      setMessage("Still working on the same request. Thanks for waiting.");
    }, 20_000);
    return () => {
      window.clearTimeout(patientTimer);
      window.clearTimeout(longTimer);
    };
  }, []);

  return <span>{message}</span>;
}

function LoadingBranches() {
  return (
    <div className="loading-branches" aria-live="polite" aria-label="Exploring this path">
      <p><LoadingReassurance kind="expansion" /></p>
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

function RootSnapshot({
  graph,
  eventTitle,
  reporting,
}: {
  graph: AtlasGraph;
  eventTitle: string;
  reporting: WorldEventHeadline[];
}) {
  const snapshot = graph.snapshot;
  if (!snapshot) return null;
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const leadReporting = reporting.filter((item) => item.role === "root");
  const supportingReporting = reporting.filter((item) => item.role === "supporting");
  const reportingGroups = [
    { label: "Lead reporting", items: leadReporting },
    { label: "Supporting reporting", items: supportingReporting },
  ].filter((group) => group.items.length > 0);
  return (
    <article className="root-card compact-root-card" aria-label={`Frozen event evidence for ${eventTitle}`}>
      <div className="root-card-topline">
        <span>Frozen event evidence</span>
        <span className={`verification-badge verification-${snapshot.verificationStatus}`}>
          {snapshot.verificationStatus === "corroborated" ? "Corroborated" : "Partially checked"}
        </span>
      </div>
      <p className="snapshot-summary">{snapshot.summary}</p>
      <div className="root-evidence-row" aria-label="Evidence summary">
        <span>{snapshot.facts.length} cited {snapshot.facts.length === 1 ? "fact" : "facts"}</span>
        <span>{snapshot.sources.length} {snapshot.sources.length === 1 ? "source" : "sources"}</span>
        {reporting.length > 0 ? <span>{reporting.length} grouped {reporting.length === 1 ? "report" : "reports"}</span> : null}
        <span>Captured {formatDate(snapshot.capturedAt)}</span>
      </div>
      <details className="snapshot-details evidence-disclosure">
        <summary>Open facts, uncertainties, reporting, and sources</summary>
        <div className="snapshot-lead-report">
          <h2>Lead headline</h2>
          <p>{snapshot.headline.title}</p>
          <p className="snapshot-source">
            {snapshot.headline.publisher ?? "Google News source"} · {formatDate(snapshot.headline.publishedAt)} ·{" "}
            <a href={snapshot.headline.googleNewsUrl} target="_blank" rel="noopener noreferrer">Open headline source</a>
          </p>
        </div>
        <h2>Cited facts</h2>
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
        {reportingGroups.length > 0 ? (
          <div className="event-reporting-groups reporting-headline-groups">
            <h2>Reporting grouped with this event</h2>
            {reportingGroups.map((group) => (
              <section key={group.label} aria-labelledby={`reporting-${group.label.toLowerCase().replaceAll(" ", "-")}`}>
                <h3 id={`reporting-${group.label.toLowerCase().replaceAll(" ", "-")}`}>{group.label}</h3>
                <ul>
                  {group.items.map(({ headline }) => (
                    <li key={headline.id}>
                      <a href={headline.googleNewsUrl} target="_blank" rel="noopener noreferrer">{headline.title}</a>
                      <span>{headline.publisher ?? "Publisher unavailable"} · {formatDate(headline.publishedAt)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
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
      <p className="snapshot-frozen-note">This evidence snapshot will not update automatically.</p>
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
  const registrationInFlightRef = useRef(false);
  const [graph, setGraph] = useState<AtlasGraph | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [fixtureMode, setFixtureMode] = useState(false);
  const [busyParentId, setBusyParentId] = useState<string | null>(null);
  const [rippleGenerating, setRippleGenerating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [worldEventId, setWorldEventId] = useState<string | null>(null);
  const [worldEventTitle, setWorldEventTitle] = useState<string | null>(null);
  const [worldEvent, setWorldEvent] = useState<WorldEventSummary | null>(null);
  const [worldEventHeadlines, setWorldEventHeadlines] = useState<WorldEventHeadline[]>([]);
  const [worldJourney, setWorldJourney] = useState<WorldJourney | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<
    "idle" | "registering" | "ready" | "failed"
  >("idle");
  const [registrationWarning, setRegistrationWarning] = useState<string | null>(null);
  const [registrationRetryable, setRegistrationRetryable] = useState(true);
  const [registrationFailureCode, setRegistrationFailureCode] = useState<string | null>(null);

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

  const registerGraphSession = useCallback(async () => {
    const current = graphRef.current;
    const envelope = envelopeRef.current;
    if (!current || !envelope || registrationInFlightRef.current) return;
    const association = worldEnvelopeRef.current?.graphAssociations[current.id];
    const savedCausalContext = association
      ? causalContextForJourney(
          worldEnvelopeRef.current?.journeys[current.id] ?? null,
          association.eventId,
        )
      : null;
    if (association && association.eventRevision === undefined) {
      setRegistrationStatus("failed");
      setRegistrationRetryable(false);
      setRegistrationFailureCode(null);
      setRegistrationWarning("This saved event needs fresh catalog context before generation can resume.");
      return;
    }

    registrationInFlightRef.current = true;
    setRegistrationStatus("registering");
    setRegistrationWarning(null);
    setRegistrationFailureCode(null);
    try {
      const request = RegisterAtlasRequestSchema.parse({
        installationId: envelope.installationId,
        expectedMode: readFixtureGraphIds(window.localStorage).has(current.id)
          ? "fixture"
          : "live",
        graph: current,
        ...(association
          ? {
              worldAssociation: {
                eventId: association.eventId,
                eventRevision: association.eventRevision,
              },
            }
          : {}),
        ...(savedCausalContext
          ? { causalContext: savedCausalContext }
          : {}),
      });
      const response = await fetch("/api/atlas/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const failure = failureFrom(payload, "This saved atlas could not resume generation yet.");
        throw Object.assign(new Error(failure.message), failure);
      }
      const parsed = RegisterAtlasResponseSchema.parse(payload);
      if (parsed.graphId !== current.id) {
        throw new Error("The resumed generation session belongs to another atlas.");
      }
      const latest = graphRef.current ?? current;
      const reconciled = atlasReducer(latest, {
        type: "calls_reconciled",
        callsUsed: parsed.callsUsed,
        at: new Date().toISOString(),
      });
      if (reconciled !== latest) persistGraph(reconciled);
      setRegistrationStatus("ready");
      setRegistrationRetryable(true);
      setRegistrationFailureCode(null);
    } catch (error) {
      const failure = error as Partial<ApiFailure> & Error;
      const failureCode = failure.code ?? null;
      setRegistrationStatus("failed");
      setRegistrationRetryable(failure.retryable ?? true);
      setRegistrationFailureCode(failureCode);
      setRegistrationWarning(
        isStaleCausalRegistrationError(failureCode)
          ? "This saved causal connection is no longer current. Resume this same atlas by exploring the affected event independently."
          : failure instanceof Error
          ? `${failure.message}${
              failure.retryable === false
                ? association
                  ? " Choose an event from the current world snapshot to continue."
                  : " Restart this atlas to generate in the current mode."
                : ""
            }`
          : "This saved atlas could not resume generation yet.",
      );
    } finally {
      registrationInFlightRef.current = false;
    }
  }, [persistGraph]);

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
      setRegistrationStatus("ready");
      setRegistrationWarning(null);
      setRegistrationRetryable(true);
      setRegistrationFailureCode(null);
    } catch (error) {
      const failure = error as Partial<ApiFailure> & Error;
      const latest = graphRef.current ?? startingGraph;
      try {
        persistGraph(
          atlasReducer(latest, {
            type: "start_failed",
            message: failure.message || "The event snapshot could not be created.",
            callConsumed: failure.callConsumed ?? false,
            retryable: failure.retryable ?? true,
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
      setWorldEventTitle(association?.canonicalTitle ?? null);
      setWorldJourney(prunedWorld.journeys[graphId] ?? null);
      setInstallationId(loaded.envelope.installationId);
      setRegistrationStatus("idle");
      setRegistrationWarning(null);
      setRegistrationRetryable(true);
      setRegistrationFailureCode(null);
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
    if (!hydrated) return;
    const current = graphRef.current;
    if (!current) return;
    if (current.status !== "ready") {
      queueMicrotask(() => setRegistrationStatus("ready"));
      return;
    }
    void registerGraphSession();
  }, [graphId, hydrated, registerGraphSession]);

  useEffect(() => {
    if (!worldEventId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setWorldEvent(null);
        setWorldEventHeadlines([]);
      }
    });
    void (async () => {
      try {
        const response = await fetch(`/api/world/events/${encodeURIComponent(worldEventId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const parsed = WorldEventDetailResponseSchema.parse(await readPayload(response));
        if (!cancelled) {
          const association = worldEnvelopeRef.current?.graphAssociations[graphId];
          if (
            association?.eventRevision !== undefined &&
            parsed.event.revision !== association.eventRevision
          ) {
            setStorageWarning("This world event has newer reporting. The saved atlas remains frozen; open the current event from World to update it.");
            return;
          }
          setWorldEvent(parsed.event);
          setWorldEventTitle(parsed.event.canonicalTitle);
          setWorldEventHeadlines(parsed.headlines);
        }
      } catch {
        // The frozen atlas remains usable if its catalog context is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphId, worldEventId]);

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
    if (
      !current ||
      !envelope ||
      busyParentId ||
      rippleGenerating ||
      registrationStatus !== "ready" ||
      !current.snapshot
    ) return;
    const availability = expansionAvailability(current, nodeId);
    if (!availability.allowed) return;
    const parentNode = current.nodes[nodeId];
    if (parentNode?.status === "error" && !errorIsRetryable(parentNode)) {
      setStorageWarning("This path cannot be retried. Choose another path or restart the atlas.");
      return;
    }
    const associatedEventId =
      worldEnvelopeRef.current?.graphAssociations[current.id]?.eventId ?? null;
    const activeJourney = worldEnvelopeRef.current?.journeys[current.id] ?? null;
    if (activeJourney?.transitions.length && !activeJourney.explorationMode) {
      setStorageWarning("Choose whether to continue the causal chain or explore this event independently first.");
      return;
    }
    const causalContext = associatedEventId
      ? causalContextForJourney(activeJourney, associatedEventId)
      : null;
    if (activeJourney?.explorationMode === "causal" && !causalContext) {
      setStorageWarning("This saved causal link is incomplete. Choose independent exploration to continue safely.");
      return;
    }

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
        ...(causalContext ? { causalContext } : {}),
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
            retryable: failure.retryable ?? true,
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
  }, [busyParentId, persistGraph, recordMode, registrationStatus, rippleGenerating]);

  const activateNode = useCallback((nodeId: string) => {
    const current = graphRef.current;
    if (!current || rippleGenerating) return;
    navigateToNode(nodeId);
    const worldAssociated = Boolean(
      worldEnvelopeRef.current?.graphAssociations[current.id],
    );
    if (worldAssociated && current.nodes[nodeId]?.depth === 1) return;
    if (expansionAvailability(current, nodeId).allowed) void expandNode(nodeId);
  }, [expandNode, navigateToNode, rippleGenerating]);

  const chooseExplorationMode = useCallback((mode: WorldJourneyExplorationMode) => {
    const current = graphRef.current;
    const worldEnvelope = worldEnvelopeRef.current;
    if (!current || !worldEnvelope) return;
    const now = new Date().toISOString();
    const previousMode = worldEnvelope.journeys[current.id]?.explorationMode ?? null;
    const resumeIndependently = shouldResumeWorldAtlasIndependently({
      previousMode,
      nextMode: mode,
      registrationFailed: registrationStatus === "failed",
      failureCode: registrationFailureCode,
    });
    try {
      const next = setWorldJourneyExplorationMode(
        worldEnvelope,
        current.id,
        mode,
        now,
      );
      worldEnvelopeRef.current = saveWorldStorageEnvelope(window.localStorage, next);
      setWorldJourney(next.journeys[current.id] ?? null);
      setStorageWarning(null);
      if (resumeIndependently) {
        registrationInFlightRef.current = false;
        setRegistrationStatus("idle");
        setRegistrationWarning("Resuming this saved atlas without the outdated causal connection…");
        setRegistrationRetryable(true);
        setRegistrationFailureCode(null);
        void registerGraphSession();
      }
    } catch {
      setStorageWarning("This browser could not save how you want to explore the affected event.");
    }
  }, [registerGraphSession, registrationFailureCode, registrationStatus]);

  const retryStart = () => {
    const current = graphRef.current;
    if (!current || busyParentId) return;
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
          sourceEventTitle: shortenedTitle(worldEventTitle ?? current.headline.title, 180),
          sourceGraphId: current.id,
          sourceScenarioNodeId: scenario.id,
          sourceScenarioTitle: scenario.title,
          sourceScenarioSummary: scenario.summary,
          targetEventId: event.id,
          targetEventTitle: event.canonicalTitle,
          influence: edge.influence,
          mechanism: edge.mechanism,
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
  const anyGenerating = Boolean(
    busyParentId ||
    rippleGenerating ||
    (graph && Object.values(graph.nodes).some((node) => node.status === "generating")),
  );
  const focusedWorldScenario = worldEventId && focusedNode?.depth === 1 ? focusedNode : null;
  const focusedNodeAvailability =
    graph && focusedNode ? expansionAvailability(graph, focusedNode.id) : null;
  const focusedNodeCanRetry = Boolean(
    focusedNode?.status === "error" &&
    errorIsRetryable(focusedNode) &&
    focusedNodeAvailability?.allowed,
  );
  const focusedNodeActionGenerates =
    focusedNode?.status !== "error" || focusedNodeCanRetry;
  const resolvedEventTitle = worldEventTitle ?? graph?.headline.title ?? "Possibility Atlas";
  const latestJourneyTransition = worldJourney?.transitions.at(-1) ?? null;
  const canContinueCausally = Boolean(
    worldEventId &&
    latestJourneyTransition?.targetEventId === worldEventId &&
    latestJourneyTransition.sourceGraphId &&
    latestJourneyTransition.sourceScenarioSummary &&
    latestJourneyTransition.mechanism,
  );
  const explorationMode = worldJourney?.explorationMode ?? null;
  const staleCausalRegistration = isStaleCausalRegistrationError(registrationFailureCode);
  const explorationChoicePending = Boolean(latestJourneyTransition && !explorationMode);
  const generationSessionReady = registrationStatus === "ready";
  const focusedScenarioAvailability =
    graph && focusedWorldScenario
      ? expansionAvailability(graph, focusedWorldScenario.id)
      : null;
  const focusedScenarioDeeperLabel = explorationChoicePending
    ? "Choose an exploration mode above"
    : !generationSessionReady
      ? "Restoring generation…"
      : focusedWorldScenario?.status === "error" &&
          (!errorIsRetryable(focusedWorldScenario) || !focusedScenarioAvailability?.allowed)
        ? "Choose another scenario"
        : focusedWorldScenario?.status === "error"
          ? "Retry deeper exploration"
        : focusedScenarioAvailability?.allowed
          ? "Explore deeper"
          : focusedScenarioAvailability
            ? availabilityText(focusedScenarioAvailability)
            : "Explore deeper";

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
          <h1>{resolvedEventTitle}</h1>
          <div className="verification-progress"><div className="spinner" /><LoadingReassurance kind="start" /></div>
          <p>The selected headline is becoming the fixed root of this atlas.</p>
        </section>
      </main>
    );
  }

  if (graph.status === "error") {
    const callBudgetExhausted = graph.callsUsed >= MAX_ATLAS_CALLS;
    const retryable = errorIsRetryable(graph);
    return (
      <main className="atlas-shell">
        <header className="atlas-topbar"><Link href={worldEventId ? "/world" : "/"} className="back-link">← {worldEventId ? "World" : "Headlines"}</Link></header>
        <section className="empty-state route-empty">
          <p className="eyebrow">Atlas interrupted</p>
          <h1>The event snapshot could not be created.</h1>
          <p role="alert">{graph.errorMessage}</p>
          {storageWarning ? <p className="notice warning-notice" role="status">{storageWarning}</p> : null}
          {callBudgetExhausted ? (
            <p>This atlas reached its {MAX_ATLAS_CALLS}-call analysis limit. A retry can still restore a saved result; the server will reject any request that would need another call.</p>
          ) : null}
          <div className="button-row">
            {retryable ? (
              <button type="button" className="primary-button" onClick={retryStart} disabled={Boolean(busyParentId)}>
                Retry
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={restartAtlas}>Restart atlas</button>
            )}
            <Link className="secondary-button" href={worldEventId ? "/world" : "/"}>Choose another event</Link>
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
          <h1>We couldn’t build a trustworthy possibility outline from the returned evidence.</h1>
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
            <Link className="primary-button" href={worldEventId ? "/world" : "/"}>
              {worldEventId ? "Back to World" : "Choose another headline"}
            </Link>
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
          <button type="button" className="secondary-button map-button outline-button" onClick={() => setMapOpen(true)}>Outline</button>
          <details className="atlas-menu">
            <summary className="icon-button" aria-label="Atlas options">•••</summary>
            <div className="menu-popover">
              <div className="atlas-menu-limits" aria-label="Atlas limits">
                <span>{MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1} node slots left</span>
                <span>{MAX_ATLAS_CALLS - graph.callsUsed} calls left</span>
              </div>
              <button type="button" onClick={restartAtlas}>Restart this atlas</button>
              <button type="button" onClick={deleteAtlas}>Delete this atlas</button>
              <button type="button" className="danger-action" onClick={clearAll}>Clear all browser data</button>
            </div>
          </details>
        </div>
      </header>

      {storageWarning ? <p className="notice warning-notice" role="status">{storageWarning}</p> : null}

      {registrationStatus === "registering" ? (
        <p className="notice session-registration-notice" role="status">
          Restoring generation for this saved atlas… Reading and navigation remain available.
        </p>
      ) : null}
      {registrationWarning ? (
        <div className="notice warning-notice session-registration-warning" role="status">
          <span>{registrationWarning}</span>
          {staleCausalRegistration ? (
            <button type="button" className="text-button" onClick={() => chooseExplorationMode("independent")}>
              Resume independently
            </button>
          ) : registrationRetryable ? (
            <button type="button" className="text-button" disabled={registrationStatus === "registering"} onClick={() => void registerGraphSession()}>
              Retry resume
            </button>
          ) : worldEventId ? (
            <Link href="/world" className="text-button">Choose current event</Link>
          ) : (
            <button type="button" className="text-button" onClick={restartAtlas}>Restart atlas</button>
          )}
        </div>
      ) : null}

      {worldEventId ? (
        <WorldContext
          eventTitle={worldEventTitle ?? graph.headline.title}
          journey={worldJourney}
          explorationMode={explorationMode}
          canContinueCausally={canContinueCausally}
          onContinueCausally={() => chooseExplorationMode("causal")}
          onExploreIndependently={() => chooseExplorationMode("independent")}
        />
      ) : null}

      <section className="atlas-heading" aria-labelledby="atlas-title">
        <div>
          <p className="eyebrow">Possibility Atlas</p>
          <h1 id="atlas-title">{resolvedEventTitle}</h1>
        </div>
        <div className="atlas-counters" aria-label="Atlas limits">
          {MAX_ATLAS_CALLS - graph.callsUsed <= 2 ? <span>{MAX_ATLAS_CALLS - graph.callsUsed} calls left</span> : null}
          {MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1 <= 6 ? <span>{MAX_ATLAS_NODES - Object.keys(graph.nodes).length - 1} node slots left</span> : null}
          <span>Saved only in this browser</span>
        </div>
      </section>

      {focusedNode ? (
        <nav className="path-breadcrumbs scroll-affordance-x" aria-label="Focused path">
          <button type="button" onClick={() => navigateToNode(null)}>{shortenedTitle(resolvedEventTitle)}</button>
          {focusedLineage.map((item) => (
            <span key={item.id}>
              <span aria-hidden="true">›</span>
              <button type="button" onClick={() => navigateToNode(item.id)} aria-current={focusedNode.id === item.id ? "page" : undefined}>{item.title}</button>
            </span>
          ))}
        </nav>
      ) : null}

      <div className="atlas-layout">
        <aside className="outline-sidebar">
          <div className="sidebar-heading"><p className="eyebrow">Atlas outline</p><span>{Object.keys(graph.nodes).length + 1} nodes</span></div>
          <AtlasOutline graph={graph} rootTitle={resolvedEventTitle} onSelect={(nodeId) => nodeId ? activateNode(nodeId) : navigateToNode(null)} />
        </aside>

        <section className="focused-tree" aria-label="Focused possibility tree">
          {!focusedNode ? <RootSnapshot graph={graph} eventTitle={resolvedEventTitle} reporting={worldEventHeadlines} /> : (
            <NodeCard
              node={focusedNode}
              current
              availability={focusedNodeAvailability ?? expansionAvailability(graph, focusedNode.id)}
              onActivate={() => void expandNode(focusedNode.id)}
              onRetry={() => void expandNode(focusedNode.id)}
              interactionDisabled={Boolean(
                (busyParentId && busyParentId !== focusedNode.id) ||
                rippleGenerating ||
                (focusedNodeActionGenerates &&
                  (!generationSessionReady || explorationChoicePending))
              )}
              hideAction={Boolean(
                focusedWorldScenario &&
                !(
                  focusedWorldScenario.status === "error" &&
                  (!errorIsRetryable(focusedWorldScenario) || !focusedScenarioAvailability?.allowed)
                )
              )}
              errorRetryable={
                focusedNodeCanRetry
              }
              onChooseAnother={() => navigateToNode(focusedNode.parentId === graph.id ? null : focusedNode.parentId)}
              scenarioFocus={Boolean(focusedWorldScenario)}
            />
          )}

          {focusedWorldScenario && installationId && worldEventId && generationSessionReady ? (
            <RipplePanel
              installationId={installationId}
              graphId={graph.id}
              worldEventId={worldEventId}
              scenario={focusedWorldScenario}
              generationDisabled={anyGenerating || !generationSessionReady || explorationChoicePending}
              deeperDisabled={
                !focusedScenarioAvailability?.allowed ||
                (focusedWorldScenario.status === "error" &&
                  (!errorIsRetryable(focusedWorldScenario) || !focusedScenarioAvailability?.allowed)) ||
                anyGenerating ||
                !generationSessionReady ||
                explorationChoicePending
              }
              deeperLabel={focusedScenarioDeeperLabel}
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
              onChooseAnother={() => navigateToNode(null)}
              onGenerationChange={setRippleGenerating}
            />
          ) : focusedWorldScenario && installationId && worldEventId ? (
            <p className="notice session-registration-notice scenario-session-placeholder" role="status">
              {registrationStatus === "failed"
                ? staleCausalRegistration
                  ? "Generation is paused because the saved causal connection is no longer current. Resume independently above to continue."
                  : "Generation is paused until this saved atlas can resume."
                : "Restoring this saved atlas before loading ripple links…"}
            </p>
          ) : null}

          {siblingIds.length > 0 ? (
            <div className="change-path scenario-selection-scroll">
              <p>Change path</p>
              <div className="sibling-scroller scroll-affordance-x">
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
                {focusedNode ? <span>Level {focusedNode.depth + 1} of 5</span> : <span>Level 1 of 5</span>}
              </div>
              <ol className="children-list">
                {childIds.map((childId) => {
                  const child = graph.nodes[childId];
                  if (!child) return null;
                  const availability = expansionAvailability(graph, child.id);
                  const childCanRetry =
                    child.status === "error" &&
                    errorIsRetryable(child) &&
                    availability.allowed;
                  const childActionGenerates = child.status !== "error" || childCanRetry;
                  return (
                    <li key={child.id} className="branch-item">
                      <NodeCard
                        node={child}
                        availability={availability}
                        onActivate={() => activateNode(child.id)}
                        onRetry={() => activateNode(child.id)}
                        interactionDisabled={
                          anyGenerating ||
                          (childActionGenerates &&
                            (!worldEventId || child.depth !== 1) &&
                            (!generationSessionReady || explorationChoicePending))
                        }
                        actionLabel={worldEventId && child.depth === 1 ? "Consider this scenario" : undefined}
                        errorRetryable={childCanRetry}
                        onChooseAnother={() => navigateToNode(focusedNode ? focusedNode.id : null)}
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

      <MapDialog graph={graph} rootTitle={resolvedEventTitle} open={mapOpen} onClose={() => setMapOpen(false)} onSelect={(nodeId) => nodeId ? activateNode(nodeId) : navigateToNode(null)} />
    </main>
  );
}
