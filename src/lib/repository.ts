import { all, first, insert, run } from "./db";
import type {
  CheckIn,
  DailyPlan,
  HighestLeverageMove,
  IntakeMessage,
  IntakeSession,
  LifeArea,
  LocalRealityScout,
  Profile,
  Project,
  RecommendationBasis,
  RestraintGuidance,
  SafetyBoundary,
  Situation,
  StoredPlan,
  StoredNextMovePlan,
  Task,
} from "./types";
import type {
  CheckInInput,
  InterviewerOutput,
  LifeAreaInput,
  NextMovePlanInput,
  ProfileInput,
  ProjectInput,
  SituationInput,
  SituationUpdate,
  TaskInput,
} from "./schemas";
import { nowIso, todayIsoDate } from "./time";

const defaultProfile: Profile = {
  id: 1,
  personal_profile:
    "Paste durable context about yourself, where you live or the places you need local advice for, your work, your health, your creative projects, your acting pipeline, your goals, and your constraints here.",
  current_season:
    "Describe the season you are in: building, recovering, distributing, training, exploring, simplifying, or something else.",
  core_priorities:
    "List the few outcomes that should matter most over the next 30-90 days.",
  constraints:
    "Name time, energy, health, financial, logistical, and emotional constraints the app should respect.",
  operating_principles:
    "Add principles like: choose leverage over volume, ship small, protect health, do not hide inside planning.",
  remember:
    "Add details FlowPath should keep in mind. The app cannot see ChatGPT memories unless you paste context here.",
  challenge_on:
    "Add patterns you want FlowPath to challenge, like avoidance, over-planning, or over-scoping.",
  created_at: nowIso(),
  updated_at: nowIso(),
};

const defaultRecommendationBasis: RecommendationBasis[] = [];

const defaultDailyRestraintGuidance: RestraintGuidance = {
  should_push: true,
  reason: "This plan was created before restraint guidance was stored.",
  minimum_viable_move: "Do the smallest useful version of the top action.",
  recovery_move: "Protect basic recovery before adding more work.",
  scope_boundary: "Do not expand the plan beyond today.",
};

const defaultNextMoveRestraintGuidance: RestraintGuidance = {
  should_push: true,
  reason: "This plan was created before restraint guidance was stored.",
  minimum_viable_move: "Do the smallest useful version of the highest-leverage move.",
  recovery_move: "Protect basic recovery before adding more work.",
  scope_boundary: "Do not expand the plan beyond the current situation.",
};

const defaultLocalRealityScout: LocalRealityScout = {
  used_web_search: false,
  location_basis: "",
  findings: [],
  missing_location_question: "",
};

const defaultSafetyBoundary: SafetyBoundary = {
  risk_level: "low",
  professional_help_signal:
    "Use appropriate human or professional help when the situation exceeds planning support.",
  do_not_rely_on_ai_for:
    "Do not rely on FlowPath for legal, medical, financial, emergency, or crisis decisions.",
  urgent_support_guidance:
    "If there is immediate danger, contact local emergency services or a trusted person nearby now.",
};

export async function getProfile(): Promise<Profile> {
  return (
    (await first<Profile>("SELECT * FROM profile WHERE id = 1")) ?? defaultProfile
  );
}

export async function updateProfile(input: ProfileInput): Promise<Profile> {
  const now = nowIso();
  await run(
    `INSERT INTO profile (
      id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, created_at, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      personal_profile = excluded.personal_profile,
      current_season = excluded.current_season,
      core_priorities = excluded.core_priorities,
      constraints = excluded.constraints,
      operating_principles = excluded.operating_principles,
      remember = excluded.remember,
      challenge_on = excluded.challenge_on,
      updated_at = excluded.updated_at`,
    [
      input.personal_profile,
      input.current_season,
      input.core_priorities,
      input.constraints,
      input.operating_principles,
      input.remember,
      input.challenge_on,
      now,
      now,
    ],
  );
  return getProfile();
}

export async function listLifeAreas(): Promise<LifeArea[]> {
  return all<LifeArea>(
    `SELECT * FROM life_areas
    ORDER BY
      CASE priority_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      name COLLATE NOCASE`,
  );
}

export async function getLifeArea(id: number): Promise<LifeArea | null> {
  return first<LifeArea>("SELECT * FROM life_areas WHERE id = ?", [id]);
}

