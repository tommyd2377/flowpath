import type { UsageType } from "./types";

type GenerationTimingEvent = {
  route: string;
  generationType: "intake" | "operator_plan" | "task_generation";
  phase: "start" | "context_loaded" | "model_complete" | "persisted" | "complete" | "error";
  userId: number;
  situationId?: number | null;
  clientGenerationId?: string | null;
  isGuest?: boolean;
  isQa?: boolean;
  retryCount?: number;
  elapsedMs?: number;
  phaseMs?: number;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  messageCount?: number;
  userMessageCount?: number;
  assistantMessageCount?: number;
  inferredContextCount?: number;
  openTaskCount?: number;
  recentPlanCount?: number;
  usageType?: UsageType;
  errorCategory?: string | null;
  errorName?: string | null;
};

function safeTimingEvent(event: GenerationTimingEvent) {
  return {
    event: "flowpath_generation_timing",
    ...event,
    timestamp: new Date().toISOString(),
  };
}

export function logGenerationTiming(event: GenerationTimingEvent) {
  console.info(JSON.stringify(safeTimingEvent(event)));
}
