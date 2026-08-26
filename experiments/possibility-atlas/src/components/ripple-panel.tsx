"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorResponseSchema, type PossibilityNode } from "../lib/contracts";
import {
  RippleAnalysisResponseSchema,
  RippleRequestSchema,
  type RippleAnalysisResponse,
  type RippleEdge,
  type WorldEventSummary,
} from "../lib/world-contracts";

const influenceLabels = {
  raises_likelihood: "raises the likelihood of",
  lowers_likelihood: "lowers the likelihood of",
  accelerates: "accelerates",
  delays: "delays",
  amplifies_impact: "amplifies the impact of",
  reduces_pressure: "reduces pressure on",
  creates_dependency: "creates a dependency for",
} as const;

async function readPayload(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function failureFrom(payload: unknown, fallback: string) {
  const parsed = ErrorResponseSchema.safeParse(payload);
  return parsed.success
    ? {
        message: parsed.data.error.message,
        callConsumed: parsed.data.error.callConsumed,
      }
    : { message: fallback, callConsumed: false };
}

export function RipplePanel({
  installationId,
  graphId,
  worldEventId,
  scenario,
  generationDisabled,
  deeperDisabled,
  deeperLabel,
  onExploreDeeper,
  onAttemptStarted,
  onResponseApplied,
  onFailureApplied,
  onOpenTarget,
}: {
  installationId: string;
  graphId: string;
  worldEventId: string;
  scenario: PossibilityNode;
  generationDisabled: boolean;
  deeperDisabled: boolean;
  deeperLabel: string;
  onExploreDeeper: () => void;
  onAttemptStarted: (attemptId: string) => void;
  onResponseApplied: (
    response: RippleAnalysisResponse,
    attemptId: string,
  ) => void;
  onFailureApplied: (callConsumed: boolean, attemptId: string) => void;
  onOpenTarget: (event: WorldEventSummary, edge: RippleEdge) => void;
}) {
  const mountedRef = useRef(true);
  const [analysis, setAnalysis] = useState<RippleAnalysisResponse | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useMemo(
    () =>
      RippleRequestSchema.parse({
        installationId,
        graphId,
        worldEventId,
        scenarioNodeId: scenario.id,
      }),
    [graphId, installationId, scenario.id, worldEventId],
  );

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    setError(null);
    try {
      const query = new URLSearchParams(request).toString();
      const response = await fetch(`/api/world/ripples?${query}`, { cache: "no-store" });
      const payload = await readPayload(response);
      if (response.status === 404) {
        if (mountedRef.current) setAnalysis(null);
        return;
      }
      if (!response.ok) {
        throw new Error(failureFrom(payload, "Saved ripple analysis is unavailable.").message);
      }
      const parsed = RippleAnalysisResponseSchema.parse(payload);
      if (mountedRef.current) setAnalysis(parsed);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "Saved ripple analysis is unavailable.");
      }
    } finally {
      if (mountedRef.current) setLoadingSaved(false);
    }
  }, [request]);

  useEffect(() => {
    mountedRef.current = true;
    queueMicrotask(() => {
      if (!mountedRef.current) return;
      setAnalysis(null);
      void loadSaved();
    });
    return () => {
      mountedRef.current = false;
    };
  }, [loadSaved]);

  const generate = async () => {
    if (generating || generationDisabled) return;
    const attemptId = crypto.randomUUID();
    setGenerating(true);
    setError(null);
    try {
      onAttemptStarted(attemptId);
      const response = await fetch("/api/world/ripples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        const failure = failureFrom(payload, "The world reaction could not be analyzed.");
        onFailureApplied(failure.callConsumed, attemptId);
        throw new Error(failure.message);
      }
      const parsed = RippleAnalysisResponseSchema.parse(payload);
      onResponseApplied(parsed, attemptId);
      if (!mountedRef.current) return;
      setAnalysis(parsed);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "The world reaction could not be analyzed.");
      }
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  };

  const targetEvents = new Map(
    analysis?.kind === "ripples"
      ? analysis.targetEvents.map((event) => [event.id, event])
      : [],
  );

  return (
    <section className="scenario-ripple-section" aria-labelledby="scenario-actions-heading">
      <div className="scenario-actions-copy">
        <p className="eyebrow">Suppose this happens</p>
        <h2 id="scenario-actions-heading">Where do you want to go next?</h2>
        <p>
          Compare this scenario with other active events, or continue down its own five-level path.
        </p>
      </div>
      <div className="scenario-action-grid">
        <button
          type="button"
          className="primary-button ripple-generate-button"
          disabled={generationDisabled || generating || loadingSaved}
          onClick={() => void generate()}
        >
          {generating
            ? "Watching the world react…"
            : analysis
              ? "Check for world updates"
              : "Watch the world react"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={deeperDisabled}
          onClick={onExploreDeeper}
        >
          {deeperLabel}
        </button>
      </div>

      {loadingSaved ? (
        <p className="ripple-loading" aria-live="polite"><span className="spinner" /> Checking for a saved world reaction…</p>
      ) : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error}</span>
          <button type="button" className="text-button" disabled={generationDisabled || generating} onClick={() => void generate()}>Retry</button>
        </div>
      ) : null}

      {analysis?.kind === "no_credible_links" ? (
        <div className="no-ripples" role="status">
          <strong>No credible one-hop links found.</strong>
          <p>{analysis.reason}</p>
        </div>
      ) : null}

      {analysis?.kind === "ripples" ? (
        <div className="ripple-results" aria-live="polite">
          <div className="world-section-heading ripple-heading">
            <div>
              <p className="eyebrow">Conditional ripple</p>
              <h2>{analysis.edges.length} affected {analysis.edges.length === 1 ? "event" : "events"}</h2>
            </div>
            <span>Possibility, not prediction</span>
          </div>
          <ol className="ripple-list">
            {analysis.edges.map((edge) => {
              const target = targetEvents.get(edge.targetEventId);
              return (
                <li key={edge.id} className="ripple-card">
                  <div className="ripple-connector" aria-hidden="true"><span>↳</span></div>
                  <div className="ripple-card-body">
                    <div className="ripple-badges">
                      <span>{edge.strength} influence</span>
                      <span>{edge.confidence} evidence confidence</span>
                    </div>
                    <p className="ripple-relationship">This scenario <strong>{influenceLabels[edge.influence]}</strong></p>
                    <h3>{target?.canonicalTitle ?? "Another active event"}</h3>
                    <p>{edge.mechanism}</p>
                    <dl>
                      <div><dt>Horizon</dt><dd>{edge.horizon}</dd></div>
                      <div><dt>Signals to watch</dt><dd><ul>{edge.watchFor.map((signal) => <li key={signal}>{signal}</li>)}</ul></dd></div>
                    </dl>
                    {target ? (
                      <button type="button" className="world-card-action" onClick={() => onOpenTarget(target, edge)}>
                        View affected event <span aria-hidden="true">→</span>
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