export async function createLifeArea(input: LifeAreaInput): Promise<LifeArea> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO life_areas (
      name, description, priority_level, desired_outcome, current_bottleneck, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.description,
      input.priority_level,
      input.desired_outcome,
      input.current_bottleneck,
      now,
      now,
    ],
  );
  const created = await getLifeArea(id);
  if (!created) throw new Error("Created life area could not be loaded.");
  return created;
}

export async function updateLifeArea(
  id: number,
  input: LifeAreaInput,
): Promise<LifeArea | null> {
  await run(
    `UPDATE life_areas SET
      name = ?,
      description = ?,
      priority_level = ?,
      desired_outcome = ?,
      current_bottleneck = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      input.name,
      input.description,
      input.priority_level,
      input.desired_outcome,
      input.current_bottleneck,
      nowIso(),
      id,
    ],
  );
  return getLifeArea(id);
}

export async function deleteLifeArea(id: number) {
  const result = await run("DELETE FROM life_areas WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}

export async function listProjects(): Promise<Project[]> {
  return all<Project>(
    `SELECT projects.*, life_areas.name AS life_area_name
    FROM projects
    LEFT JOIN life_areas ON life_areas.id = projects.life_area_id
    ORDER BY
      CASE projects.status
        WHEN 'active' THEN 1
        WHEN 'paused' THEN 2
        WHEN 'someday' THEN 3
        ELSE 4
      END,
      projects.name COLLATE NOCASE`,
  );
}

export async function getProject(id: number): Promise<Project | null> {
  return first<Project>(
    `SELECT projects.*, life_areas.name AS life_area_name
    FROM projects
    LEFT JOIN life_areas ON life_areas.id = projects.life_area_id
    WHERE projects.id = ?`,
    [id],
  );
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO projects (
      name, life_area_id, status, description, next_milestone,
      current_bottleneck, why_it_matters, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.life_area_id,
      input.status,
      input.description,
      input.next_milestone,
      input.current_bottleneck,
      input.why_it_matters,
      now,
      now,
    ],
  );
  const created = await getProject(id);
  if (!created) throw new Error("Created project could not be loaded.");
  return created;
}

export async function updateProject(
  id: number,
  input: ProjectInput,
): Promise<Project | null> {
  await run(
    `UPDATE projects SET
      name = ?,
      life_area_id = ?,
      status = ?,
      description = ?,
      next_milestone = ?,
      current_bottleneck = ?,
      why_it_matters = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      input.name,
      input.life_area_id,
      input.status,
      input.description,
      input.next_milestone,
      input.current_bottleneck,
      input.why_it_matters,
      nowIso(),
      id,
    ],
  );
  return getProject(id);
}

export async function deleteProject(id: number) {
  const result = await run("DELETE FROM projects WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}

export async function listTasks(): Promise<Task[]> {
  return all<Task>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas ON life_areas.id = tasks.life_area_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN situations ON situations.id = tasks.situation_id
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.effort ASC,
      tasks.created_at DESC`,
  );
}

export async function getTask(id: number): Promise<Task | null> {
  return first<Task>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas ON life_areas.id = tasks.life_area_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN situations ON situations.id = tasks.situation_id
    WHERE tasks.id = ?`,
    [id],
  );
}

export async function createTask(input: TaskInput): Promise<Task> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO tasks (
      title, life_area_id, project_id, status, importance, effort,
      friction_type, friction_note, due_date, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title,
      input.life_area_id,
      input.project_id,
      input.status,
      input.importance,
      input.effort,
      input.friction_type,
      input.friction_note,
      input.due_date || null,
      input.notes,
      now,
      now,
    ],
  );
  const created = await getTask(id);
  if (!created) throw new Error("Created task could not be loaded.");
  return created;
}

export async function updateTask(id: number, input: TaskInput): Promise<Task | null> {
  await run(
    `UPDATE tasks SET
      title = ?,
      life_area_id = ?,
      project_id = ?,
      status = ?,
      importance = ?,
      effort = ?,
      friction_type = ?,
      friction_note = ?,
      due_date = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      input.title,
      input.life_area_id,
      input.project_id,
      input.status,
      input.importance,
      input.effort,
      input.friction_type,
      input.friction_note,
      input.due_date || null,
      input.notes,
      nowIso(),
      id,
    ],
  );
  return getTask(id);
}

export async function deleteTask(id: number) {
  const result = await run("DELETE FROM tasks WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}

export async function createCheckIn(input: CheckInInput): Promise<CheckIn> {
  const id = await insert(
    `INSERT INTO checkins (
      checkin_date, energy_level, mood, sleep, health_status,
      main_thing, resistance, brain_dump, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      todayIsoDate(),
      input.energy_level,
      input.mood,
      input.sleep,
      input.health_status,
      input.main_thing,
      input.resistance,
      input.brain_dump,
      nowIso(),
    ],
  );
  const created = await first<CheckIn>("SELECT * FROM checkins WHERE id = ?", [id]);
  if (!created) throw new Error("Created check-in could not be loaded.");
  return created;
}

