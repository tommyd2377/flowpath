import { z } from "zod";

import {
  AGE_RANGES,
  CONFIDENCE_LEVELS,
  CONSTRAINT_SENSITIVITIES,
  CONTEXT_USED_CATEGORIES,
  CONTEXT_USED_SOURCES,
  DOMAIN_ACCESS_LEVELS,
  DATING_ENVIRONMENTS,
  DATING_INTENTIONS,
  DESIRED_CONNECTION_TYPES,
  FINANCIAL_PRESSURE_LEVELS,
  FINANCIAL_RUNWAYS,
  INTAKE_STAGES,
  INFERRED_CONTEXT_CATEGORIES,
  INFERRED_CONTEXT_PERSISTENCE,
  INFERRED_CONTEXT_SOURCES,
  LOCATION_PRECISIONS,
  MEMORY_PERSISTENCE,
  MONTHLY_CASH_FLOWS,
  NEXT_MOVE_MODES,
  PLAN_TASK_CANDIDATE_TYPES,
  PRIORITY_LEVELS,
  PROJECT_STATUSES,
  SAFETY_RISK_LEVELS,
  SAFE_PEOPLE_TO_CONTACT_OPTIONS,
  SITUATION_SAFETY_RISKS,
  SITUATION_STATUSES,
  SITUATION_URGENCIES,
  SOCIAL_BARRIERS,
  SOCIAL_CONNECTION_PATTERNS,
  SOCIAL_CRISIS_RISKS,
  SOCIAL_ENERGY_LEVELS,
  SOCIAL_SETTING_PREFERENCES,
  TASK_FRICTION_TYPES,
  TASK_STATUSES,
  URGENT_FINANCIAL_RISKS,
} from "./types";
import type { SafetyBoundary } from "./types";

export const SITUATION_TITLE_MAX = 120;
export const SITUATION_DESCRIPTION_MAX = 8000;
export const INTAKE_ANSWER_MAX = 8000;
export const MEMORY_LABEL_MAX = 160;
export const MEMORY_VALUE_MAX = 1000;
export const TASK_TITLE_MAX = 220;
export const TASK_NOTES_MAX = 5000;

export const DEFAULT_SAFETY_BOUNDARY: SafetyBoundary = {
  risk_level: "low",
  professional_help_signal:
    "Use appropriate human or professional help when the situation exceeds planning support.",
  do_not_rely_on_ai_for:
    "Do not rely on FlowPath for legal, medical, financial, emergency, or crisis decisions.",
  urgent_support_guidance:
    "If there is immediate danger, contact local emergency services or a trusted person nearby now.",
};

const text = (max = 4000) => z.string().trim().max(max).optional().default("");
const nullableId = z.number().int().positive().nullable().optional().default(null);
const safetyBoundaryText = (fallback: string) =>
  z
    .string()
    .trim()
    .transform((value) => value || fallback)
    .pipe(z.string().max(1200));
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .nullable()
  .optional()
  .default(null);
const optionalEstimatedMinutes = z
  .number()
  .int()
  .min(1)
  .max(480)
  .nullable()
  .optional()
  .default(null);
const persistence = z.enum(MEMORY_PERSISTENCE).optional().default("session_only");

const persistedTextConstraint = (max = 1000) =>
  z
    .object({
      value: text(max),
      persistence,
    })
    .partial()
    .optional();

const persistedMultiConstraint = <T extends readonly [string, ...string[]]>(
  values: T,
  max = values.length,
) =>
  z
    .object({
      values: z.array(z.enum(values)).max(max).optional(),
      persistence,
    })
    .partial()
    .optional();

