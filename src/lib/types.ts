import type { CognitiveMetadata, OutcomeValue } from "./cognitive-schemas";
export type {
  HistoricalEffectivenessContext,
  InterventionEffectivenessSummary,
  OutcomeHarnessDashboardSummary,
  OutcomeHarnessEvent,
  OutcomeHarnessEventType,
  OutcomeHarnessSource,
} from "./outcome-harness";

export const PRIORITY_LEVELS = ["low", "medium", "high"] as const;
export const PROJECT_STATUSES = ["active", "paused", "someday", "done"] as const;
export const TASK_STATUSES = ["open", "done", "ignored"] as const;
export const TASK_FRICTION_TYPES = [
  "none",
  "unclear",
  "too_large",
  "scary",
  "blocked",
  "low_energy",
  "needs_person",
  "not_important",
  "admin_drag",
] as const;
export const SITUATION_STATUSES = ["active", "resolved", "archived"] as const;
export const SITUATION_URGENCIES = ["low", "medium", "high", "crisis"] as const;
export const INTAKE_STAGES = [
  "understanding_goals",
  "understanding_constraints",
  "understanding_resources",
  "identifying_bottleneck",
  "ready_to_generate",
] as const;
export const NEXT_MOVE_MODES = [
  "growth",
  "stability",
  "crisis_triage",
  "maintenance",
] as const;
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export const SAFETY_RISK_LEVELS = ["low", "medium", "high", "crisis"] as const;
export const PLAN_TIERS = [
  "free",
  "core",
  "internal_unlimited",
  "pro",
  "sponsored",
] as const;
export const BILLING_STATUSES = [
  "none",
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
] as const;
export const USAGE_TYPES = [
  "today_checkin",
  "next_move_plan",
  "lightweight_assist",
] as const;
export const CONSTRAINT_SENSITIVITIES = ["low", "moderate", "high"] as const;
export const MEMORY_PERSISTENCE = [
  "session_only",
  "save_broad_constraint",
] as const;
export const FINANCIAL_PRESSURE_LEVELS = [
  "none",
  "manageable",
  "tight",
  "urgent",
  "crisis",
  "prefer_not_to_say",
] as const;
export const FINANCIAL_RUNWAYS = [
  "under_2_weeks",
  "2_to_4_weeks",
  "1_to_3_months",
  "3_to_6_months",
  "6_plus_months",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const MONTHLY_CASH_FLOWS = [
  "short_each_month",
  "roughly_break_even",
  "save_a_little",
  "save_comfortably",
  "irregular",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const URGENT_FINANCIAL_RISKS = [
  "housing",
  "food",
  "utilities",
  "transportation",
  "medical_costs",
  "debt_or_collections",
  "childcare",
  "none",
  "prefer_not_to_say",
] as const;
export const LOCATION_PRECISIONS = [
  "none",
  "country",
  "state_or_province",
  "city_or_metro",
  "county_or_zip",
] as const;
export const AGE_RANGES = [
  "under_18",
  "18_24",
  "25_34",
  "35_49",
  "50_64",
  "65_plus",
  "prefer_not_to_say",
] as const;
export const DOMAIN_ACCESS_LEVELS = [
  "insider_access",
  "some_access",
  "outside_the_system",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const SITUATION_SAFETY_RISKS = [
  "none",
  "possible",
  "urgent",
  "prefer_not_to_say",
] as const;
export const SOCIAL_CONNECTION_PATTERNS = [
  "connection_deficit",
  "depth_deficit",
  "transition_isolation",
  "avoidance_loop",
  "skill_or_confidence_gap",
  "environment_problem",
  "mistrust_or_safety_problem",
  "identity_or_belonging_mismatch",
  "romantic_partner_seeking",
  "sexual_partner_seeking",
  "dating_app_stuck",
  "post_breakup_rebuilding",
  "remote_work_isolation",
  "community_reentry",
  "not_sure",
] as const;
export const SOCIAL_ENERGY_LEVELS = [
  "one_tiny_action",
  "short_message_or_call",
  "one_low_pressure_event",
  "one_recurring_commitment",
  "moderate_capacity",
  "high_capacity",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const DESIRED_CONNECTION_TYPES = [
  "casual_friendship",
  "close_friendship",
  "community_belonging",
  "professional_peers",
  "creative_collaborators",
  "family_repair",
  "romantic_relationship",
  "long_term_partner",
  "dating_exploration",
  "sexual_connection",
  "queer_or_identity_aligned_community",
  "regular_human_contact",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const SOCIAL_SETTING_PREFERENCES = [
  "in_person",
  "online",
  "either",
  "structured_group",
  "one_on_one",
  "activity_based",
  "low_pressure_public_setting",
  "identity_aligned_community",
  "non_alcohol_centered",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const SOCIAL_BARRIERS = [
  "access",
  "confidence",
  "time",
  "money",
  "transportation",
  "health_or_energy",
  "fear_of_rejection",
  "not_knowing_where_to_go",
  "not_knowing_how_to_follow_up",
  "past_hurt_or_mistrust",
  "safety_concern",
  "dating_app_fatigue",
  "shame_or_embarrassment",
  "lack_of_repeated_context",
  "identity_or_belonging_mismatch",
  "none",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const DATING_INTENTIONS = [
  "long_term_relationship",
  "casual_dating",
  "sexual_connection",
  "exploring",
  "rebuilding_after_breakup",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const DATING_ENVIRONMENTS = [
  "dating_apps",
  "in_person",
  "friends_or_network",
  "hobby_or_activity_groups",
  "queer_or_identity_specific_spaces",
  "events_or_social_scenes",
  "online_communities",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const SOCIAL_CRISIS_RISKS = [
  "none",
  "possible",
  "urgent",
  "immediate_danger",
  "prefer_not_to_say",
] as const;
export const SAFE_PEOPLE_TO_CONTACT_OPTIONS = [
  "yes",
  "maybe",
  "no",
  "not_sure",
  "prefer_not_to_say",
] as const;
export const INFERRED_CONTEXT_CATEGORIES = [
  "money",
  "location",
  "time",
  "energy",
  "education_credentials",
  "access_connections",
  "support_network",
  "family_caregiving",
  "transportation",
  "deadline",
  "safety_risk",
  "age_life_stage",
  "connection_dating",
  "work_career",
  "health_recovery",
  "creative_personal_project",
  "working_style",
  "other",
] as const;
export const INFERRED_CONTEXT_PERSISTENCE = [
  "session_only",
  "proposed_memory",
  "saved_memory",
] as const;
export const INFERRED_CONTEXT_SOURCES = ["intake", "plan", "manual"] as const;
export const PLAN_TASK_CANDIDATE_TYPES = [
  "immediate_next_action",
  "follow_up",
  "supporting",
] as const;
export const CONTEXT_USED_CATEGORIES = [
  "location",
  "money",
  "time",
  "energy",
  "career",
  "education_credentials",
  "access_connections",
  "support_network",
  "relationship_social",
  "housing",
  "safety",
  "preference",
  "goal",
  "other",
] as const;
export const CONTEXT_USED_SOURCES = [
  "saved_memory",
  "session_intake",
  "situation",
  "inferred",
  "manual",
] as const;
export const GENERATION_TYPES = [
  "intake",
  "classification",
  "operator_plan",
  "task_generation",
  "memory_extraction",
] as const;
export const GENERATION_STATUSES = [
  "running",
  "success",
  "timeout",
  "canceled",
  "retry",
  "error",
] as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskFrictionType = (typeof TASK_FRICTION_TYPES)[number];
export type SituationStatus = (typeof SITUATION_STATUSES)[number];
export type SituationUrgency = (typeof SITUATION_URGENCIES)[number];
export type IntakeStage = (typeof INTAKE_STAGES)[number];
export type NextMoveMode = (typeof NEXT_MOVE_MODES)[number];
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];
export type SafetyRiskLevel = (typeof SAFETY_RISK_LEVELS)[number];
export type PlanTier = (typeof PLAN_TIERS)[number];
export type BillingStatus = (typeof BILLING_STATUSES)[number];
export type UsageType = (typeof USAGE_TYPES)[number];
export type ConstraintSensitivity = (typeof CONSTRAINT_SENSITIVITIES)[number];
export type MemoryPersistence = (typeof MEMORY_PERSISTENCE)[number];
export type FinancialPressureLevel = (typeof FINANCIAL_PRESSURE_LEVELS)[number];
export type FinancialRunway = (typeof FINANCIAL_RUNWAYS)[number];
export type MonthlyCashFlow = (typeof MONTHLY_CASH_FLOWS)[number];
export type UrgentFinancialRisk = (typeof URGENT_FINANCIAL_RISKS)[number];
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];
export type AgeRange = (typeof AGE_RANGES)[number];
export type DomainAccessLevel = (typeof DOMAIN_ACCESS_LEVELS)[number];
export type SituationSafetyRisk = (typeof SITUATION_SAFETY_RISKS)[number];
export type SocialConnectionPattern =
  (typeof SOCIAL_CONNECTION_PATTERNS)[number];
export type SocialEnergyLevel = (typeof SOCIAL_ENERGY_LEVELS)[number];
export type DesiredConnectionType = (typeof DESIRED_CONNECTION_TYPES)[number];
export type SocialSettingPreference =
  (typeof SOCIAL_SETTING_PREFERENCES)[number];
export type SocialBarrier = (typeof SOCIAL_BARRIERS)[number];
export type DatingIntention = (typeof DATING_INTENTIONS)[number];
export type DatingEnvironment = (typeof DATING_ENVIRONMENTS)[number];
export type SocialCrisisRisk = (typeof SOCIAL_CRISIS_RISKS)[number];
export type SafePeopleToContact =
  (typeof SAFE_PEOPLE_TO_CONTACT_OPTIONS)[number];
export type InferredContextCategory =
  (typeof INFERRED_CONTEXT_CATEGORIES)[number];
export type InferredContextPersistence =
  (typeof INFERRED_CONTEXT_PERSISTENCE)[number];
export type InferredContextSource =
  (typeof INFERRED_CONTEXT_SOURCES)[number];
export type PlanTaskCandidateType =
  (typeof PLAN_TASK_CANDIDATE_TYPES)[number];
export type ContextUsedCategory = (typeof CONTEXT_USED_CATEGORIES)[number];
export type ContextUsedSource = (typeof CONTEXT_USED_SOURCES)[number];
export type GenerationType = (typeof GENERATION_TYPES)[number];
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];

type PersistedConstraint<T> = {
  value?: T;
  persistence?: MemoryPersistence;
};

type PersistedMultiConstraint<T> = {
  values?: T[];
  persistence?: MemoryPersistence;
};

export type SocialConnectionContext = {
  patterns?: SocialConnectionPattern[];
  desired_connection?: PersistedMultiConstraint<DesiredConnectionType>;
  social_energy?: PersistedConstraint<SocialEnergyLevel>;
  preferred_settings?: PersistedMultiConstraint<SocialSettingPreference>;
  barriers?: PersistedMultiConstraint<SocialBarrier>;
  existing_connection_surface?: PersistedConstraint<string>;
  repeatable_contexts_available?: PersistedConstraint<string>;
  safe_people_to_contact?: PersistedConstraint<SafePeopleToContact> & {
    notes?: string;
  };
  dating_intention?: PersistedConstraint<DatingIntention>;
  dating_environment?: PersistedMultiConstraint<DatingEnvironment>;
  attraction_or_partner_preferences?: PersistedConstraint<string>;
  consent_and_safety_constraints?: {
    value?: string;
    persistence?: "session_only";
  };
  avoid_contexts?: PersistedConstraint<string>;
  crisis_or_immediate_safety_risk?: {
    value?: SocialCrisisRisk;
    persistence?: "session_only";
  };
};

export type ContextConstraints = {
  location?: PersistedConstraint<string> & {
    precision?: LocationPrecision;
  };
  age_range?: PersistedConstraint<AgeRange>;
  life_stage?: PersistedConstraint<string>;
  education_or_credentials?: PersistedConstraint<string>;
  financial_context?: {
    pressure_level?: FinancialPressureLevel;
    runway?: FinancialRunway;
    monthly_cash_flow?: MonthlyCashFlow;
    urgent_risks?: UrgentFinancialRisk[];
    persistence?: MemoryPersistence;
  };
  time_availability?: PersistedConstraint<string>;
  energy_capacity?: PersistedConstraint<string>;
  dependents_or_caregiving?: PersistedConstraint<string>;
  transportation?: PersistedConstraint<string>;
  support_network?: PersistedConstraint<string>;
  domain_access?: PersistedConstraint<DomainAccessLevel> & {
    notes?: string;
  };
  proof_or_track_record?: PersistedConstraint<string>;
  urgent_deadline?: PersistedConstraint<string>;
  safety_or_emergency_risk?: {
    value?: SituationSafetyRisk;
    persistence?: "session_only";
  };
  social_connection?: SocialConnectionContext;
  other?: PersistedConstraint<string>;
};

export type Profile = {
  id: number;
  personal_profile: string;
  current_season: string;
  core_priorities: string;
  constraints: string;
  operating_principles: string;
  remember: string;
  challenge_on: string;
  context_constraints: ContextConstraints;
  created_at: string;
  updated_at: string;
};

export type LifeArea = {
  id: number;
  name: string;
  description: string;
  priority_level: PriorityLevel;
  desired_outcome: string;
  current_bottleneck: string;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: number;
  name: string;
  life_area_id: number | null;
  life_area_name?: string | null;
  status: ProjectStatus;
  description: string;
  next_milestone: string;
  current_bottleneck: string;
  why_it_matters: string;
  created_at: string;
  updated_at: string;
};

export type Task = {
  id: number;
  title: string;
  life_area_id: number | null;
  life_area_name?: string | null;
  project_id: number | null;
  project_name?: string | null;
  situation_id?: number | null;
  situation_title?: string | null;
  source_next_move_plan_id?: number | null;
  source_plan_section?: string | null;
  situation_urgency?: SituationUrgency | null;
  rank_score?: number;
  rank_reason?: string;
  global_rank?: number;
  status: TaskStatus;
  importance: number;
  effort: number;
  friction_type: TaskFrictionType;
  friction_note: string;
  estimated_minutes?: number | null;
  due_date: string | null;
  notes: string;
  is_qa?: boolean;
  created_at: string;
  updated_at: string;
};

export type TaskConversionResponse = {
  created: boolean;
  alreadyExisted: boolean;
  items: Array<{ task: Task; globalRank: number }>;
};

export type InferredContextItem = {
  id: number;
  label: string;
  value: string;
  category: InferredContextCategory;
  sensitivity: ConstraintSensitivity;
  persistence: InferredContextPersistence;
  source: InferredContextSource;
  situation_id: number | null;
  situation_title?: string | null;
  intake_session_id: number | null;
  next_move_plan_id: number | null;
  is_qa?: boolean;
  created_at: string;
  updated_at: string;
};

export type CheckIn = {
  id: number;
  checkin_date: string;
  energy_level: number;
  mood: string;
  sleep: string;
  health_status: string;
  main_thing: string;
  resistance: string;
  brain_dump: string;
  created_at: string;
};

export type DailyPlanAction = {
  title: string;
  area: string;
  why_it_matters: string;
  estimated_minutes: number;
  success_condition: string;
  first_step: string;
};

export type RecommendationBasis = {
  signal: string;
  source: string;
  implication: string;
};

export type RestraintGuidance = {
  should_push: boolean;
  reason: string;
  minimum_viable_move: string;
  recovery_move: string;
  scope_boundary: string;
};

export type OperatorInsight = {
  naive_path: string;
  operator_path: string;
  wasted_motion_to_avoid: string;
};

export type LocalScoutFinding = {
  title: string;
  why_it_matters: string;
  source: string;
  url_or_next_search: string;
};

export type LocalRealityScout = {
  used_web_search: boolean;
  location_basis: string;
  findings: LocalScoutFinding[];
  missing_location_question: string;
};

export type SafetyBoundary = {
  risk_level: SafetyRiskLevel;
  professional_help_signal: string;
  do_not_rely_on_ai_for: string;
  urgent_support_guidance: string;
};

export type DailyPlan = {
  today_theme: string;
  honest_read: string;
  top_3_actions: DailyPlanAction[];
  recommendation_basis: RecommendationBasis[];
  restraint_guidance: RestraintGuidance;
  operator_insight: OperatorInsight;
  friction_pattern: string;
  local_reality_scout: LocalRealityScout;
  human_help_boundary: string;
  avoid_today: string;
  optional_if_energy_is_high: string;
  minimum_viable_day: string;
  evening_review_prompt: string;
};

export type StoredPlan = DailyPlan & {
  id: number;
  plan_date: string;
  checkin_id: number | null;
  model: string;
  raw_json: string;
  created_at: string;
};

export type Situation = {
  id: number;
  title: string;
  description: string;
  category: string;
  status: SituationStatus;
  urgency: SituationUrgency;
  is_qa?: boolean;
  latest_plan_id?: number | null;
  latest_plan_mode?: NextMoveMode | null;
  latest_plan_move?: string | null;
  created_at: string;
  updated_at: string;
};

export type IntakeSession = {
  id: number;
  situation_id: number;
  current_stage: IntakeStage;
  is_complete: boolean;
  summary_so_far: string;
  context_constraints: ContextConstraints;
  is_qa?: boolean;
  created_at: string;
  updated_at: string;
};

export type IntakeMessage = {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
  client_message_id?: string | null;
  is_qa?: boolean;
  created_at: string;
};

export type NextMoveStep = {
  title: string;
  details: string;
};

export type NextMoveResource = {
  name: string;
  why: string;
  contact_or_url: string;
};

export type GeneratedInferredContextItem = {
  label: string;
  value: string;
  category: InferredContextCategory;
  sensitivity: ConstraintSensitivity;
  persistence: InferredContextPersistence;
  source: InferredContextSource;
};

export type ContextUsedItem = {
  id: number | null;
  label: string;
  value: string;
  category: ContextUsedCategory;
  sensitivity: ConstraintSensitivity;
  source: ContextUsedSource;
  persistence: InferredContextPersistence;
};

export type PlanTaskCandidate = {
  title: string;
  details: string;
  description: string;
  estimated_minutes: number;
  friction_level: "low" | "medium" | "high";
  leverage: "low" | "medium" | "high";
  why_now: string;
  success_condition: string;
  category: string;
  source_message_id: string | null;
  candidate_type: PlanTaskCandidateType;
  importance: number;
  effort: number;
  friction_type: TaskFrictionType;
  rank_reason: string;
  due_date: string | null;
};

export type HighestLeverageMove = {
  title: string;
  description: string;
  estimated_minutes: number;
  success_condition: string;
};

export type NextMovePlan = {
  generation_mode: "operator_plan";
  mode: NextMoveMode;
  situation_read: string;
  likely_bottleneck: string;
  key_constraints: string[];
  situation_summary: string;
  core_bottleneck: string;
  highest_leverage_move_today: HighestLeverageMove;
  why_this_move: string;
  first_10_minute_action: NextMoveStep;
  first_30_minutes: NextMoveStep[];
  next_24_hours: NextMoveStep[];
  next_7_days: NextMoveStep[];
  what_not_to_do: string[];
  likely_trap: string;
  recommendation_basis: RecommendationBasis[];
  restraint_guidance: RestraintGuidance;
  operator_insight: OperatorInsight;
  friction_pattern: string;
  local_reality_scout: LocalRealityScout;
  resources_to_seek: NextMoveResource[];
  when_to_get_human_help: string;
  safety_boundary: SafetyBoundary;
  context_used: ContextUsedItem[];
  inferred_context_items: GeneratedInferredContextItem[];
  task_candidates: PlanTaskCandidate[];
  confidence_level: ConfidenceLevel;
  assumptions: string[];
  follow_up_questions_if_any: string[];
};

export type StoredNextMovePlan = NextMovePlan & {
  id: number;
  situation_id: number;
  intake_session_id: number | null;
  model: string;
  cognitive_metadata: CognitiveMetadata | null;
  raw_json: string;
  is_qa?: boolean;
  created_at: string;
};

export type GenerationEvent = {
  id: number;
  user_id?: number;
  client_generation_id: string;
  situation_id: number | null;
  generation_type: GenerationType;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: GenerationStatus;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  state_detected?: string | null;
  intervention_type?: string | null;
  model_used_by_stage_json?: string | null;
  prompt_tokens_by_stage_json?: string | null;
  completion_tokens_by_stage_json?: string | null;
  evaluator_score?: number | null;
  response_rewritten?: boolean;
  tasks_created_count?: number | null;
  memory_items_used?: number | null;
  web_search_used?: boolean;
  outcome_harness_context_included?: boolean;
  historical_effectiveness_influenced_intervention?: boolean;
  cognitive_metadata_json?: string | null;
  retry_count: number;
  error_category: string | null;
  is_qa: boolean;
  created_at: string;
  updated_at: string;
};

export type OutcomeRecord = {
  id: string;
  source_message_id: number | null;
  conversation_id: string | null;
  next_move_plan_id: number | null;
  detected_state: string;
  intervention_type: string;
  recommended_action: string | null;
  task_ids_created: number[];
  user_outcome: OutcomeValue;
  evidence: string;
  followup_at: string | null;
  notes: string;
  is_qa?: boolean;
  created_at: string;
  updated_at: string;
};

export type AppConfig = {
  hasOpenAiKey: boolean;
  model: string;
  modelRouting?: Record<string, string>;
  webSearchEnabled: boolean;
  webSearchContextSize: "low" | "medium" | "high";
};

export type UsageLimit = number | null;

export type UsageSummaryItem = {
  usage_type: UsageType;
  used: number;
  limit: UsageLimit;
  remaining: UsageLimit;
};

export type BillingSummary = {
  plan_tier: PlanTier;
  billing_status: BillingStatus;
  internal_unlimited: boolean;
  is_guest: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  usage_period_start: string;
  usage_period_end: string;
  stripe_customer_id: string | null;
  usage: UsageSummaryItem[];
  upgrade_message: string;
  core_price_cents: number;
};