export async function listCheckIns(limit = 30): Promise<CheckIn[]> {
  return all<CheckIn>(
    `SELECT * FROM checkins
    ORDER BY checkin_date DESC, created_at DESC
    LIMIT ?`,
    [limit],
  );
}

export async function getLatestCheckInForDate(date = todayIsoDate()) {
  return first<CheckIn>(
    `SELECT * FROM checkins
    WHERE checkin_date = ?
    ORDER BY created_at DESC
    LIMIT 1`,
    [date],
  );
}

type StoredPlanRow = Omit<
  StoredPlan,
  | "top_3_actions"
  | "recommendation_basis"
  | "restraint_guidance"
  | "local_reality_scout"
> & {
  top_3_actions_json: string;
  recommendation_basis_json?: string | null;
  restraint_guidance_json?: string | null;
  local_reality_scout_json?: string | null;
};

function parseActions(value: string | null | undefined) {
  return parseJson(value, []);
}

function rowToStoredPlan(row: StoredPlanRow): StoredPlan {
  return {
    id: row.id,
    plan_date: row.plan_date,
    checkin_id: row.checkin_id,
    model: row.model,
    today_theme: row.today_theme,
    honest_read: row.honest_read,
    top_3_actions: parseActions(row.top_3_actions_json),
    recommendation_basis: parseJson(
      row.recommendation_basis_json,
      defaultRecommendationBasis,
    ),
    restraint_guidance: parseJson(
      row.restraint_guidance_json,
      defaultDailyRestraintGuidance,
    ),
    friction_pattern:
      row.friction_pattern || "No friction pattern was stored for this older plan.",
    local_reality_scout: parseJson(
      row.local_reality_scout_json,
      defaultLocalRealityScout,
    ),
    human_help_boundary:
      row.human_help_boundary ||
      "Use appropriate human, professional, or emergency help when the situation exceeds planning support.",
    avoid_today: row.avoid_today,
    optional_if_energy_is_high: row.optional_if_energy_is_high,
    minimum_viable_day: row.minimum_viable_day,
    evening_review_prompt: row.evening_review_prompt,
    raw_json: row.raw_json,
    created_at: row.created_at,
  };
}