export const contextConstraintsSchema = z
  .object({
    location: z
      .object({
        value: text(240),
        precision: z.enum(LOCATION_PRECISIONS).optional().default("none"),
        persistence,
      })
      .partial()
      .optional(),
    age_range: z
      .object({
        value: z.enum(AGE_RANGES).optional(),
        persistence,
      })
      .partial()
      .optional(),
    life_stage: persistedTextConstraint(500),
    education_or_credentials: persistedTextConstraint(1000),
    financial_context: z
      .object({
        pressure_level: z.enum(FINANCIAL_PRESSURE_LEVELS).optional(),
        runway: z.enum(FINANCIAL_RUNWAYS).optional(),
        monthly_cash_flow: z.enum(MONTHLY_CASH_FLOWS).optional(),
        urgent_risks: z.array(z.enum(URGENT_FINANCIAL_RISKS)).max(9).optional(),
        persistence,
      })
      .partial()
      .optional(),
    time_availability: persistedTextConstraint(500),
    energy_capacity: persistedTextConstraint(500),
    dependents_or_caregiving: persistedTextConstraint(500),
    transportation: persistedTextConstraint(500),
    support_network: persistedTextConstraint(1000),
    domain_access: z
      .object({
        value: z.enum(DOMAIN_ACCESS_LEVELS).optional(),
        notes: text(1000),
        persistence,
      })
      .partial()
      .optional(),
    proof_or_track_record: persistedTextConstraint(1000),
    urgent_deadline: persistedTextConstraint(500),
    safety_or_emergency_risk: z
      .object({
        value: z.enum(SITUATION_SAFETY_RISKS).optional(),
        persistence: z.literal("session_only").optional().default("session_only"),
      })
      .partial()
      .optional(),
    social_connection: z
      .object({
        patterns: z.array(z.enum(SOCIAL_CONNECTION_PATTERNS)).max(8).optional(),
        desired_connection: persistedMultiConstraint(DESIRED_CONNECTION_TYPES),
        social_energy: z
          .object({
            value: z.enum(SOCIAL_ENERGY_LEVELS).optional(),
            persistence,
          })
          .partial()
          .optional(),
        preferred_settings: persistedMultiConstraint(SOCIAL_SETTING_PREFERENCES),
        barriers: persistedMultiConstraint(SOCIAL_BARRIERS),
        existing_connection_surface: persistedTextConstraint(1000),
        repeatable_contexts_available: persistedTextConstraint(1000),
        safe_people_to_contact: z
          .object({
            value: z.enum(SAFE_PEOPLE_TO_CONTACT_OPTIONS).optional(),
            notes: text(1000),
            persistence,
          })
          .partial()
          .optional(),
        dating_intention: z
          .object({
            value: z.enum(DATING_INTENTIONS).optional(),
            persistence,
          })
          .partial()
          .optional(),
        dating_environment: persistedMultiConstraint(DATING_ENVIRONMENTS),
        attraction_or_partner_preferences: persistedTextConstraint(1000),
        consent_and_safety_constraints: z
          .object({
            value: text(1000),
            persistence: z.literal("session_only").optional().default("session_only"),
          })
          .partial()
          .optional(),
        avoid_contexts: persistedTextConstraint(1000),
        crisis_or_immediate_safety_risk: z
          .object({
            value: z.enum(SOCIAL_CRISIS_RISKS).optional(),
            persistence: z.literal("session_only").optional().default("session_only"),
          })
          .partial()
          .optional(),
      })
      .partial()
      .optional(),
    other: persistedTextConstraint(1000),
  })
  .partial()
  .default({});

export const profileInputSchema = z.object({
  personal_profile: text(12000),
  current_season: text(8000),
  core_priorities: text(8000),
  constraints: text(8000),
  operating_principles: text(8000),
  remember: text(12000),
  challenge_on: text(8000),
  context_constraints: contextConstraintsSchema.optional().default({}),
});

export const contextConstraintsInputSchema = z.object({
  context_constraints: contextConstraintsSchema,
});

export const lifeAreaInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  description: text(4000),
  priority_level: z.enum(PRIORITY_LEVELS).default("medium"),
  desired_outcome: text(4000),
  current_bottleneck: text(4000),
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(160),
  life_area_id: nullableId,
  status: z.enum(PROJECT_STATUSES).default("active"),
  description: text(5000),
  next_milestone: text(3000),
  current_bottleneck: text(3000),
  why_it_matters: text(3000),
});

