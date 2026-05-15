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

export type Profile = {
  id: number;
  personal_profile: string;
  current_season: string;
  core_priorities: string;
  constraints: string;
  operating_principles: string;
  remember: string;
  challenge_on: string;
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
  status: TaskStatus;
  importance: number;
  effort: number;
  friction_type: TaskFrictionType;
  friction_note: string;
  due_date: string | null;
  notes: string;
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
  category: string;
  status: SituationStatus;
  urgency: SituationUrgency;
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
  created_at: string;
  updated_at: string;
};

export type IntakeMessage = {
  id: number;
  session_id: number;
  role: "user" | "assistant";
  content: string;
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

export type HighestLeverageMove = {
  title: string;
  description: string;
  estimated_minutes: number;
  success_condition: string;
};

export type NextMovePlan = {
  mode: NextMoveMode;
  situation_summary: string;
  core_bottleneck: string;
  highest_leverage_move_today: HighestLeverageMove;
  why_this_move: string;
  first_30_minutes: NextMoveStep[];
  next_24_hours: NextMoveStep[];
  next_7_days: NextMoveStep[];
  what_not_to_do: string[];
  likely_trap: string;
  recommendation_basis: RecommendationBasis[];
  restraint_guidance: RestraintGuidance;
  friction_pattern: string;
  local_reality_scout: LocalRealityScout;
  resources_to_seek: NextMoveResource[];
  when_to_get_human_help: string;
  safety_boundary: SafetyBoundary;
  confidence_level: ConfidenceLevel;
  assumptions: string[];
  follow_up_questions_if_any: string[];
};

export type StoredNextMovePlan = NextMovePlan & {
  id: number;
  situation_id: number;
  intake_session_id: number | null;
  model: string;
  raw_json: string;
  created_at: string;
};

export type AppConfig = {
  hasOpenAiKey: boolean;
  model: string;
  webSearchEnabled: boolean;
  webSearchContextSize: "low" | "medium" | "high";
};
