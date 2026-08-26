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
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        callConsumed: parsed.data.error.callConsumed,
        retryable: parsed.data.error.retryable,
      }
    : { code: null, message: fallback, callConsumed: false, retryable: false };
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
  onChooseAnother,
  onGenerationChange,
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
  onChooseAnother: () => void;
  onGenerationChange: (generating: boolean) => void;
}) {
  const loadControllerRef = useRef<AbortController | null>(null);
  const generationControllerRef = useRef<AbortController | null>(null);
  const [analysis, setAnalysis] = useState<RippleAnalysisResponse | null>(null);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<{
    message: string;
    retryable: boolean;
    code: string | null;
    retryAction: "load" | "generate";
  } | null>(null);
  const [generationReassurance, setGenerationReassurance] = useState<string | null>(null);

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
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setLoadingSaved(true);
    setError(null);
    try {
      const query = new URLSearchParams(request).toString();
      const response = await fetch(`/api/world/ripples?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (controller.signal.aborted || loadControllerRef.current !== controller) return;
      if (response.status === 404) {
        setAnalysis(null);
        return;
      }
      if (!response.ok) {
        const failure = failureFrom(payload, "Saved ripple analysis is unavailable.");
        throw Object.assign(new Error(failure.message), failure);
      }
      const parsed = RippleAnalysisResponseSchema.parse(payload);
      setAnalysis(parsed);
    } catch (caught) {
      if (controller.signal.aborted || loadControllerRef.current !== controller) return;
      const failure = caught as Partial<ReturnType<typeof failureFrom>> & Error;
      setError({
        code: failure.code ?? null,
        message: failure.message || "Saved ripple analysis is unavailable.",
        retryable: failure.retryable ?? true,
        retryAction: failure.code === "ripple_analysis_stale" ? "generate" : "load",
      });
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setLoadingSaved(false);
      }
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAnalysis(null);
      setGenerating(false);
      setGenerationReassurance(null);
      void loadSaved();
    });
    return () => {
      active = false;
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
      if (generationControllerRef.current) {
        generationControllerRef.current.abort();
        generationControllerRef.current = null;
        onGenerationChange(false);
      }
    };
  }, [loadSaved, onGenerationChange]);

  useEffect(() => {
    if (!generating) return;
    const patientTimer = window.setTimeout(() => {
      setGenerationReassurance("Still working—careful analysis can take 15–30 seconds.");
    }, 8_000);
    const longTimer = window.setTimeout(() => {
      setGenerationReassurance("Still analyzing the same request. Thanks for waiting.");
    }, 20_000);
    return () => {
      window.clearTimeout(patientTimer);
      window.clearTimeout(longTimer);
    };
  }, [generating]);

  const generate = async () => {
    if (generating || generationDisabled) return;
    const attemptId = crypto.randomUUID();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setGenerating(true);
    setGenerationReassurance(null);
    onGenerationChange(true);
    setError(null);
    try {
      onAttemptStarted(attemptId);
      const response = await fetch("/api/world/ripples", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const payload = await readPayload(response);
      if (controller.signal.aborted || generationControllerRef.current !== controller) return;
      if (!response.ok) {
        const failure = failureFrom(payload, "The world reaction could not be analyzed.");
        onFailureApplied(failure.callConsumed, attemptId);
        throw Object.assign(new Error(failure.message), failure);
      }
      const parsed = RippleAnalysisResponseSchema.parse(payload);
      if (controller.signal.aborted || generationControllerRef.current !== controller) return;
      onResponseApplied(parsed, attemptId);
      setAnalysis(parsed);
    } catch (caught) {
      if (controller.signal.aborted || generationControllerRef.current !== controller) return;
      const failure = caught as Partial<ReturnType<typeof failureFrom>> & Error;
      setError({
        code: failure.code ?? null,
        message: failure.message || "The world reaction could not be analyzed.",
        retryable: failure.retryable ?? true,
        retryAction: "generate",
      });
    } finally {
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
        setGenerating(false);
        setGenerationReassurance(null);
        onGenerationChange(false);
      }
    }
  };

  const targetEvents = new Map(
    analysis?.kind === "ripples"
      ? analysis.targetEvents.map((event) => [event.id, event])
      : [],
  );

  return (
    <section className="scenario-ripple-section" aria-labelledby="scenario-actions-heading">
      <div className="scenario-in-focus scenario-focus-anchor" aria-label="Scenario in focus">
        <span>Scenario in focus</span>
        <strong>{scenario.title}</strong>
      </div>
      <div className="scenario-actions-copy">
        <p className="eyebrow">Suppose this happens</p>
        <h2 id="scenario-actions-heading">Where do you want to go next?</h2>
        <p>
          Compare this scenario with other active events, or continue down its own five-level path.
        </p>
      </div>
      <div className="scenario-action-grid scenario-action-scroll scroll-affordance-x">
        <button
          type="button"
          className="primary-button ripple-generate-button"
          disabled={generationDisabled || generating || loadingSaved}
          onClick={() => void generate()}
        >
          {generating
            ? "Watching the world react…"
            : analysis
              ? "Recheck ripple links"
              : "Watch the world react"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={deeperDisabled || generationDisabled || generating}
          onClick={onExploreDeeper}
        >
          {deeperLabel}
        </button>
      </div>

      {loadingSaved ? (
        <p className="ripple-loading" aria-live="polite"><span className="spinner" /> Checking for a saved world reaction…</p>
      ) : null}
      {generating ? (
        <p className="ripple-loading generation-status" aria-live="polite">
          <span className="spinner" /> {generationReassurance ?? "Analyzing how this scenario could affect other active events…"}
        </p>
      ) : null}
      {error ? (
        <div className="notice error-notice" role="alert">
          <span>{error.message}</span>
          {error.retryable ? (
            <button
              type="button"
              className="text-button"
              disabled={generating || (error.retryAction === "generate" && generationDisabled)}
              onClick={() => void (error.retryAction === "load" ? loadSaved() : generate())}
            >
              Retry
            </button>
          ) : (
            <button type="button" className="text-button" disabled={generating} onClick={onChooseAnother}>Choose another scenario</button>
          )}
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