export const taskInputSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Task title is required.")
    .max(TASK_TITLE_MAX, `Task title must be ${TASK_TITLE_MAX} characters or fewer.`),
  life_area_id: nullableId,
  project_id: nullableId,
  status: z.enum(TASK_STATUSES).default("open"),
  importance: z.number().int().min(1).max(5).default(3),
  effort: z.number().int().min(1).max(5).default(3),
  friction_type: z.enum(TASK_FRICTION_TYPES).default("none"),
  friction_note: text(1200),
  estimated_minutes: optionalEstimatedMinutes,
  due_date: optionalDate,
  notes: text(TASK_NOTES_MAX),
});

export const taskFeedbackInputSchema = z.object({
  outcome: z.enum([
    "completed",
    "couldnt_complete",
    "no_longer_relevant",
    "need_help",
  ]),
  notes: text(1200),
});

export const taskRevisionInputSchema = z.object({
  instructions: z
    .string()
    .trim()
    .min(1, "Tell FlowPath what should change about this task.")
    .max(1200, "Revision instructions must be 1200 characters or fewer."),
  intent: z.enum(["revise", "couldnt_complete"]).default("revise"),
});

export const checkInInputSchema = z.object({
  energy_level: z.number().int().min(1).max(10),
  mood: text(1000),
  sleep: text(1000),
  health_status: text(1500),
  main_thing: text(4000),
  resistance: text(4000),
  brain_dump: text(8000),
});

export const dailyPlanActionSchema = z.object({
  title: z.string().min(1).max(160),
  area: z.string().min(1).max(120),
  why_it_matters: z.string().min(1).max(1000),
  estimated_minutes: z.number().int().min(1).max(480),
  success_condition: z.string().min(1).max(1000),
  first_step: z.string().min(1).max(1000),
});

export const recommendationBasisSchema = z.object({
  signal: z.string().trim().min(1).max(500),
  source: z.string().trim().min(1).max(120),
  implication: z.string().trim().min(1).max(800),
});

export const restraintGuidanceSchema = z.object({
  should_push: z.boolean(),
  reason: z.string().trim().min(1).max(900),
  minimum_viable_move: z.string().trim().min(1).max(900),
  recovery_move: z.string().trim().min(1).max(900),
  scope_boundary: z.string().trim().min(1).max(900),
});

export const operatorInsightSchema = z.object({
  naive_path: z.string().trim().min(1).max(1000),
  operator_path: z.string().trim().min(1).max(1200),
  wasted_motion_to_avoid: z.string().trim().min(1).max(1000),
});

export const localScoutFindingSchema = z.object({
  title: z.string().trim().min(1).max(180),
  why_it_matters: z.string().trim().min(1).max(1000),
  source: z.string().trim().min(1).max(240),
  url_or_next_search: z.string().trim().max(500).default(""),
});

export const localRealityScoutSchema = z.object({
  used_web_search: z.boolean(),
  location_basis: z.string().trim().max(240).default(""),
  findings: z.array(localScoutFindingSchema).max(4),
  missing_location_question: z.string().trim().max(500).default(""),
});

export const safetyBoundarySchema = z.object({
  risk_level: z.enum(SAFETY_RISK_LEVELS),
  professional_help_signal: safetyBoundaryText(
    DEFAULT_SAFETY_BOUNDARY.professional_help_signal,
  ),
  do_not_rely_on_ai_for: safetyBoundaryText(
    DEFAULT_SAFETY_BOUNDARY.do_not_rely_on_ai_for,
  ),
  urgent_support_guidance: safetyBoundaryText(
    DEFAULT_SAFETY_BOUNDARY.urgent_support_guidance,
  ),
});

export const dailyPlanSchema = z.object({
  today_theme: z.string().min(1).max(220),
  honest_read: z.string().min(1).max(1800),
  top_3_actions: z.array(dailyPlanActionSchema).min(1).max(3),
  recommendation_basis: z.array(recommendationBasisSchema).min(1).max(6),
  restraint_guidance: restraintGuidanceSchema,
  operator_insight: operatorInsightSchema,
  friction_pattern: z.string().trim().min(1).max(1400),
  local_reality_scout: localRealityScoutSchema,
  human_help_boundary: z.string().trim().min(1).max(1600),
  avoid_today: z.string().min(1).max(1200),
  optional_if_energy_is_high: z.string().min(1).max(1200),
  minimum_viable_day: z.string().min(1).max(1200),
  evening_review_prompt: z.string().min(1).max(1200),
});