export async function createPlan(
  plan: DailyPlan,
  model: string,
  checkinId: number | null,
): Promise<StoredPlan> {
  const rawJson = JSON.stringify(plan);
  const id = await insert(
    `INSERT INTO plans (
      plan_date, checkin_id, model, today_theme, honest_read, top_3_actions_json,
      recommendation_basis_json, restraint_guidance_json, friction_pattern,
      local_reality_scout_json, human_help_boundary, avoid_today,
      optional_if_energy_is_high, minimum_viable_day, evening_review_prompt,
      raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      todayIsoDate(),
      checkinId,
      model,
      plan.today_theme,
      plan.honest_read,
      JSON.stringify(plan.top_3_actions),
      JSON.stringify(plan.recommendation_basis),
      JSON.stringify(plan.restraint_guidance),
      plan.friction_pattern,
      JSON.stringify(plan.local_reality_scout),
      plan.human_help_boundary,
      plan.avoid_today,
      plan.optional_if_energy_is_high,
      plan.minimum_viable_day,
      plan.evening_review_prompt,
      rawJson,
      nowIso(),
    ],
  );
  const created = await getPlan(id);
  if (!created) throw new Error("Created plan could not be loaded.");
  return created;
}

export async function getPlan(id: number): Promise<StoredPlan | null> {
  const row = await first<StoredPlanRow>("SELECT * FROM plans WHERE id = ?", [id]);
  return row ? rowToStoredPlan(row) : null;
}

export async function listPlans(limit = 20): Promise<StoredPlan[]> {
  const rows = await all<StoredPlanRow>(
    `SELECT * FROM plans
    ORDER BY plan_date DESC, created_at DESC
    LIMIT ?`,
    [limit],
  );
  return rows.map(rowToStoredPlan);
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToIntakeSession(row: Omit<IntakeSession, "is_complete"> & { is_complete: number }) {
  return {
    ...row,
    is_complete: Boolean(row.is_complete),
  };
}

export async function listSituations(status?: string): Promise<Situation[]> {
  const where = status ? "WHERE situations.status = ?" : "";
  return all<Situation>(
    `SELECT
      situations.*,
      latest_plan.id AS latest_plan_id,
      latest_plan.mode AS latest_plan_mode,
      json_extract(latest_plan.highest_leverage_move_json, '$.title') AS latest_plan_move
    FROM situations
    LEFT JOIN next_move_plans latest_plan ON latest_plan.id = (
      SELECT id FROM next_move_plans
      WHERE situation_id = situations.id
      ORDER BY created_at DESC
      LIMIT 1
    )
    ${where}
    ORDER BY
      CASE situations.status WHEN 'active' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
      CASE situations.urgency WHEN 'crisis' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      situations.updated_at DESC`,
    status ? [status] : undefined,
  );
}

export async function getSituation(id: number): Promise<Situation | null> {
  return first<Situation>(
    `SELECT
      situations.*,
      latest_plan.id AS latest_plan_id,
      latest_plan.mode AS latest_plan_mode,
      json_extract(latest_plan.highest_leverage_move_json, '$.title') AS latest_plan_move
    FROM situations
    LEFT JOIN next_move_plans latest_plan ON latest_plan.id = (
      SELECT id FROM next_move_plans
      WHERE situation_id = situations.id
      ORDER BY created_at DESC
      LIMIT 1
    )
    WHERE situations.id = ?`,
    [id],
  );
}

export async function createSituation(input: SituationInput): Promise<Situation> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO situations (title, category, status, urgency, created_at, updated_at)
    VALUES (?, ?, 'active', ?, ?, ?)`,
    [input.title, input.category, input.urgency, now, now],
  );
  const situation = await getSituation(id);
  if (!situation) throw new Error("Created situation could not be loaded.");
  return situation;
}

export async function updateSituation(
  id: number,
  input: SituationUpdate,
): Promise<Situation | null> {
  await run(
    `UPDATE situations SET
      title = ?,
      category = ?,
      urgency = ?,
      status = ?,
      updated_at = ?
    WHERE id = ?`,
    [input.title, input.category, input.urgency, input.status, nowIso(), id],
  );
  return getSituation(id);
}

export async function deleteSituation(id: number) {
  const situation = await getSituation(id);
  if (!situation) return false;

  await run(
    `DELETE FROM tasks
    WHERE situation_id = ?
      OR source_next_move_plan_id IN (
        SELECT id FROM next_move_plans WHERE situation_id = ?
      )`,
    [id, id],
  );

  const result = await run("DELETE FROM situations WHERE id = ?", [id]);
  return result.rowsAffected > 0;
}

export async function touchSituation(id: number) {
  await run("UPDATE situations SET updated_at = ? WHERE id = ?", [nowIso(), id]);
}

export async function getOrCreateIntakeSession(
  situationId: number,
): Promise<IntakeSession> {
  const existing = await first<
    Omit<IntakeSession, "is_complete"> & { is_complete: number }
  >(
    `SELECT * FROM intake_sessions
    WHERE situation_id = ? AND is_complete = 0
    ORDER BY updated_at DESC
    LIMIT 1`,
    [situationId],
  );

  if (existing) return rowToIntakeSession(existing);

  const now = nowIso();
  const id = await insert(
    `INSERT INTO intake_sessions (
      situation_id, current_stage, is_complete, summary_so_far, created_at, updated_at
    ) VALUES (?, 'understanding_goals', 0, '', ?, ?)`,
    [situationId, now, now],
  );
  const created = await getIntakeSession(id);
  if (!created) throw new Error("Created intake session could not be loaded.");
  return created;
}

export async function getIntakeSession(id: number): Promise<IntakeSession | null> {
  const row = await first<
    Omit<IntakeSession, "is_complete"> & { is_complete: number }
  >("SELECT * FROM intake_sessions WHERE id = ?", [id]);
  return row ? rowToIntakeSession(row) : null;
}

export async function getLatestIntakeSession(
  situationId: number,
): Promise<IntakeSession | null> {
  const row = await first<
    Omit<IntakeSession, "is_complete"> & { is_complete: number }
  >(
    `SELECT * FROM intake_sessions
    WHERE situation_id = ?
    ORDER BY updated_at DESC
    LIMIT 1`,
    [situationId],
  );
  return row ? rowToIntakeSession(row) : null;
}

