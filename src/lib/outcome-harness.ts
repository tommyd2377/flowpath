import { z } from "zod";

import type { InterventionType } from "./cognitive-schemas";

export const OUTCOME_HARNESS_EVENT_TYPES = [
  "suggested_action_shown",
  "suggested_action_accepted",
  "suggested_action_edited",
  "suggested_action_dismissed",
  "suggested_action_completed",
  "suggested_action_ignored",
  "task_created_from_ai",
  "task_created_manually",
  "task_edited",
  "task_completed",
  "task_dismissed",
  "plan_generated",
  "plan_regenerated",
  "intake_question_answered",
  "intake_skipped_generate_now",
  "user_reported_helpful",
  "user_reported_not_helpful",
  "user_reported_acted",
  "user_reported_deferred",
  "user_reported_still_stuck",
  "user_repeated_same_loop",
  "evaluator_rewrite_triggered",
  "web_search_used",
  "memory_used",
  "escalation_triggered",
  "first_intake_question_shown",
  "first_intake_abandoned",
  "situation_edited_before_answering",
  "created_new_situation_before_answering",
] as const;

export const OUTCOME_HARNESS_SOURCES = [
  "first_intake",
  "followup_intake",
  "next_move_plan",
  "suggested_action",
  "task_deck",
  "check_in",
  "manual_user_feedback",
  "system_inference",
] as const;

export type OutcomeHarnessEventType =
  (typeof OUTCOME_HARNESS_EVENT_TYPES)[number];
export type OutcomeHarnessSource = (typeof OUTCOME_HARNESS_SOURCES)[number];

export type OutcomeHarnessEvent = {
  id: string;
  user_id?: number;
  situation_id: number | null;
  conversation_id: string | null;
  message_id: number | null;
  task_id: number | null;
  plan_id: number | null;
  event_type: OutcomeHarnessEventType;
  source: OutcomeHarnessSource;
  state_detected: string | null;
  intervention_type: string | null;
  domain: string | null;
  subtype: string | null;
  question_purpose: string | null;
  model_used: string | null;
  metadata_json: string;
  metadata?: Record<string, unknown>;
  dedupe_key: string | null;
  is_qa?: boolean;
  created_at: string;
  updated_at: string;
};