function situationTitleField() {
  return z
    .string()
    .trim()
    .max(
      SITUATION_TITLE_MAX,
      `Situation title must be ${SITUATION_TITLE_MAX} characters or fewer.`,
    )
    .optional()
    .default("");
}

function situationDescriptionField() {
  return z
    .string()
    .trim()
    .max(
      SITUATION_DESCRIPTION_MAX,
      `Situation description must be ${SITUATION_DESCRIPTION_MAX} characters or fewer.`,
    )
    .optional()
    .default("");
}

export const situationInputSchema = z
  .object({
    title: situationTitleField(),
    description: situationDescriptionField(),
    category: z.string().trim().min(1).max(120).default("custom"),
    urgency: z.enum(SITUATION_URGENCIES).default("medium"),
  })
  .superRefine((value, ctx) => {
    if (!value.title && !value.description) {
      ctx.addIssue({
        code: "custom",
        path: ["description"],
        message: "Describe the situation before starting intake.",
      });
    }
  });

export const situationUpdateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Situation title is required.")
    .max(
      SITUATION_TITLE_MAX,
      `Situation title must be ${SITUATION_TITLE_MAX} characters or fewer.`,
    ),
  description: situationDescriptionField(),
  category: z.string().trim().min(1).max(120).default("custom"),
  urgency: z.enum(SITUATION_URGENCIES).default("medium"),
  status: z.enum(SITUATION_STATUSES).default("active"),
});

export const intakeAnswerInputSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Answer is required.")
    .max(INTAKE_ANSWER_MAX, `Answer must be ${INTAKE_ANSWER_MAX} characters or fewer.`),
  client_message_id: z.string().trim().max(120).optional().default(""),
  client_generation_id: z.string().trim().max(120).optional().default(""),
  retry_count: z.number().int().min(0).max(10).optional().default(0),
});

export const generatedInferredContextItemSchema = z.object({
  label: z.string().trim().min(1).max(MEMORY_LABEL_MAX),
  value: z.string().trim().min(1).max(MEMORY_VALUE_MAX),
  category: z.enum(INFERRED_CONTEXT_CATEGORIES),
  sensitivity: z.enum(CONSTRAINT_SENSITIVITIES),
  persistence: z.enum(INFERRED_CONTEXT_PERSISTENCE),
  source: z.enum(INFERRED_CONTEXT_SOURCES),
});

export const interviewerOutputSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  current_stage: z.enum(INTAKE_STAGES),
  is_complete: z.boolean(),
  summary_so_far: z.string().trim().max(5000).default(""),
  recommended_urgency: z.enum(SITUATION_URGENCIES).nullable(),
  recommended_mode: z.enum(NEXT_MOVE_MODES).nullable(),
  inferred_context_items: z.array(generatedInferredContextItemSchema).max(6).default([]),
});

export const inferredContextItemInputSchema = generatedInferredContextItemSchema
  .extend({
    situation_id: nullableId,
    intake_session_id: nullableId,
    next_move_plan_id: nullableId,
  })
  .partial({
    situation_id: true,
    intake_session_id: true,
    next_move_plan_id: true,
  });