export async function updateIntakeSession(
  id: number,
  output: Pick<InterviewerOutput, "current_stage" | "is_complete" | "summary_so_far">,
): Promise<IntakeSession | null> {
  await run(
    `UPDATE intake_sessions SET
      current_stage = ?,
      is_complete = ?,
      summary_so_far = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      output.current_stage,
      output.is_complete ? 1 : 0,
      output.summary_so_far,
      nowIso(),
      id,
    ],
  );
  return getIntakeSession(id);
}

export async function listIntakeMessages(sessionId: number): Promise<IntakeMessage[]> {
  return all<IntakeMessage>(
    `SELECT * FROM intake_messages
    WHERE session_id = ?
    ORDER BY created_at ASC, id ASC`,
    [sessionId],
  );
}

export async function addIntakeMessage(
  sessionId: number,
  role: IntakeMessage["role"],
  content: string,
): Promise<IntakeMessage> {
  const id = await insert(
    `INSERT INTO intake_messages (session_id, role, content, created_at)
    VALUES (?, ?, ?, ?)`,
    [sessionId, role, content, nowIso()],
  );
  const message = await first<IntakeMessage>(
    "SELECT * FROM intake_messages WHERE id = ?",
    [id],
  );
  if (!message) throw new Error("Created intake message could not be loaded.");
  return message;
}

type NextMovePlanRow = Omit<
  StoredNextMovePlan,
  | "highest_leverage_move_today"
  | "first_30_minutes"
  | "next_24_hours"
  | "next_7_days"
  | "what_not_to_do"
  | "recommendation_basis"
  | "restraint_guidance"
  | "local_reality_scout"
  | "resources_to_seek"
  | "safety_boundary"
  | "assumptions"
  | "follow_up_questions_if_any"
> & {
  highest_leverage_move_json: string;
  first_30_minutes_json: string;
  next_24_hours_json: string;
  next_7_days_json: string;
  what_not_to_do_json: string;
  recommendation_basis_json?: string | null;
  restraint_guidance_json?: string | null;
  local_reality_scout_json?: string | null;
  resources_to_seek_json: string;
  safety_boundary_json?: string | null;
  assumptions_json: string;
  follow_up_questions_json: string;
};

function rowToNextMovePlan(row: NextMovePlanRow): StoredNextMovePlan {
  const defaultMove: HighestLeverageMove = {
    title: "",
    description: "",
    estimated_minutes: 30,
    success_condition: "",
  };

  return {
    id: row.id,
    situation_id: row.situation_id,
    intake_session_id: row.intake_session_id,
    model: row.model,
    mode: row.mode,
    situation_summary: row.situation_summary,
    core_bottleneck: row.core_bottleneck,
    highest_leverage_move_today: parseJson(row.highest_leverage_move_json, defaultMove),
    why_this_move: row.why_this_move,
    first_30_minutes: parseJson(row.first_30_minutes_json, []),
    next_24_hours: parseJson(row.next_24_hours_json, []),
    next_7_days: parseJson(row.next_7_days_json, []),
    what_not_to_do: parseJson(row.what_not_to_do_json, []),
    likely_trap: row.likely_trap,
    recommendation_basis: parseJson(
      row.recommendation_basis_json,
      defaultRecommendationBasis,
    ),
    restraint_guidance: parseJson(
      row.restraint_guidance_json,
      defaultNextMoveRestraintGuidance,
    ),
    friction_pattern:
      row.friction_pattern || "No friction pattern was stored for this older plan.",
    local_reality_scout: parseJson(
      row.local_reality_scout_json,
      defaultLocalRealityScout,
    ),
    resources_to_seek: parseJson(row.resources_to_seek_json, []),
    when_to_get_human_help: row.when_to_get_human_help,
    safety_boundary: parseJson(row.safety_boundary_json, defaultSafetyBoundary),
    confidence_level: row.confidence_level,
    assumptions: parseJson(row.assumptions_json, []),
    follow_up_questions_if_any: parseJson(row.follow_up_questions_json, []),
    raw_json: row.raw_json,
    created_at: row.created_at,
  };
}

export async function createNextMovePlan(
  situationId: number,
  sessionId: number | null,
  plan: NextMovePlanInput,
  model: string,
): Promise<StoredNextMovePlan> {
  const id = await insert(
    `INSERT INTO next_move_plans (
      situation_id, intake_session_id, model, mode, situation_summary, core_bottleneck,
      highest_leverage_move_json, why_this_move, first_30_minutes_json,
      next_24_hours_json, next_7_days_json, what_not_to_do_json, likely_trap,
      recommendation_basis_json, restraint_guidance_json, friction_pattern,
      local_reality_scout_json, resources_to_seek_json, when_to_get_human_help,
      safety_boundary_json, confidence_level, assumptions_json,
      follow_up_questions_json, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      situationId,
      sessionId,
      model,
      plan.mode,
      plan.situation_summary,
      plan.core_bottleneck,
      JSON.stringify(plan.highest_leverage_move_today),
      plan.why_this_move,
      JSON.stringify(plan.first_30_minutes),
      JSON.stringify(plan.next_24_hours),
      JSON.stringify(plan.next_7_days),
      JSON.stringify(plan.what_not_to_do),
      plan.likely_trap,
      JSON.stringify(plan.recommendation_basis),
      JSON.stringify(plan.restraint_guidance),
      plan.friction_pattern,
      JSON.stringify(plan.local_reality_scout),
      JSON.stringify(plan.resources_to_seek),
      plan.when_to_get_human_help,
      JSON.stringify(plan.safety_boundary),
      plan.confidence_level,
      JSON.stringify(plan.assumptions),
      JSON.stringify(plan.follow_up_questions_if_any),
      JSON.stringify(plan),
      nowIso(),
    ],
  );
  await touchSituation(situationId);
  const created = await getNextMovePlan(id);
  if (!created) throw new Error("Created next move plan could not be loaded.");
  return created;
}

