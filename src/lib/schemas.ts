import { z } from "zod";

import {
  CONFIDENCE_LEVELS,
  INTAKE_STAGES,
  NEXT_MOVE_MODES,
  PRIORITY_LEVELS,
  PROJECT_STATUSES,
  SAFETY_RISK_LEVELS,
  SITUATION_STATUSES,
  SITUATION_URGENCIES,
  TASK_FRICTION_TYPES,
  TASK_STATUSES,
} from "./types";

const text = (max = 4000) => z.string().trim().max(max).optional().default("");
const nullableId = z.number().int().positive().nullable().optional().default(null);
const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .nullable()
  .optional()
  .default(null);

export const profileInputSchema = z.object({
  personal_profile: text(12000),
  current_season: text(8000),
  core_priorities: text(8000),
  constraints: text(8000),
  operating_principles: text(8000),
  remember: text(12000),
  challenge_on: text(8000),
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
  title: z.string().trim().min(1, "Title is required.").max(220),
  life_area_id: nullableId,
  project_id: nullableId,
  status: z.enum(TASK_STATUSES).default("open"),
  importance: z.number().int().min(1).max(5).default(3),
  effort: z.number().int().min(1).max(5).default(3),
  friction_type: z.enum(TASK_FRICTION_TYPES).default("none"),
  friction_note: text(1200),
  due_date: optionalDate,
  notes: text(5000),
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
  professional_help_signal: z.string().trim().min(1).max(1200),
  do_not_rely_on_ai_for: z.string().trim().min(1).max(1200),
  urgent_support_guidance: z.string().trim().min(1).max(1200),
});

export const dailyPlanSchema = z.object({
  today_theme: z.string().min(1).max(220),
  honest_read: z.string().min(1).max(1800),
  top_3_actions: z.array(dailyPlanActionSchema).min(1).max(3),
  recommendation_basis: z.array(recommendationBasisSchema).min(1).max(6),
  restraint_guidance: restraintGuidanceSchema,
  friction_pattern: z.string().trim().min(1).max(1400),
  local_reality_scout: localRealityScoutSchema,
  human_help_boundary: z.string().trim().min(1).max(1600),
  avoid_today: z.string().min(1).max(1200),
  optional_if_energy_is_high: z.string().min(1).max(1200),
  minimum_viable_day: z.string().min(1).max(1200),
  evening_review_prompt: z.string().min(1).max(1200),
});

export const situationInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(180),
  category: z.string().trim().min(1).max(120).default("custom"),
  urgency: z.enum(SITUATION_URGENCIES).default("medium"),
});

export const situationUpdateSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(180),
  category: z.string().trim().min(1).max(120).default("custom"),
  urgency: z.enum(SITUATION_URGENCIES).default("medium"),
  status: z.enum(SITUATION_STATUSES).default("active"),
});

export const intakeAnswerInputSchema = z.object({
  content: z.string().trim().min(1, "Answer is required.").max(8000),
});

export const interviewerOutputSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  current_stage: z.enum(INTAKE_STAGES),
  is_complete: z.boolean(),
  summary_so_far: z.string().trim().max(5000).default(""),
  recommended_urgency: z.enum(SITUATION_URGENCIES).nullable(),
  recommended_mode: z.enum(NEXT_MOVE_MODES).nullable(),
});

export const nextMoveStepSchema = z.object({
  title: z.string().trim().min(1).max(180),
  details: z.string().trim().min(1).max(3000),
});

export const nextMoveResourceSchema = z.object({
  name: z.string().trim().min(1).max(180),
  why: z.string().trim().min(1).max(1200),
  contact_or_url: z.string().trim().max(500).default(""),
});

export const highestLeverageMoveSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(3000),
  estimated_minutes: z.number().int().min(1).max(480),
  success_condition: z.string().trim().min(1).max(2000),
});

export const nextMovePlanSchema = z.object({
  mode: z.enum(NEXT_MOVE_MODES),
  situation_summary: z.string().trim().min(1).max(2500),
  core_bottleneck: z.string().trim().min(1).max(1800),
  highest_leverage_move_today: highestLeverageMoveSchema,
  why_this_move: z.string().trim().min(1).max(2000),
  first_30_minutes: z.array(nextMoveStepSchema).min(1).max(5),
  next_24_hours: z.array(nextMoveStepSchema).min(1).max(7),
  next_7_days: z.array(nextMoveStepSchema).min(1).max(10),
  what_not_to_do: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
  likely_trap: z.string().trim().min(1).max(1200),
  recommendation_basis: z.array(recommendationBasisSchema).min(1).max(6),
  restraint_guidance: restraintGuidanceSchema,
  friction_pattern: z.string().trim().min(1).max(1400),
  local_reality_scout: localRealityScoutSchema,
  resources_to_seek: z.array(nextMoveResourceSchema).max(8),
  when_to_get_human_help: z.string().trim().min(1).max(1800),
  safety_boundary: safetyBoundarySchema,
  confidence_level: z.enum(CONFIDENCE_LEVELS),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8),
  follow_up_questions_if_any: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type LifeAreaInput = z.infer<typeof lifeAreaInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type TaskInput = z.infer<typeof taskInputSchema>;
export type CheckInInput = z.infer<typeof checkInInputSchema>;
export type SituationInput = z.infer<typeof situationInputSchema>;
export type SituationUpdate = z.infer<typeof situationUpdateSchema>;
export type IntakeAnswerInput = z.infer<typeof intakeAnswerInputSchema>;
export type InterviewerOutput = z.infer<typeof interviewerOutputSchema>;
export type NextMovePlanInput = z.infer<typeof nextMovePlanSchema>;