export const inferredContextItemUpdateSchema = z
  .object({
    label: z.string().trim().min(1).max(MEMORY_LABEL_MAX).optional(),
    value: z.string().trim().min(1).max(MEMORY_VALUE_MAX).optional(),
    category: z.enum(INFERRED_CONTEXT_CATEGORIES).optional(),
    sensitivity: z.enum(CONSTRAINT_SENSITIVITIES).optional(),
    persistence: z.enum(INFERRED_CONTEXT_PERSISTENCE).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export const nextMoveStepSchema = z.object({
  title: z.string().trim().min(1).max(180),
  details: z.string().trim().min(1).max(3000),
});

export const contextUsedItemSchema = z.object({
  id: z.number().int().positive().nullable().optional().default(null),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(1000),
  category: z.enum(CONTEXT_USED_CATEGORIES),
  sensitivity: z.enum(CONSTRAINT_SENSITIVITIES),
  source: z.enum(CONTEXT_USED_SOURCES),
  persistence: z.enum(INFERRED_CONTEXT_PERSISTENCE),
});

export const nextMoveResourceSchema = z.object({
  name: z.string().trim().min(1).max(180),
  why: z.string().trim().min(1).max(1200),
  contact_or_url: z.string().trim().max(500).default(""),
});

export const planTaskCandidateSchema = z.object({
  title: z.string().trim().min(1).max(180),
  details: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(2000).optional().default(""),
  estimated_minutes: z.number().int().min(1).max(480).optional().default(30),
  friction_level: z.enum(["low", "medium", "high"]).optional().default("medium"),
  leverage: z.enum(["low", "medium", "high"]).optional().default("medium"),
  why_now: z.string().trim().max(900).optional().default(""),
  success_condition: z.string().trim().max(900).optional().default(""),
  category: z.string().trim().max(120).optional().default("other"),
  source_message_id: z.string().trim().max(120).nullable().optional().default(null),
  candidate_type: z.enum(PLAN_TASK_CANDIDATE_TYPES),
  importance: z.number().int().min(1).max(5),
  effort: z.number().int().min(1).max(5),
  friction_type: z.enum(TASK_FRICTION_TYPES),
  rank_reason: z.string().trim().min(1).max(900),
  due_date: optionalDate,
});

export const highestLeverageMoveSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(3000),
  estimated_minutes: z.number().int().min(1).max(480),
  success_condition: z.string().trim().min(1).max(2000),
});

export const nextMovePlanSchema = z.object({
  generation_mode: z.literal("operator_plan").default("operator_plan"),
  mode: z.enum(NEXT_MOVE_MODES),
  situation_read: z.string().trim().min(1).max(2500),
  likely_bottleneck: z.string().trim().min(1).max(1800),
  key_constraints: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  situation_summary: z.string().trim().min(1).max(2500),
  core_bottleneck: z.string().trim().min(1).max(1800),
  highest_leverage_move_today: highestLeverageMoveSchema,
  why_this_move: z.string().trim().min(1).max(2000),
  first_10_minute_action: nextMoveStepSchema,
  first_30_minutes: z.array(nextMoveStepSchema).min(1).max(5),
  next_24_hours: z.array(nextMoveStepSchema).min(1).max(7),
  next_7_days: z.array(nextMoveStepSchema).min(1).max(10),
  what_not_to_do: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  likely_trap: z.string().trim().min(1).max(1200),
  recommendation_basis: z.array(recommendationBasisSchema).min(1).max(6),
  restraint_guidance: restraintGuidanceSchema,
  operator_insight: operatorInsightSchema,
  friction_pattern: z.string().trim().min(1).max(1400),
  local_reality_scout: localRealityScoutSchema,
  resources_to_seek: z.array(nextMoveResourceSchema).max(8),
  when_to_get_human_help: z.string().trim().min(1).max(1800),
  safety_boundary: safetyBoundarySchema,
  context_used: z.array(contextUsedItemSchema).min(1).max(8),
  inferred_context_items: z.array(generatedInferredContextItemSchema).max(8),
  task_candidates: z.array(planTaskCandidateSchema).max(3),
  confidence_level: z.enum(CONFIDENCE_LEVELS),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
  follow_up_questions_if_any: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type LifeAreaInput = z.infer<typeof lifeAreaInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskFeedbackInput = z.infer<typeof taskFeedbackInputSchema>;
export type TaskRevisionInput = z.infer<typeof taskRevisionInputSchema>;
export type CheckInInput = z.infer<typeof checkInInputSchema>;
export type ContextConstraintsInput = z.infer<typeof contextConstraintsInputSchema>;
export type InferredContextItemInput = z.infer<
  typeof inferredContextItemInputSchema
>;
export type InferredContextItemUpdate = z.infer<
  typeof inferredContextItemUpdateSchema
>;
export type SituationInput = z.infer<typeof situationInputSchema>;
export type SituationUpdate = z.infer<typeof situationUpdateSchema>;
export type IntakeAnswerInput = z.infer<typeof intakeAnswerInputSchema>;
export type InterviewerOutput = z.infer<typeof interviewerOutputSchema>;
export type NextMovePlanInput = z.infer<typeof nextMovePlanSchema>;
