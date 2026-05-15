import { all, first, insert, run } from "./db";
import type {
  CheckIn,
  DailyPlan,
  HighestLeverageMove,
  IntakeMessage,
  IntakeSession,
  LifeArea,
  LocalRealityScout,
  OperatorInsight,
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

const profileColumns = `
  id, personal_profile, current_season, core_priorities, constraints,
  operating_principles, remember, challenge_on, created_at, updated_at
`;

const defaultProfileInput = {
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

const defaultOperatorInsight: OperatorInsight = {
  naive_path: "No operator insight was stored for this older plan.",
  operator_path: "Use the clearest next move from the rest of this plan.",
  wasted_motion_to_avoid: "Avoid expanding the plan before taking the next concrete step.",
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

type UserScopedRow = { user_id?: unknown };

function withoutUserId<T extends UserScopedRow>(row: T): Omit<T, "user_id"> {
  const safeRow = { ...row };
  delete safeRow.user_id;
  return safeRow;
}

function withoutUserIds<T extends UserScopedRow>(rows: T[]): Omit<T, "user_id">[] {
  return rows.map(withoutUserId);
}

async function ensureOwnedRecord(table: string, userId: number, id: number | null) {
  if (id == null) return;
  const row = await first<{ id: number }>(
    `SELECT id FROM ${table} WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!row) throw new Error("Referenced FlowPath record was not found.");
}

async function getProfileById(id: number): Promise<Profile | null> {
  return first<Profile>(`SELECT ${profileColumns} FROM profile WHERE id = ?`, [id]);
}

export async function getProfile(userId: number): Promise<Profile> {
  const existing = await first<Profile>(
    `SELECT ${profileColumns} FROM profile WHERE user_id = ?`,
    [userId],
  );
  if (existing) return existing;

  const now = nowIso();
  const id = await insert(
    `INSERT INTO profile (
      user_id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      defaultProfileInput.personal_profile,
      defaultProfileInput.current_season,
      defaultProfileInput.core_priorities,
      defaultProfileInput.constraints,
      defaultProfileInput.operating_principles,
      defaultProfileInput.remember,
      defaultProfileInput.challenge_on,
      now,
      now,
    ],
  );
  const created = await getProfileById(id);
  if (!created) throw new Error("Created profile could not be loaded.");
  return created;
}

export async function updateProfile(
  userId: number,
  input: ProfileInput,
): Promise<Profile> {
  const now = nowIso();
  await run(
    `INSERT INTO profile (
      user_id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      personal_profile = excluded.personal_profile,
      current_season = excluded.current_season,
      core_priorities = excluded.core_priorities,
      constraints = excluded.constraints,
      operating_principles = excluded.operating_principles,
      remember = excluded.remember,
      challenge_on = excluded.challenge_on,
      updated_at = excluded.updated_at`,
    [
      userId,
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
  return getProfile(userId);
}

export async function listLifeAreas(userId: number): Promise<LifeArea[]> {
  const rows = await all<LifeArea & UserScopedRow>(
    `SELECT * FROM life_areas
    WHERE user_id = ?
    ORDER BY
      CASE priority_level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      name COLLATE NOCASE`,
    [userId],
  );
  return withoutUserIds(rows) as LifeArea[];
}

export async function getLifeArea(
  userId: number,
  id: number,
): Promise<LifeArea | null> {
  const row = await first<LifeArea & UserScopedRow>(
    "SELECT * FROM life_areas WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? (withoutUserId(row) as LifeArea) : null;
}

export async function createLifeArea(
  userId: number,
  input: LifeAreaInput,
): Promise<LifeArea> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO life_areas (
      user_id, name, description, priority_level, desired_outcome, current_bottleneck, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      input.name,
      input.description,
      input.priority_level,
      input.desired_outcome,
      input.current_bottleneck,
      now,
      now,
    ],
  );
  const created = await getLifeArea(userId, id);
  if (!created) throw new Error("Created life area could not be loaded.");
  return created;
}

export async function updateLifeArea(
  userId: number,
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
    WHERE id = ? AND user_id = ?`,
    [
      input.name,
      input.description,
      input.priority_level,
      input.desired_outcome,
      input.current_bottleneck,
      nowIso(),
      id,
      userId,
    ],
  );
  return getLifeArea(userId, id);
}

export async function deleteLifeArea(userId: number, id: number) {
  const result = await run("DELETE FROM life_areas WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return result.rowsAffected > 0;
}

export async function listProjects(userId: number): Promise<Project[]> {
  const rows = await all<Project & UserScopedRow>(
    `SELECT projects.*, life_areas.name AS life_area_name
    FROM projects
    LEFT JOIN life_areas
      ON life_areas.id = projects.life_area_id
      AND life_areas.user_id = projects.user_id
    WHERE projects.user_id = ?
    ORDER BY
      CASE projects.status
        WHEN 'active' THEN 1
        WHEN 'paused' THEN 2
        WHEN 'someday' THEN 3
        ELSE 4
      END,
      projects.name COLLATE NOCASE`,
    [userId],
  );
  return withoutUserIds(rows) as Project[];
}

export async function getProject(userId: number, id: number): Promise<Project | null> {
  const row = await first<Project & UserScopedRow>(
    `SELECT projects.*, life_areas.name AS life_area_name
    FROM projects
    LEFT JOIN life_areas
      ON life_areas.id = projects.life_area_id
      AND life_areas.user_id = projects.user_id
    WHERE projects.id = ? AND projects.user_id = ?`,
    [id, userId],
  );
  return row ? (withoutUserId(row) as Project) : null;
}

export async function createProject(
  userId: number,
  input: ProjectInput,
): Promise<Project> {
  await ensureOwnedRecord("life_areas", userId, input.life_area_id);
  const now = nowIso();
  const id = await insert(
    `INSERT INTO projects (
      user_id, name, life_area_id, status, description, next_milestone,
      current_bottleneck, why_it_matters, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
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
  const created = await getProject(userId, id);
  if (!created) throw new Error("Created project could not be loaded.");
  return created;
}

export async function updateProject(
  userId: number,
  id: number,
  input: ProjectInput,
): Promise<Project | null> {
  await ensureOwnedRecord("life_areas", userId, input.life_area_id);
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
    WHERE id = ? AND user_id = ?`,
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
      userId,
    ],
  );
  return getProject(userId, id);
}

export async function deleteProject(userId: number, id: number) {
  const result = await run("DELETE FROM projects WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return result.rowsAffected > 0;
}

export async function listTasks(userId: number): Promise<Task[]> {
  const rows = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas
      ON life_areas.id = tasks.life_area_id
      AND life_areas.user_id = tasks.user_id
    LEFT JOIN projects
      ON projects.id = tasks.project_id
      AND projects.user_id = tasks.user_id
    LEFT JOIN situations
      ON situations.id = tasks.situation_id
      AND situations.user_id = tasks.user_id
    WHERE tasks.user_id = ?
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.effort ASC,
      tasks.created_at DESC`,
    [userId],
  );
  return withoutUserIds(rows) as Task[];
}

export async function getTask(userId: number, id: number): Promise<Task | null> {
  const row = await first<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas
      ON life_areas.id = tasks.life_area_id
      AND life_areas.user_id = tasks.user_id
    LEFT JOIN projects
      ON projects.id = tasks.project_id
      AND projects.user_id = tasks.user_id
    LEFT JOIN situations
      ON situations.id = tasks.situation_id
      AND situations.user_id = tasks.user_id
    WHERE tasks.id = ? AND tasks.user_id = ?`,
    [id, userId],
  );
  return row ? (withoutUserId(row) as Task) : null;
}

export async function createTask(userId: number, input: TaskInput): Promise<Task> {
  await ensureOwnedRecord("life_areas", userId, input.life_area_id);
  await ensureOwnedRecord("projects", userId, input.project_id);
  const now = nowIso();
  const id = await insert(
    `INSERT INTO tasks (
      user_id, title, life_area_id, project_id, status, importance, effort,
      friction_type, friction_note, due_date, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
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
  const created = await getTask(userId, id);
  if (!created) throw new Error("Created task could not be loaded.");
  return created;
}

export async function updateTask(
  userId: number,
  id: number,
  input: TaskInput,
): Promise<Task | null> {
  await ensureOwnedRecord("life_areas", userId, input.life_area_id);
  await ensureOwnedRecord("projects", userId, input.project_id);
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
    WHERE id = ? AND user_id = ?`,
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
      userId,
    ],
  );
  return getTask(userId, id);
}

export async function deleteTask(userId: number, id: number) {
  const result = await run("DELETE FROM tasks WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return result.rowsAffected > 0;
}

export async function createCheckIn(userId: number, input: CheckInInput): Promise<CheckIn> {
  const id = await insert(
    `INSERT INTO checkins (
      user_id, checkin_date, energy_level, mood, sleep, health_status,
      main_thing, resistance, brain_dump, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
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
  const created = await first<CheckIn>(
    `SELECT id, checkin_date, energy_level, mood, sleep, health_status,
      main_thing, resistance, brain_dump, created_at
    FROM checkins WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!created) throw new Error("Created check-in could not be loaded.");
  return created;
}

export async function listCheckIns(userId: number, limit = 30): Promise<CheckIn[]> {
  return all<CheckIn>(
    `SELECT id, checkin_date, energy_level, mood, sleep, health_status,
      main_thing, resistance, brain_dump, created_at
    FROM checkins
    WHERE user_id = ?
    ORDER BY checkin_date DESC, created_at DESC
    LIMIT ?`,
    [userId, limit],
  );
}

export async function getLatestCheckInForDate(
  userId: number,
  date = todayIsoDate(),
) {
  return first<CheckIn>(
    `SELECT id, checkin_date, energy_level, mood, sleep, health_status,
      main_thing, resistance, brain_dump, created_at
    FROM checkins
    WHERE user_id = ? AND checkin_date = ?
    ORDER BY created_at DESC
    LIMIT 1`,
    [userId, date],
  );
}

type StoredPlanRow = Omit<
  StoredPlan,
  | "top_3_actions"
  | "recommendation_basis"
  | "restraint_guidance"
  | "operator_insight"
  | "local_reality_scout"
> & {
  top_3_actions_json: string;
  recommendation_basis_json?: string | null;
  restraint_guidance_json?: string | null;
  operator_insight_json?: string | null;
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
    operator_insight: parseJson(row.operator_insight_json, defaultOperatorInsight),
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
  userId: number,
  plan: DailyPlan,
  model: string,
  checkinId: number | null,
): Promise<StoredPlan> {
  await ensureOwnedRecord("checkins", userId, checkinId);
  const rawJson = JSON.stringify(plan);
  const id = await insert(
    `INSERT INTO plans (
      user_id, plan_date, checkin_id, model, today_theme, honest_read, top_3_actions_json,
      recommendation_basis_json, restraint_guidance_json, friction_pattern,
      operator_insight_json, local_reality_scout_json, human_help_boundary, avoid_today,
      optional_if_energy_is_high, minimum_viable_day, evening_review_prompt,
      raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      todayIsoDate(),
      checkinId,
      model,
      plan.today_theme,
      plan.honest_read,
      JSON.stringify(plan.top_3_actions),
      JSON.stringify(plan.recommendation_basis),
      JSON.stringify(plan.restraint_guidance),
      plan.friction_pattern,
      JSON.stringify(plan.operator_insight),
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
  const created = await getPlan(userId, id);
  if (!created) throw new Error("Created plan could not be loaded.");
  return created;
}

export async function getPlan(userId: number, id: number): Promise<StoredPlan | null> {
  const row = await first<StoredPlanRow>(
    "SELECT * FROM plans WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? rowToStoredPlan(row) : null;
}

export async function listPlans(userId: number, limit = 20): Promise<StoredPlan[]> {
  const rows = await all<StoredPlanRow>(
    `SELECT * FROM plans
    WHERE user_id = ?
    ORDER BY plan_date DESC, created_at DESC
    LIMIT ?`,
    [userId, limit],
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

function rowToIntakeSession(
  row: Omit<IntakeSession, "is_complete"> &
    UserScopedRow & { is_complete: number },
): IntakeSession {
  const safeRow = withoutUserId(row);
  return {
    ...safeRow,
    is_complete: Boolean(row.is_complete),
  };
}

export async function listSituations(
  userId: number,
  status?: string,
): Promise<Situation[]> {
  const statusWhere = status ? "AND situations.status = ?" : "";
  const rows = await all<Situation & UserScopedRow>(
    `SELECT
      situations.*,
      latest_plan.id AS latest_plan_id,
      latest_plan.mode AS latest_plan_mode,
      COALESCE(
        json_extract(latest_plan.highest_leverage_move_json, '$.title'),
        (
          SELECT title FROM tasks
          WHERE tasks.user_id = situations.user_id
            AND tasks.situation_id = situations.id
            AND tasks.status = 'open'
          ORDER BY tasks.importance DESC, tasks.effort ASC, tasks.created_at DESC
          LIMIT 1
        )
      ) AS latest_plan_move
    FROM situations
    LEFT JOIN next_move_plans latest_plan ON latest_plan.id = (
      SELECT id FROM next_move_plans
      WHERE situation_id = situations.id AND user_id = situations.user_id
      ORDER BY created_at DESC
      LIMIT 1
    )
    WHERE situations.user_id = ?
    ${statusWhere}
    ORDER BY
      CASE situations.status WHEN 'active' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
      CASE situations.urgency WHEN 'crisis' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      situations.updated_at DESC`,
    status ? [userId, status] : [userId],
  );
  return withoutUserIds(rows) as Situation[];
}

export async function getSituation(
  userId: number,
  id: number,
): Promise<Situation | null> {
  const row = await first<Situation & UserScopedRow>(
    `SELECT
      situations.*,
      latest_plan.id AS latest_plan_id,
      latest_plan.mode AS latest_plan_mode,
      COALESCE(
        json_extract(latest_plan.highest_leverage_move_json, '$.title'),
        (
          SELECT title FROM tasks
          WHERE tasks.user_id = situations.user_id
            AND tasks.situation_id = situations.id
            AND tasks.status = 'open'
          ORDER BY tasks.importance DESC, tasks.effort ASC, tasks.created_at DESC
          LIMIT 1
        )
      ) AS latest_plan_move
    FROM situations
    LEFT JOIN next_move_plans latest_plan ON latest_plan.id = (
      SELECT id FROM next_move_plans
      WHERE situation_id = situations.id AND user_id = situations.user_id
      ORDER BY created_at DESC
      LIMIT 1
    )
    WHERE situations.id = ? AND situations.user_id = ?`,
    [id, userId],
  );
  return row ? (withoutUserId(row) as Situation) : null;
}

export async function createSituation(
  userId: number,
  input: SituationInput,
): Promise<Situation> {
  const now = nowIso();
  const id = await insert(
    `INSERT INTO situations (user_id, title, category, status, urgency, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)`,
    [userId, input.title, input.category, input.urgency, now, now],
  );
  const situation = await getSituation(userId, id);
  if (!situation) throw new Error("Created situation could not be loaded.");
  return situation;
}

export async function updateSituation(
  userId: number,
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
    WHERE id = ? AND user_id = ?`,
    [input.title, input.category, input.urgency, input.status, nowIso(), id, userId],
  );
  return getSituation(userId, id);
}

export async function deleteSituation(userId: number, id: number) {
  const situation = await getSituation(userId, id);
  if (!situation) return false;

  await run(
    `DELETE FROM tasks
    WHERE user_id = ?
      AND (situation_id = ?
      OR source_next_move_plan_id IN (
        SELECT id FROM next_move_plans WHERE user_id = ? AND situation_id = ?
      ))`,
    [userId, id, userId, id],
  );

  const result = await run("DELETE FROM situations WHERE id = ? AND user_id = ?", [
    id,
    userId,
  ]);
  return result.rowsAffected > 0;
}

export async function touchSituation(userId: number, id: number) {
  await run("UPDATE situations SET updated_at = ? WHERE id = ? AND user_id = ?", [
    nowIso(),
    id,
    userId,
  ]);
}

export async function getOrCreateIntakeSession(
  userId: number,
  situationId: number,
): Promise<IntakeSession> {
  await ensureOwnedRecord("situations", userId, situationId);
  const existing = await first<
    Omit<IntakeSession, "is_complete"> & UserScopedRow & { is_complete: number }
  >(
    `SELECT * FROM intake_sessions
    WHERE user_id = ? AND situation_id = ? AND is_complete = 0
    ORDER BY updated_at DESC
    LIMIT 1`,
    [userId, situationId],
  );

  if (existing) return rowToIntakeSession(existing);

  const now = nowIso();
  const id = await insert(
    `INSERT INTO intake_sessions (
      user_id, situation_id, current_stage, is_complete, summary_so_far, created_at, updated_at
    ) VALUES (?, ?, 'understanding_goals', 0, '', ?, ?)`,
    [userId, situationId, now, now],
  );
  const created = await getIntakeSession(userId, id);
  if (!created) throw new Error("Created intake session could not be loaded.");
  return created;
}

export async function getIntakeSession(
  userId: number,
  id: number,
): Promise<IntakeSession | null> {
  const row = await first<
    Omit<IntakeSession, "is_complete"> & UserScopedRow & { is_complete: number }
  >("SELECT * FROM intake_sessions WHERE id = ? AND user_id = ?", [id, userId]);
  return row ? rowToIntakeSession(row) : null;
}

export async function getLatestIntakeSession(
  userId: number,
  situationId: number,
): Promise<IntakeSession | null> {
  const row = await first<
    Omit<IntakeSession, "is_complete"> & UserScopedRow & { is_complete: number }
  >(
    `SELECT * FROM intake_sessions
    WHERE user_id = ? AND situation_id = ?
    ORDER BY updated_at DESC
    LIMIT 1`,
    [userId, situationId],
  );
  return row ? rowToIntakeSession(row) : null;
}

export async function updateIntakeSession(
  userId: number,
  id: number,
  output: Pick<InterviewerOutput, "current_stage" | "is_complete" | "summary_so_far">,
): Promise<IntakeSession | null> {
  await run(
    `UPDATE intake_sessions SET
      current_stage = ?,
      is_complete = ?,
      summary_so_far = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [
      output.current_stage,
      output.is_complete ? 1 : 0,
      output.summary_so_far,
      nowIso(),
      id,
      userId,
    ],
  );
  return getIntakeSession(userId, id);
}

export async function listIntakeMessages(
  userId: number,
  sessionId: number,
): Promise<IntakeMessage[]> {
  return all<IntakeMessage>(
    `SELECT id, session_id, role, content, created_at
    FROM intake_messages
    WHERE user_id = ? AND session_id = ?
    ORDER BY created_at ASC, id ASC`,
    [userId, sessionId],
  );
}

export async function addIntakeMessage(
  userId: number,
  sessionId: number,
  role: IntakeMessage["role"],
  content: string,
): Promise<IntakeMessage> {
  await ensureOwnedRecord("intake_sessions", userId, sessionId);
  const id = await insert(
    `INSERT INTO intake_messages (user_id, session_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)`,
    [userId, sessionId, role, content, nowIso()],
  );
  const message = await first<IntakeMessage>(
    `SELECT id, session_id, role, content, created_at
    FROM intake_messages WHERE id = ? AND user_id = ?`,
    [id, userId],
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
  | "operator_insight"
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
  operator_insight_json?: string | null;
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
    operator_insight: parseJson(row.operator_insight_json, defaultOperatorInsight),
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
  userId: number,
  situationId: number,
  sessionId: number | null,
  plan: NextMovePlanInput,
  model: string,
): Promise<StoredNextMovePlan> {
  await ensureOwnedRecord("situations", userId, situationId);
  await ensureOwnedRecord("intake_sessions", userId, sessionId);
  const id = await insert(
    `INSERT INTO next_move_plans (
      user_id, situation_id, intake_session_id, model, mode, situation_summary, core_bottleneck,
      highest_leverage_move_json, why_this_move, first_30_minutes_json,
      next_24_hours_json, next_7_days_json, what_not_to_do_json, likely_trap,
      recommendation_basis_json, restraint_guidance_json, friction_pattern,
      operator_insight_json, local_reality_scout_json, resources_to_seek_json, when_to_get_human_help,
      safety_boundary_json, confidence_level, assumptions_json,
      follow_up_questions_json, raw_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
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
      JSON.stringify(plan.operator_insight),
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
  await touchSituation(userId, situationId);
  const created = await getNextMovePlan(userId, id);
  if (!created) throw new Error("Created next move plan could not be loaded.");
  return created;
}

export async function getNextMovePlan(
  userId: number,
  id: number,
): Promise<StoredNextMovePlan | null> {
  const row = await first<
    Parameters<typeof rowToNextMovePlan>[0]
  >("SELECT * FROM next_move_plans WHERE id = ? AND user_id = ?", [id, userId]);
  return row ? rowToNextMovePlan(row) : null;
}

export async function getLatestNextMovePlan(
  userId: number,
  situationId?: number,
): Promise<StoredNextMovePlan | null> {
  const row = await first<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    WHERE user_id = ?
    ${situationId ? "AND situation_id = ?" : ""}
    ORDER BY created_at DESC
    LIMIT 1`,
    situationId ? [userId, situationId] : [userId],
  );
  return row ? rowToNextMovePlan(row) : null;
}

export async function listNextMovePlans(
  userId: number,
  limit = 20,
  situationId?: number,
): Promise<StoredNextMovePlan[]> {
  const rows = await all<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    WHERE user_id = ?
    ${situationId ? "AND situation_id = ?" : ""}
    ORDER BY created_at DESC
    LIMIT ?`,
    situationId ? [userId, situationId, limit] : [userId, limit],
  );
  return rows.map(rowToNextMovePlan);
}

export async function listTasksForSituation(
  userId: number,
  situationId: number,
): Promise<Task[]> {
  const rows = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas
      ON life_areas.id = tasks.life_area_id
      AND life_areas.user_id = tasks.user_id
    LEFT JOIN projects
      ON projects.id = tasks.project_id
      AND projects.user_id = tasks.user_id
    LEFT JOIN situations
      ON situations.id = tasks.situation_id
      AND situations.user_id = tasks.user_id
    WHERE tasks.user_id = ? AND tasks.situation_id = ?
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.created_at DESC`,
    [userId, situationId],
  );
  return withoutUserIds(rows) as Task[];
}

export async function createTasksFromNextMovePlan(
  userId: number,
  planId: number,
): Promise<Task[]> {
  const existing = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title
    FROM tasks
    LEFT JOIN life_areas
      ON life_areas.id = tasks.life_area_id
      AND life_areas.user_id = tasks.user_id
    LEFT JOIN projects
      ON projects.id = tasks.project_id
      AND projects.user_id = tasks.user_id
    LEFT JOIN situations
      ON situations.id = tasks.situation_id
      AND situations.user_id = tasks.user_id
    WHERE tasks.user_id = ? AND source_next_move_plan_id = ?
    ORDER BY created_at ASC`,
    [userId, planId],
  );
  if (existing.length > 0) return withoutUserIds(existing) as Task[];

  const plan = await getNextMovePlan(userId, planId);
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
        user_id, title, life_area_id, project_id, situation_id, source_next_move_plan_id,
        source_plan_section, status, importance, effort, due_date, notes, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'open', ?, ?, NULL, ?, ?, ?)`,
      [
        userId,
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

  return createTasksFromNextMovePlan(userId, planId);
}
