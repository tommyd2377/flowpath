import { z } from "zod";

export const FLOWPATH_STATES = [
  "execution_mode",
  "planning_mode",
  "research_mode",
  "rumination_mode",
  "anxiety_mode",
  "creative_mode",
  "product_strategy_mode",
  "coding_mode",
  "social_real_world_mode",
  "health_caution_mode",
  "legal_financial_caution_mode",
  "unclear_mode",
] as const;

export const INTERVENTION_TYPES = [
  "direct_answer",
  "concise_execution_plan",
  "reality_check",
  "emotional_stabilization",
  "research_then_synthesize",
  "creative_feedback",
  "code_architecture",
  "step_by_step_debugging",
  "task_breakdown",
  "one_next_action",
  "challenge_assumption",
  "stop_rumination_redirect_to_action",
  "ask_one_clarifying_question",
  "safety_boundary",
  "financial_or_legal_caution",
  "health_caution",
] as const;

export const OUTCOME_VALUES = [
  "unknown",
  "acted",
  "deferred",
  "rejected",
  "spiraled",
  "improved",
  "worsened",
  "needs_followup",
] as const;

export const frictionLevels = ["low", "medium", "high"] as const;
export const leverageLevels = ["low", "medium", "high"] as const;

export type FlowPathState = (typeof FLOWPATH_STATES)[number];
export type InterventionType = (typeof INTERVENTION_TYPES)[number];
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];

export const stateDetectionSchema = z.object({
  primary_state: z.enum(FLOWPATH_STATES),
  secondary_states: z.array(z.enum(FLOWPATH_STATES)).max(5),
  confidence: z.number().min(0).max(1),
  user_intent: z.string().trim().min(1).max(500),
  emotional_temperature: z.enum(["low", "medium", "high"]),
  action_readiness: z.enum(["low", "medium", "high"]),
  risk_flags: z.array(z.string().trim().min(1).max(120)).max(8),
  needs_web_search: z.boolean(),
  needs_memory: z.boolean(),
  needs_task_creation: z.boolean(),
  needs_escalation: z.boolean(),
  recommended_intervention: z.string().trim().min(1).max(160),
  reasoning_summary: z.string().trim().min(1).max(900),
});

export type StateDetection = z.infer<typeof stateDetectionSchema>;

export const interventionSelectionSchema = z.object({
  intervention_type: z.enum(INTERVENTION_TYPES),
  response_length: z.enum(["short", "medium", "long"]),
  tone: z.enum(["direct", "calm", "challenging", "supportive", "clinical", "creative"]),
  should_create_tasks: z.boolean(),
  max_tasks: z.number().int().min(0).max(3),
  should_ask_question: z.boolean(),
  question_if_needed: z.string().trim().max(500).nullable(),
  must_include: z.array(z.string().trim().min(1).max(300)).max(8),
  must_avoid: z.array(z.string().trim().min(1).max(300)).max(8),
  success_criteria: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
});

export type InterventionSelection = z.infer<typeof interventionSelectionSchema>;

export const selectedMemoryItemSchema = z.object({
  id: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(600),
  relevance: z.number().min(0).max(1),
  sensitivity: z.enum(["low", "medium", "high"]),
  reason: z.string().trim().min(1).max(400),
});

export const memorySelectionSchema = z.object({
  selected_memories: z.array(selectedMemoryItemSchema).max(8),
  excluded_memory_reasoning: z.string().trim().max(1000),
  context_budget_used: z.number().int().min(0),
});

export type MemorySelection = z.infer<typeof memorySelectionSchema>;
export type SelectedMemoryItem = z.infer<typeof selectedMemoryItemSchema>;

export const cognitiveTaskCandidateSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().min(1).max(2000),
  estimated_minutes: z.number().int().min(1).max(480),
  friction_level: z.enum(frictionLevels),
  leverage: z.enum(leverageLevels),
  why_now: z.string().trim().min(1).max(900),
  success_condition: z.string().trim().min(1).max(900),
  category: z.string().trim().min(1).max(120),
  source_message_id: z.string().trim().max(120).nullable(),
});

export type CognitiveTaskCandidate = z.infer<typeof cognitiveTaskCandidateSchema>;

export const responseEvaluatorSchema = z.object({
  passes: z.boolean(),
  score: z.number().min(0).max(1),
  problems: z.array(z.string().trim().min(1).max(300)).max(10),
  missing_elements: z.array(z.string().trim().min(1).max(300)).max(10),
  too_generic: z.boolean(),
  too_long: z.boolean(),
  too_abstract: z.boolean(),
  missed_memory: z.boolean(),
  missed_next_action: z.boolean(),
  unsafe_or_overconfident: z.boolean(),
  rewrite_instructions: z.array(z.string().trim().min(1).max(500)).max(8),
});

export type ResponseEvaluatorOutput = z.infer<typeof responseEvaluatorSchema>;

export const webSearchDecisionSchema = z.object({
  should_use_web_search: z.boolean(),
  reason: z.string().trim().min(1).max(700),
  triggers: z.array(z.string().trim().min(1).max(120)).max(8),
  blocked_by_policy: z.boolean(),
});

export type WebSearchDecision = z.infer<typeof webSearchDecisionSchema>;

export const cognitiveStageTelemetrySchema = z.object({
  state_detected: z.enum(FLOWPATH_STATES),
  intervention_type: z.enum(INTERVENTION_TYPES),
  model_used_by_stage: z.record(z.string(), z.string()),
  prompt_tokens_by_stage: z.record(z.string(), z.number().int().min(0)),
  completion_tokens_by_stage: z.record(z.string(), z.number().int().min(0)),
  total_estimated_cost: z.number().min(0).nullable(),
  evaluator_score: z.number().min(0).max(1).nullable(),
  response_rewritten: z.boolean(),
  tasks_created_count: z.number().int().min(0).max(3),
  memory_items_used: z.number().int().min(0).max(8),
  web_search_used: z.boolean(),
});

export type CognitiveStageTelemetry = z.infer<typeof cognitiveStageTelemetrySchema>;

export const cognitiveMetadataSchema = z.object({
  state_detection: stateDetectionSchema,
  intervention: interventionSelectionSchema,
  memory_selection: memorySelectionSchema,
  web_search: webSearchDecisionSchema,
  evaluator: responseEvaluatorSchema.nullable(),
  repeated_topic: z.boolean(),
  web_search_used: z.boolean(),
  web_search_reason: z.string().trim().max(700),
  response_rewritten: z.boolean(),
  model_used_by_stage: z.record(z.string(), z.string()),
  prompt_tokens_by_stage: z.record(z.string(), z.number().int().min(0)),
  completion_tokens_by_stage: z.record(z.string(), z.number().int().min(0)),
  total_estimated_cost: z.number().min(0).nullable(),
});

export type CognitiveMetadata = z.infer<typeof cognitiveMetadataSchema>;