export async function getNextMovePlan(id: number): Promise<StoredNextMovePlan | null> {
  const row = await first<
    Parameters<typeof rowToNextMovePlan>[0]
  >("SELECT * FROM next_move_plans WHERE id = ?", [id]);
  return row ? rowToNextMovePlan(row) : null;
}

export async function getLatestNextMovePlan(
  situationId?: number,
): Promise<StoredNextMovePlan | null> {
  const row = await first<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    ${situationId ? "WHERE situation_id = ?" : ""}
    ORDER BY created_at DESC
    LIMIT 1`,
    situationId ? [situationId] : undefined,
  );
  return row ? rowToNextMovePlan(row) : null;
}

export async function listNextMovePlans(
  limit = 20,
  situationId?: number,
): Promise<StoredNextMovePlan[]> {
  const rows = await all<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    ${situationId ? "WHERE situation_id = ?" : ""}
    ORDER BY created_at DESC
    LIMIT ?`,
    situationId ? [situationId, limit] : [limit],
  );
  return rows.map(rowToNextMovePlan);
}

export async function listTasksForSituation(situationId: number): Promise<Task[]> {
  return all<Task>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas ON life_areas.id = tasks.life_area_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN situations ON situations.id = tasks.situation_id
    WHERE tasks.situation_id = ?
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.created_at DESC`,
    [situationId],
  );
}

export async function createTasksFromNextMovePlan(planId: number): Promise<Task[]> {
  const existing = await all<Task>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas ON life_areas.id = tasks.life_area_id
    LEFT JOIN projects ON projects.id = tasks.project_id
    LEFT JOIN situations ON situations.id = tasks.situation_id
    WHERE source_next_move_plan_id = ?
    ORDER BY created_at ASC`,
    [planId],
  );
  if (existing.length > 0) return existing;

  const plan = await getNextMovePlan(planId);
  if (!plan) throw new Error("Plan not found.");

  const now = nowIso();
  const taskRows = [
    ...plan.first_30_minutes.map((step) => ({
      ...step,
      section: "first_30_minutes",
      importance: 5,
      effort: 1,
    })),
    ...plan.next_24_hours.map((step) => ({
      ...step,
      section: "next_24_hours",
      importance: 4,
      effort: 2,
    })),
    ...plan.next_7_days.map((step) => ({
      ...step,
      section: "next_7_days",
      importance: 3,
      effort: 3,
    })),
  ];

  for (const task of taskRows) {
    await run(
      `INSERT INTO tasks (
        title, life_area_id, project_id, situation_id, source_next_move_plan_id,
        source_plan_section, status, importance, effort, due_date, notes, created_at, updated_at
      ) VALUES (?, NULL, NULL, ?, ?, ?, 'open', ?, ?, NULL, ?, ?, ?)`,
      [
        task.title,
        plan.situation_id,
        plan.id,
        task.section,
        task.importance,
        task.effort,
        task.details,
        now,
        now,
      ],
    );
  }

  return createTasksFromNextMovePlan(planId);
}
