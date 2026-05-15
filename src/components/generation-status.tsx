"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export const nextMoveGenerationStages = [
  "Reading your situation...",
  "Reviewing profile and recent context...",
  "Checking whether current web info is needed...",
  "Waiting for the model to finish the plan...",
  "Still working. Current or local plans can take about a minute...",
  "Almost there. FlowPath will save the plan when it returns...",
] as const;

export const dailyGenerationStages = [
  "Reading today's check-in...",
  "Reviewing tasks and active situations...",
  "Checking whether current web info is needed...",
  "Waiting for the model to finish today's briefing...",
  "Still working. Current or local plans can take about a minute...",
  "Almost there. FlowPath will save the briefing when it returns...",
] as const;

const generationStageDurationsMs = [6000, 8000, 10000, 18000, 18000, 16000];

export function GenerationStatus({
  stages = nextMoveGenerationStages,
}: {
  stages?: readonly string[];
}) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setStageIndex((current) => (current + 1) % stages.length),
      generationStageDurationsMs[stageIndex] ?? 12000,
    );

    return () => window.clearTimeout(timeoutId);
  }, [stageIndex, stages]);

  const message = stages[stageIndex] ?? stages[0] ?? "Working...";

  return (
    <div
      aria-live="polite"
      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-800 bg-slate-900/70 px-3 text-sm text-slate-300"
    >
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
      <span>{message}</span>
    </div>
  );
}