export type InterventionEffectivenessSummary = {
  user_id?: number;
  domain: string;
  subtype: string;
  intervention_type: string;
  shown_count: number;
  accepted_count: number;
  completed_count: number;
  dismissed_count: number;
  not_useful_count: number;
  edited_count: number;
  ignored_count: number;
  reported_helpful_count: number;
  reported_still_stuck_count: number;
  repeated_loop_count: number;
  last_used_at: string | null;
  effectiveness_score: number;
  is_qa?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type HistoricalEffectivenessContext = {
  domain: string;
  subtype: string;
  currentState: string;
  summaries: InterventionEffectivenessSummary[];
  advisoryText: string;
  hasMeaningfulSignal: boolean;
  userPrefersShorterTasks: boolean;
  editedTasksDownCount: number;
  ignoredSimilarTaskCount: number;
  repeatedLoopCount: number;
};

export type OutcomeHarnessDashboardSummary = {
  totals: {
    suggestedActionsShown: number;
    accepted: number;
    edited: number;
    completed: number;
    dismissed: number;
    notUseful: number;
    ignored: number;
  };
  rates: {
    acceptRate: number;
    editRate: number;
    completionRate: number;
    dismissRate: number;
    notUsefulRate: number;
    ignoredRate: number;
  };
  strongestInterventions: InterventionEffectivenessSummary[];
  weakestInterventions: InterventionEffectivenessSummary[];
  firstIntake: {
    shown: number;
    answered: number;
    skipped: number;
    abandoned: number;
  };
  evaluatorRewriteRate: number;
  escalationRate: number;
  averageEstimatedMinutes: {
    accepted: number | null;
    dismissed: number | null;
  };
  poorAcceptanceContexts: Array<{
    domain: string;
    subtype: string;
    shown: number;
    accepted: number;
    acceptRate: number;
  }>;
};

export const outcomeHarnessEventMetadataSchema = z
  .record(z.string(), z.unknown())
  .default({});

export const taskEditDiffSchema = z.object({
  originalTitle: z.string(),
  newTitle: z.string(),
  originalDescription: z.string(),
  newDescription: z.string(),
  changedFields: z.array(z.string()),
  estimatedMinutesBefore: z.number().int().nullable(),
  estimatedMinutesAfter: z.number().int().nullable(),
});

export const outcomeHarnessEventInputSchema = z.object({
  situationId: z.number().int().positive().nullable().optional(),
  conversationId: z.string().trim().max(120).nullable().optional(),
  messageId: z.number().int().positive().nullable().optional(),
  taskId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  eventType: z.enum(OUTCOME_HARNESS_EVENT_TYPES),
  source: z.enum(OUTCOME_HARNESS_SOURCES),
  stateDetected: z.string().trim().max(120).nullable().optional(),
  interventionType: z.string().trim().max(160).nullable().optional(),
  domain: z.string().trim().max(160).nullable().optional(),
  subtype: z.string().trim().max(160).nullable().optional(),
  questionPurpose: z.string().trim().max(160).nullable().optional(),
  modelUsed: z.string().trim().max(160).nullable().optional(),
  metadata: outcomeHarnessEventMetadataSchema.optional(),
  dedupeKey: z.string().trim().max(240).nullable().optional(),
  isQa: z.boolean().optional(),
});

export type OutcomeHarnessEventInput = z.infer<
  typeof outcomeHarnessEventInputSchema
>;

const eventWeights: Partial<Record<OutcomeHarnessEventType, number>> = {
  suggested_action_accepted: 1,
  suggested_action_completed: 2,
  task_completed: 2,
  user_reported_helpful: 2,
  user_reported_acted: 2,
  suggested_action_edited: 0.25,
  task_edited: 0.25,
  suggested_action_dismissed: -1,
  task_dismissed: -1,
  user_reported_deferred: -1,
  suggested_action_ignored: -0.5,
  user_reported_not_helpful: -2,
  user_reported_still_stuck: -2,
  user_repeated_same_loop: -1.5,
};

export function scoreEffectivenessSummary(
  summary: Pick<
    InterventionEffectivenessSummary,
    | "shown_count"
    | "accepted_count"
    | "completed_count"
    | "dismissed_count"
    | "not_useful_count"
    | "edited_count"
    | "ignored_count"
    | "reported_helpful_count"
    | "reported_still_stuck_count"
    | "repeated_loop_count"
  >,
) {
  const positive =
    summary.accepted_count +
    summary.completed_count * 2 +
    summary.reported_helpful_count * 2;
  const mixed = summary.edited_count * 0.25;
  const negative =
    summary.dismissed_count +
    summary.not_useful_count * 2 +
    summary.reported_still_stuck_count * 2 +
    summary.ignored_count * 0.5 +
    summary.repeated_loop_count * 1.5;
  const denominator = Math.max(
    1,
    positive + Math.abs(mixed) + negative + summary.shown_count * 0.25,
  );
  const score = ((positive + mixed - negative) / denominator) * 100;
  return Math.max(-100, Math.min(100, Math.round(score)));
}

export function weightForOutcomeHarnessEvent(eventType: OutcomeHarnessEventType) {
  return eventWeights[eventType] ?? 0;
}

export function buildEffectivenessAdvisoryText(
  context: HistoricalEffectivenessContext,
) {
  const meaningful = context.summaries.filter(
    (item) =>
      item.shown_count +
        item.accepted_count +
        item.completed_count +
        item.dismissed_count +
        item.not_useful_count +
        item.edited_count >=
      2,
  );
  if (meaningful.length === 0) return "";

  const strongest = [...meaningful]
    .sort((a, b) => b.effectiveness_score - a.effectiveness_score)
    .slice(0, 2);
  const weakest = [...meaningful]
    .sort((a, b) => a.effectiveness_score - b.effectiveness_score)
    .slice(0, 2);

  const strongText = strongest
    .map(
      (item) =>
        `${item.intervention_type} (${item.effectiveness_score}, ${item.completed_count} completed, ${item.accepted_count} accepted)`,
    )
    .join("; ");
  const weakText = weakest
    .filter((item) => item.effectiveness_score < 0)
    .map(
      (item) =>
        `${item.intervention_type} (${item.effectiveness_score}, ${item.dismissed_count + item.not_useful_count} rejected/dismissed)`,
    )
    .join("; ");

  return [
    strongText
      ? `Historically, for this user in ${context.domain}/${context.subtype}, ${strongText} has stronger follow-through signals.`
      : "",
    weakText ? `Weaker signals: ${weakText}.` : "",
    context.userPrefersShorterTasks
      ? "The user appears to accept shorter tasks more often than longer tasks."
      : "",
    context.editedTasksDownCount > 0
      ? "The user has edited prior tasks down into smaller actions; prefer a concrete starter action."
      : "",
    context.repeatedLoopCount > 0
      ? "Recent outcomes suggest a repeated loop; avoid restating the same advice and propose one experiment."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function eventTypeToOutcomeValue(
  eventType: OutcomeHarnessEventType,
): "improved" | "acted" | "rejected" | "deferred" | "needs_followup" | null {
  if (eventType === "user_reported_helpful") return "improved";
  if (eventType === "user_reported_acted") return "acted";
  if (eventType === "user_reported_not_helpful") return "rejected";
  if (eventType === "user_reported_deferred") return "deferred";
  if (eventType === "user_reported_still_stuck") return "needs_followup";
  return null;
}

export function eventTypeForOutcomeValue(
  value: "improved" | "acted" | "rejected" | "deferred" | "needs_followup",
): OutcomeHarnessEventType {
  if (value === "improved") return "user_reported_helpful";
  if (value === "acted") return "user_reported_acted";
  if (value === "rejected") return "user_reported_not_helpful";
  if (value === "deferred") return "user_reported_deferred";
  return "user_reported_still_stuck";
}

export function isPositiveInterventionType(value: string | null | undefined): value is InterventionType {
  return Boolean(value);
}
