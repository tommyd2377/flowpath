"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export const nextMoveGenerationStages = [
  "Reading your board...",
  "Checking constraints...",
  "Finding the bottleneck...",
  "Building the operator path...",
  "Preparing task candidates...",
  "Still working. Current, local, or high-stakes plans can take two to three minutes...",
  "Almost there. FlowPath will save the plan when it returns...",
] as const;

export const intakeGenerationStages = [
  "Reading your answer...",
  "Checking constraints...",
  "Choosing the next useful question...",
  "Still working...",
] as const;

export const taskGenerationStages = [
  "Creating ranked task candidates...",
  "Checking for duplicates...",
  "Ranking tasks globally...",
] as const;

export const dailyGenerationStages = [
  "Reading today's check-in...",
  "Reviewing tasks and active boards...",
  "Checking whether current web info is needed...",
  "Waiting for the model to finish today's briefing...",
  "Still working. Current or local plans can take about a minute...",
  "Almost there. FlowPath will save the briefing when it returns...",
] as const;

const generationStageDurationsMs = [6000, 8000, 10000, 18000, 18000, 16000];

export function GenerationStatus({
  stages = nextMoveGenerationStages,
  startedAt,
  softWarningSeconds = 30,
  hardTimeoutSeconds = 120,
  hardTimeoutIsFailure = false,
  onContinue,
  onRetry,
  onCancel,
  onEdit,
  onTimeout,
}: {
  stages?: readonly string[];
  startedAt?: number;
  softWarningSeconds?: number;
  hardTimeoutSeconds?: number;
  hardTimeoutIsFailure?: boolean;
  onContinue?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onTimeout?: () => void;
}) {
  const [stageIndex, setStageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [dismissedWarning, setDismissedWarning] = useState(false);
  const [didTimeout, setDidTimeout] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setStageIndex((current) => (current + 1) % stages.length),
      generationStageDurationsMs[stageIndex] ?? 12000,
    );

    return () => window.clearTimeout(timeoutId);
  }, [stageIndex, stages]);

  useEffect(() => {
    const start = startedAt ?? Date.now();
    const intervalId = window.setInterval(() => {
      const nextElapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
      setElapsedSeconds(nextElapsed);
      if (nextElapsed >= hardTimeoutSeconds && !didTimeout) {
        setDidTimeout(true);
        onTimeout?.();
      }
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [didTimeout, hardTimeoutSeconds, onTimeout, startedAt]);

  const message = stages[stageIndex] ?? stages[0] ?? "Working...";

  const showSoftWarning =
    elapsedSeconds >= softWarningSeconds && !dismissedWarning && !didTimeout;
  const showTimeoutNotice =
    didTimeout && (hardTimeoutIsFailure || !dismissedWarning);
  const timeoutTone = hardTimeoutIsFailure
    ? "border-red-900/70 bg-red-950/30 text-red-100"
    : "border-amber-900/70 bg-amber-950/30 text-amber-100";
  const timeoutButtonTone = hardTimeoutIsFailure
    ? "border-red-700 text-red-50 hover:bg-red-900/40"
    : "border-amber-700 text-amber-50 hover:bg-amber-900/40";

  return (
    <div
      aria-live="polite"
      className="grid gap-3 rounded-md border border-slate-800 bg-slate-900/70 p-3 text-sm text-slate-300"
    >
      <div className="flex min-h-7 items-center gap-2">
        <span className="relative flex h-5 w-5 shrink-0 overflow-hidden rounded bg-slate-950">
          <Image
            src="/brand/flowpath-mark-square.png"
            alt=""
            width={20}
            height={20}
            unoptimized
            className="h-full w-full object-cover"
          />
          <span className="absolute right-0 top-0 h-2 w-2 animate-pulse rounded-full bg-[var(--azure-light)]" />
        </span>
        <span>
          {didTimeout
            ? hardTimeoutIsFailure
              ? "This took too long."
              : "Still waiting for the model."
            : message}
        </span>
        {elapsedSeconds >= 4 ? (
          <span className="text-slate-500">Still working... {elapsedSeconds}s</span>
        ) : null}
      </div>

      {showSoftWarning ? (
        <div className="grid gap-2 rounded-md border border-amber-900/70 bg-amber-950/30 p-3 text-amber-100">
          <div>This is taking longer than usual.</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setDismissedWarning(true);
                onContinue?.();
              }}
              className="rounded-md border border-amber-700 px-2 py-1 text-xs font-medium text-amber-50 hover:bg-amber-900/40"
            >
              Continue waiting
            </button>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-amber-700 px-2 py-1 text-xs font-medium text-amber-50 hover:bg-amber-900/40"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showTimeoutNotice ? (
        <div className={`grid gap-2 rounded-md border p-3 ${timeoutTone}`}>
          <div>
            {hardTimeoutIsFailure
              ? "FlowPath did not get a complete response. You can retry, cancel, or edit the board and try again."
              : "FlowPath is still waiting for a complete response. You can keep waiting, cancel, or edit the board and try again."}
          </div>
          <div className="flex flex-wrap gap-2">
            {!hardTimeoutIsFailure ? (
              <button
                type="button"
                onClick={() => {
                  setDismissedWarning(true);
                  onContinue?.();
                }}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${timeoutButtonTone}`}
              >
                Continue waiting
              </button>
            ) : null}
            {hardTimeoutIsFailure && onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${timeoutButtonTone}`}
              >
                Retry
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${timeoutButtonTone}`}
              >
                Edit board
              </button>
            ) : null}
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${timeoutButtonTone}`}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
