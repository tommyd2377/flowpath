import { randomUUID } from "node:crypto";

import { all, first, insert, run } from "./db";
import type {
  CheckIn,
  ContextConstraints,
  ContextUsedItem,
  DailyPlan,
  GeneratedInferredContextItem,
  GenerationEvent,
  GenerationStatus,
  GenerationType,
  HighestLeverageMove,
  InferredContextItem,
  InferredContextPersistence,
  IntakeMessage,
  IntakeSession,
  LifeArea,
  LocalRealityScout,
  OperatorInsight,
  OutcomeRecord,
  PlanTaskCandidate,
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
import type { CognitiveMetadata, OutcomeValue } from "./cognitive-schemas";
import type {
  CheckInInput,
  InferredContextItemInput,
  InferredContextItemUpdate,
  InterviewerOutput,
  LifeAreaInput,
  NextMovePlanInput,
  ProfileInput,
  ProjectInput,
  SituationInput,
  SituationUpdate,
  TaskInput,
} from "./schemas";
import { rankTasks } from "./task-ranking";
import {
  constraintsForProfile,
  mergeContextConstraints,
  sanitizeContextConstraintsForSession,
} from "./constraints";
import { assertSafeTextFields } from "./privacy";
import { nowIso, todayIsoDate } from "./time";

const profileColumns = `
  id, personal_profile, current_season, core_priorities, constraints,
  operating_principles, remember, challenge_on, context_constraints_json,
  created_at, updated_at
`;

const defaultProfileInput = {
  personal_profile: "",
  current_season: "",
  core_priorities: "",
  constraints: "",
  operating_principles: "",
  remember: "",
  challenge_on: "",
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
  naive_path: "No mentor insight was stored for this older plan.",
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

const defaultTaskCandidates: PlanTaskCandidate[] = [];
const defaultInferredContextItems: GeneratedInferredContextItem[] = [];
const defaultCognitiveMetadata: CognitiveMetadata | null = null;
const defaultFirst10MinuteAction = {
  title: "Take the smallest first step",
  details: "Do the first useful 10-minute action from this plan.",
};
const defaultContextUsed: ContextUsedItem[] = [];

function normalizePlanTaskCandidate(candidate: Partial<PlanTaskCandidate>): PlanTaskCandidate {
  const importance = candidate.importance ?? 3;
  const effort = candidate.effort ?? 3;
  const details = candidate.details ?? candidate.description ?? "";
  return {
    title: candidate.title ?? "Take the next useful action",
    details,
    description: candidate.description || details,
    estimated_minutes: candidate.estimated_minutes ?? Math.min(480, Math.max(10, effort * 15)),
    friction_level:
      candidate.friction_level ??
      (effort >= 4 ||
      candidate.friction_type === "scary" ||
      candidate.friction_type === "blocked"
        ? "high"
        : effort <= 2
          ? "low"
          : "medium"),
    leverage:
      candidate.leverage ??
      (importance >= 5 ? "high" : importance >= 3 ? "medium" : "low"),
    why_now: candidate.why_now || candidate.rank_reason || "This is the next useful action from the plan.",
    success_condition:
      candidate.success_condition || "The action is completed and the next blocker is clearer.",
    category: candidate.category || "other",
    source_message_id: candidate.source_message_id ?? null,
    candidate_type: candidate.candidate_type ?? "supporting",
    importance,
    effort,
    friction_type: candidate.friction_type ?? "none",
    rank_reason: candidate.rank_reason ?? "Best balance of leverage and friction.",
    due_date: candidate.due_date ?? null,
  };
}

function normalizePlanTaskCandidates(value: unknown): PlanTaskCandidate[] {
  if (!Array.isArray(value)) return defaultTaskCandidates;
  return value.map((candidate) =>
    normalizePlanTaskCandidate(
      candidate && typeof candidate === "object"
        ? (candidate as Partial<PlanTaskCandidate>)
        : {},
    ),
  );
}

type UserScopedRow = { user_id?: unknown };
type QaScopedRow = { is_qa?: unknown };

const emptyContextConstraints: ContextConstraints = {};
type IntakeSessionRow = Omit<IntakeSession, "is_complete" | "context_constraints"> &
  UserScopedRow & {
    is_complete: number;
    is_qa?: number;
    context_constraints_json?: string | null;
  };

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function deriveSituationTitle(title: string | undefined, description: string) {
  const candidate = (title || description).trim().replace(/\s+/g, " ");
  if (!candidate) return "Untitled situation";
  if (candidate.length <= 120) return candidate;
  return `${candidate.slice(0, 117).trimEnd()}...`;
}

type ProfileRow = Omit<Profile, "context_constraints"> &
  UserScopedRow & {
    context_constraints_json?: string | null;
  };

function rowToProfile(row: ProfileRow): Profile {
  const safeRow = withoutUserId(row);
  const { context_constraints_json, ...profile } = safeRow;
  return {
    ...profile,
    context_constraints: parseJson(context_constraints_json, emptyContextConstraints),
  };
}

type InferredContextItemRow = InferredContextItem & UserScopedRow & QaScopedRow;

type SanitizedInferredContextItem = Pick<
  InferredContextItem,
  "label" | "value" | "category" | "sensitivity" | "persistence" | "source"
>;

type InferredContextRefs = Pick<
  InferredContextItemInput,
  "situation_id" | "intake_session_id" | "next_move_plan_id"
>;

const sensitivityRank: Record<InferredContextItem["sensitivity"], number> = {
  low: 1,
  moderate: 2,
  high: 3,
};

function normalizeInferredContextPersistence({
  persistence,
  sensitivity,
  allowSavedMemory,
}: {
  persistence: InferredContextPersistence;
  sensitivity: InferredContextItem["sensitivity"];
  allowSavedMemory: boolean;
}): InferredContextPersistence {
  if (persistence === "saved_memory" && !allowSavedMemory) {
    return "proposed_memory";
  }
  if (sensitivity === "high" && persistence === "saved_memory" && !allowSavedMemory) {
    return "proposed_memory";
  }
  return persistence;
}

function sanitizeInferredContextItem<
  T extends Pick<
    InferredContextItemInput,
    "label" | "value" | "category" | "sensitivity" | "persistence" | "source"
  >,
>(input: T, { allowSavedMemory = false }: { allowSavedMemory?: boolean } = {}) {
  assertSafeTextFields({ label: input.label, value: input.value });
  return {
    label: input.label.trim().slice(0, 160),
    value: input.value.trim().slice(0, 1000),
    category: input.category,
    sensitivity: input.sensitivity,
    persistence: normalizeInferredContextPersistence({
      persistence: input.persistence,
      sensitivity: input.sensitivity,
      allowSavedMemory,
    }),
    source: input.source,
  };
}

function normalizeMemoryMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuplicateMemoryText(a: string, b: string) {
  const firstText = normalizeMemoryMatchText(a);
  const secondText = normalizeMemoryMatchText(b);
  if (!firstText || !secondText) return false;
  if (firstText === secondText) return true;

  const [shorter, longer] =
    firstText.length <= secondText.length
      ? [firstText, secondText]
      : [secondText, firstText];

  if (shorter.length >= 24 && longer.includes(shorter)) return true;

  const shorterTokens = shorter.split(" ").filter((token) => token.length > 1);
  const longerTokens = new Set(longer.split(" ").filter((token) => token.length > 1));
  if (shorterTokens.length < 4) return false;

  const overlap = shorterTokens.filter((token) => longerTokens.has(token)).length;
  return overlap / shorterTokens.length >= 0.8;
}

function isDuplicateInferredContextItem(
  existing: InferredContextItem,
  candidate: SanitizedInferredContextItem,
) {
  return (
    isDuplicateMemoryText(existing.label, candidate.label) ||
    isDuplicateMemoryText(existing.value, candidate.value)
  );
}

async function findDuplicateInferredContextItem(
  userId: number,
  candidate: SanitizedInferredContextItem,
  refs: InferredContextRefs,
  isQa = false,
) {
  const situationId = refs.situation_id ?? null;
  const situationClause =
    situationId === null
      ? "inferred_context_items.situation_id IS NULL"
      : "inferred_context_items.situation_id = ?";
  const args =
    situationId === null
      ? [userId, candidate.category, candidate.persistence]
      : [userId, candidate.category, candidate.persistence, situationId];
  const rows = await all<InferredContextItemRow>(
    `SELECT
      inferred_context_items.*,
      situations.title AS situation_title
    FROM inferred_context_items
    LEFT JOIN situations
      ON situations.id = inferred_context_items.situation_id
      AND situations.user_id = inferred_context_items.user_id
    WHERE inferred_context_items.user_id = ?
      AND inferred_context_items.category = ?
      AND inferred_context_items.persistence = ?
      ${qaClause("inferred_context_items", isQa)}
      AND ${situationClause}
    ORDER BY inferred_context_items.updated_at DESC`,
    args,
  );
  const existing = rows.find((row) =>
    isDuplicateInferredContextItem(row, candidate),
  );
  return existing ? (withoutUserId(existing) as InferredContextItem) : null;
}

async function updateDuplicateInferredContextItem(
  userId: number,
  existing: InferredContextItem,
  candidate: SanitizedInferredContextItem,
  refs: InferredContextRefs,
) {
  const nextSensitivity =
    sensitivityRank[candidate.sensitivity] > sensitivityRank[existing.sensitivity]
      ? candidate.sensitivity
      : existing.sensitivity;
  const nextIntakeSessionId = existing.intake_session_id ?? refs.intake_session_id ?? null;
  const nextMovePlanId = existing.next_move_plan_id ?? refs.next_move_plan_id ?? null;

  const shouldUpdate =
    nextSensitivity !== existing.sensitivity ||
    nextIntakeSessionId !== existing.intake_session_id ||
    nextMovePlanId !== existing.next_move_plan_id;

  if (!shouldUpdate) return existing;

  await run(
    `UPDATE inferred_context_items SET
      sensitivity = ?,
      intake_session_id = ?,
      next_move_plan_id = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [nextSensitivity, nextIntakeSessionId, nextMovePlanId, nowIso(), existing.id, userId],
  );
  const updated = await getInferredContextItem(userId, existing.id);
  if (!updated) throw new Error("Updated inferred context item could not be loaded.");
  return updated;
}

function withoutUserId<T extends UserScopedRow>(row: T): Omit<T, "user_id"> {
  const safeRow = { ...row };
  delete safeRow.user_id;
  return safeRow;
}

function rowBoolean(value: unknown) {
  return value === true || value === 1;
}

function qaClause(alias: string, isQa?: boolean) {
  return `AND ${alias}.is_qa = ${isQa ? 1 : 0}`;
}

async function inferQaForRefs(
  userId: number,
  refs: InferredContextRefs,
  explicit?: boolean,
) {
  if (typeof explicit === "boolean") return explicit;
  if (refs.next_move_plan_id) {
    const row = await first<{ is_qa: number }>(
      "SELECT is_qa FROM next_move_plans WHERE id = ? AND user_id = ?",
      [refs.next_move_plan_id, userId],
    );
    if (row) return rowBoolean(row.is_qa);
  }
  if (refs.intake_session_id) {
    const row = await first<{ is_qa: number }>(
      "SELECT is_qa FROM intake_sessions WHERE id = ? AND user_id = ?",
      [refs.intake_session_id, userId],
    );
    if (row) return rowBoolean(row.is_qa);
  }
  if (refs.situation_id) {
    const row = await first<{ is_qa: number }>(
      "SELECT is_qa FROM situations WHERE id = ? AND user_id = ?",
      [refs.situation_id, userId],
    );
    if (row) return rowBoolean(row.is_qa);
  }
  return false;
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
  const row = await first<ProfileRow>(`SELECT ${profileColumns} FROM profile WHERE id = ?`, [
    id,
  ]);
  return row ? rowToProfile(row) : null;
}

export async function getProfile(userId: number): Promise<Profile> {
  const existing = await first<ProfileRow>(
    `SELECT ${profileColumns} FROM profile WHERE user_id = ?`,
    [userId],
  );
  if (existing) return rowToProfile(existing);

  const now = nowIso();
  const id = await insert(
    `INSERT INTO profile (
      user_id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, context_constraints_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      defaultProfileInput.personal_profile,
      defaultProfileInput.current_season,
      defaultProfileInput.core_priorities,
      defaultProfileInput.constraints,
      defaultProfileInput.operating_principles,
      defaultProfileInput.remember,
      defaultProfileInput.challenge_on,
      JSON.stringify(emptyContextConstraints),
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
  assertSafeTextFields(input);
  const contextConstraints = constraintsForProfile(input.context_constraints);
  const now = nowIso();
  await run(
    `INSERT INTO profile (
      user_id, personal_profile, current_season, core_priorities, constraints,
      operating_principles, remember, challenge_on, context_constraints_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      personal_profile = excluded.personal_profile,
      current_season = excluded.current_season,
      core_priorities = excluded.core_priorities,
      constraints = excluded.constraints,
      operating_principles = excluded.operating_principles,
      remember = excluded.remember,
      challenge_on = excluded.challenge_on,
      context_constraints_json = excluded.context_constraints_json,
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
      JSON.stringify(contextConstraints),
      now,
      now,
    ],
  );
  return getProfile(userId);
}

export async function listInferredContextItems(
  userId: number,
  { isQa = false }: { isQa?: boolean } = {},
): Promise<InferredContextItem[]> {
  const rows = await all<InferredContextItemRow>(
    `SELECT
      inferred_context_items.*,
      situations.title AS situation_title
    FROM inferred_context_items
    LEFT JOIN situations
      ON situations.id = inferred_context_items.situation_id
      AND situations.user_id = inferred_context_items.user_id
    WHERE inferred_context_items.user_id = ?
      ${qaClause("inferred_context_items", isQa)}
    ORDER BY
      CASE inferred_context_items.persistence
        WHEN 'proposed_memory' THEN 1
        WHEN 'saved_memory' THEN 2
        ELSE 3
      END,
      inferred_context_items.updated_at DESC`,
    [userId],
  );
  return withoutUserIds(rows) as InferredContextItem[];
}

export async function getInferredContextItem(
  userId: number,
  id: number,
): Promise<InferredContextItem | null> {
  const row = await first<InferredContextItemRow>(
    `SELECT
      inferred_context_items.*,
      situations.title AS situation_title
    FROM inferred_context_items
    LEFT JOIN situations
      ON situations.id = inferred_context_items.situation_id
      AND situations.user_id = inferred_context_items.user_id
    WHERE inferred_context_items.id = ?
      AND inferred_context_items.user_id = ?`,
    [id, userId],
  );
  return row ? (withoutUserId(row) as InferredContextItem) : null;
}

export async function createInferredContextItem(
  userId: number,
  input: InferredContextItemInput,
  options: { allowSavedMemory?: boolean; isQa?: boolean } = {},
): Promise<InferredContextItem> {
  await ensureOwnedRecord("situations", userId, input.situation_id ?? null);
  await ensureOwnedRecord("intake_sessions", userId, input.intake_session_id ?? null);
  await ensureOwnedRecord(
    "next_move_plans",
    userId,
    input.next_move_plan_id ?? null,
  );
  const safe = sanitizeInferredContextItem(input, options);
  const refs = {
    situation_id: input.situation_id ?? null,
    intake_session_id: input.intake_session_id ?? null,
    next_move_plan_id: input.next_move_plan_id ?? null,
  };
  const isQa = await inferQaForRefs(userId, refs, options.isQa);
  const duplicate = await findDuplicateInferredContextItem(userId, safe, refs, isQa);
  if (duplicate) {
    return updateDuplicateInferredContextItem(userId, duplicate, safe, refs);
  }
  const now = nowIso();
  const id = await insert(
    `INSERT INTO inferred_context_items (
      user_id, label, value, category, sensitivity, persistence, source,
      situation_id, intake_session_id, next_move_plan_id, is_qa, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      safe.label,
      safe.value,
      safe.category,
      safe.sensitivity,
      safe.persistence,
      safe.source,
      refs.situation_id,
      refs.intake_session_id,
      refs.next_move_plan_id,
      isQa ? 1 : 0,
      now,
      now,
    ],
  );
  const created = await getInferredContextItem(userId, id);
  if (!created) throw new Error("Created inferred context item could not be loaded.");
  return created;
}

export async function createInferredContextItems(
  userId: number,
  items: GeneratedInferredContextItem[],
  refs: {
    situation_id?: number | null;
    intake_session_id?: number | null;
    next_move_plan_id?: number | null;
    source?: InferredContextItem["source"];
    isQa?: boolean;
  },
): Promise<InferredContextItem[]> {
  const created: InferredContextItem[] = [];
  for (const item of items) {
    created.push(
      await createInferredContextItem(
        userId,
        {
          ...item,
          source: refs.source ?? item.source,
          situation_id: refs.situation_id ?? null,
          intake_session_id: refs.intake_session_id ?? null,
          next_move_plan_id: refs.next_move_plan_id ?? null,
        },
        { allowSavedMemory: false, isQa: refs.isQa },
      ),
    );
  }
  return created;
}

export async function updateInferredContextItem(
  userId: number,
  id: number,
  input: InferredContextItemUpdate,
): Promise<InferredContextItem | null> {
  const existing = await getInferredContextItem(userId, id);
  if (!existing) return null;
  const merged = sanitizeInferredContextItem(
    {
      label: input.label ?? existing.label,
      value: input.value ?? existing.value,
      category: input.category ?? existing.category,
      sensitivity: input.sensitivity ?? existing.sensitivity,
      persistence: input.persistence ?? existing.persistence,
      source: existing.source,
    },
    { allowSavedMemory: true },
  );
  await run(
    `UPDATE inferred_context_items SET
      label = ?,
      value = ?,
      category = ?,
      sensitivity = ?,
      persistence = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [
      merged.label,
      merged.value,
      merged.category,
      merged.sensitivity,
      merged.persistence,
      nowIso(),
      id,
      userId,
    ],
  );
  return getInferredContextItem(userId, id);
}

export async function deleteInferredContextItem(userId: number, id: number) {
  const result = await run(
    "DELETE FROM inferred_context_items WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return result.rowsAffected > 0;
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
  assertSafeTextFields(input);
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
  assertSafeTextFields(input);
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
  assertSafeTextFields(input);
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
  assertSafeTextFields(input);
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

export async function listTasks(
  userId: number,
  { isQa = false }: { isQa?: boolean } = {},
): Promise<Task[]> {
  const rows = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title,
      situations.urgency AS situation_urgency
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
      ${qaClause("tasks", isQa)}
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.effort ASC,
      tasks.created_at DESC`,
    [userId],
  );
  return rankTasks(withoutUserIds(rows) as Task[]);
}

export async function getTask(userId: number, id: number): Promise<Task | null> {
  const row = await first<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title,
      situations.urgency AS situation_urgency
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
  return row ? rankTasks([withoutUserId(row) as Task])[0] : null;
}

export async function createTask(
  userId: number,
  input: TaskInput,
  { isQa = false }: { isQa?: boolean } = {},
): Promise<Task> {
  assertSafeTextFields(input);
  await ensureOwnedRecord("life_areas", userId, input.life_area_id);
  await ensureOwnedRecord("projects", userId, input.project_id);
  const now = nowIso();
  const id = await insert(
    `INSERT INTO tasks (
      user_id, title, life_area_id, project_id, status, importance, effort,
      friction_type, friction_note, due_date, notes, created_at, updated_at
      , is_qa
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      isQa ? 1 : 0,
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
  assertSafeTextFields(input);
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
  assertSafeTextFields(input);
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

function rowToIntakeSession(
  row: IntakeSessionRow,
): IntakeSession {
  const safeRow = withoutUserId(row);
  const { context_constraints_json, ...session } = safeRow;
  return {
    ...session,
    is_complete: Boolean(row.is_complete),
    is_qa: rowBoolean(row.is_qa),
    context_constraints: parseJson(context_constraints_json, emptyContextConstraints),
  };
}

export async function listSituations(
  userId: number,
  status?: string,
  { isQa = false }: { isQa?: boolean } = {},
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
    ${qaClause("situations", isQa)}
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
  { isQa = false }: { isQa?: boolean } = {},
): Promise<Situation> {
  assertSafeTextFields(input);
  const now = nowIso();
  const description = input.description || input.title;
  const derivedTitle = deriveSituationTitle(input.title, description);
  const id = await insert(
    `INSERT INTO situations (
      user_id, title, description, category, status, urgency, is_qa, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    [
      userId,
      derivedTitle,
      description,
      input.category,
      input.urgency,
      isQa ? 1 : 0,
      now,
      now,
    ],
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
  assertSafeTextFields(input);
  await run(
    `UPDATE situations SET
      title = ?,
      description = ?,
      category = ?,
      urgency = ?,
      status = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [
      input.title,
      input.description,
      input.category,
      input.urgency,
      input.status,
      nowIso(),
      id,
      userId,
    ],
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
  const existing = await first<IntakeSessionRow>(
    `SELECT * FROM intake_sessions
    WHERE user_id = ? AND situation_id = ? AND is_complete = 0
    ORDER BY updated_at DESC
    LIMIT 1`,
    [userId, situationId],
  );

  if (existing) return rowToIntakeSession(existing);

  const now = nowIso();
  const situation = await getSituation(userId, situationId);
  const isQa = Boolean(situation?.is_qa);
  const id = await insert(
    `INSERT INTO intake_sessions (
      user_id, situation_id, current_stage, is_complete, summary_so_far, is_qa, created_at, updated_at
    ) VALUES (?, ?, 'understanding_goals', 0, '', ?, ?, ?)`,
    [userId, situationId, isQa ? 1 : 0, now, now],
  );
  const created = await getIntakeSession(userId, id);
  if (!created) throw new Error("Created intake session could not be loaded.");
  return created;
}

export async function getIntakeSession(
  userId: number,
  id: number,
): Promise<IntakeSession | null> {
  const row = await first<IntakeSessionRow>(
    "SELECT * FROM intake_sessions WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? rowToIntakeSession(row) : null;
}

export async function getLatestIntakeSession(
  userId: number,
  situationId: number,
): Promise<IntakeSession | null> {
  const row = await first<IntakeSessionRow>(
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

export async function updateIntakeSessionConstraints(
  userId: number,
  id: number,
  input: ContextConstraints,
): Promise<IntakeSession | null> {
  const existing = await getIntakeSession(userId, id);
  if (!existing) return null;
  const nextConstraints = mergeContextConstraints(
    existing.context_constraints,
    sanitizeContextConstraintsForSession(input),
  );
  await run(
    `UPDATE intake_sessions SET
      context_constraints_json = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [JSON.stringify(nextConstraints), nowIso(), id, userId],
  );
  return getIntakeSession(userId, id);
}

export async function mergeProfileContextConstraints(
  userId: number,
  input: ContextConstraints,
): Promise<Profile> {
  const existing = await getProfile(userId);
  const profileConstraints = constraintsForProfile(input);
  if (Object.keys(profileConstraints).length === 0) return existing;
  const nextConstraints = mergeContextConstraints(
    existing.context_constraints,
    profileConstraints,
  );
  await run(
    `UPDATE profile SET context_constraints_json = ?, updated_at = ?
    WHERE user_id = ?`,
    [JSON.stringify(nextConstraints), nowIso(), userId],
  );
  return getProfile(userId);
}

export async function listRecentActiveIntakeSessions(
  userId: number,
  limit = 5,
): Promise<IntakeSession[]> {
  const rows = await all<IntakeSessionRow>(
    `SELECT intake_sessions.*
    FROM intake_sessions
    INNER JOIN situations
      ON situations.id = intake_sessions.situation_id
      AND situations.user_id = intake_sessions.user_id
    WHERE intake_sessions.user_id = ?
      AND situations.status = 'active'
    ORDER BY intake_sessions.updated_at DESC
    LIMIT ?`,
    [userId, limit],
  );
  return rows.map(rowToIntakeSession);
}

export async function listIntakeMessages(
  userId: number,
  sessionId: number,
): Promise<IntakeMessage[]> {
  return all<IntakeMessage>(
    `SELECT id, session_id, role, content, client_message_id, is_qa, created_at
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
  options: { clientMessageId?: string | null; isQa?: boolean } = {},
): Promise<IntakeMessage> {
  assertSafeTextFields({ content });
  await ensureOwnedRecord("intake_sessions", userId, sessionId);
  const clientMessageId = options.clientMessageId?.trim() || null;
  if (clientMessageId && role === "user") {
    const existing = await first<IntakeMessage>(
      `SELECT id, session_id, role, content, client_message_id, is_qa, created_at
      FROM intake_messages
      WHERE user_id = ? AND client_message_id = ?`,
      [userId, clientMessageId],
    );
    if (existing) return existing;
  }
  const session = await getIntakeSession(userId, sessionId);
  const isQa = options.isQa ?? Boolean(session?.is_qa);
  const id = await insert(
    `INSERT INTO intake_messages (
      user_id, session_id, role, content, client_message_id, is_qa, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, sessionId, role, content, clientMessageId, isQa ? 1 : 0, nowIso()],
  );
  const message = await first<IntakeMessage>(
    `SELECT id, session_id, role, content, client_message_id, is_qa, created_at
    FROM intake_messages WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  if (!message) throw new Error("Created intake message could not be loaded.");
  return message;
}

type NextMovePlanRow = Omit<
  StoredNextMovePlan,
  | "key_constraints"
  | "highest_leverage_move_today"
  | "first_10_minute_action"
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
  | "context_used"
  | "inferred_context_items"
  | "task_candidates"
  | "cognitive_metadata"
  | "assumptions"
  | "follow_up_questions_if_any"
> & {
  highest_leverage_move_json: string;
  first_10_minute_action_json?: string | null;
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
  context_used_json?: string | null;
  inferred_context_items_json?: string | null;
  task_candidates_json?: string | null;
  cognitive_metadata_json?: string | null;
  generation_mode?: string | null;
  situation_read?: string | null;
  likely_bottleneck?: string | null;
  key_constraints_json?: string | null;
  assumptions_json: string;
  follow_up_questions_json: string;
  is_qa?: number;
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
    generation_mode: "operator_plan",
    mode: row.mode,
    situation_read: row.situation_read || row.situation_summary,
    likely_bottleneck: row.likely_bottleneck || row.core_bottleneck,
    key_constraints: parseJson(row.key_constraints_json, []),
    situation_summary: row.situation_summary,
    core_bottleneck: row.core_bottleneck,
    highest_leverage_move_today: parseJson(row.highest_leverage_move_json, defaultMove),
    why_this_move: row.why_this_move,
    first_10_minute_action: parseJson(
      row.first_10_minute_action_json,
      defaultFirst10MinuteAction,
    ),
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
    context_used: parseJson(row.context_used_json, defaultContextUsed),
    inferred_context_items: parseJson(
      row.inferred_context_items_json,
      defaultInferredContextItems,
    ),
    task_candidates: normalizePlanTaskCandidates(
      parseJson(row.task_candidates_json, defaultTaskCandidates),
    ),
    confidence_level: row.confidence_level,
    assumptions: parseJson(row.assumptions_json, []),
    follow_up_questions_if_any: parseJson(row.follow_up_questions_json, []),
    cognitive_metadata: parseJson(
      row.cognitive_metadata_json,
      defaultCognitiveMetadata,
    ),
    raw_json: row.raw_json,
    is_qa: rowBoolean(row.is_qa),
    created_at: row.created_at,
  };
}

export async function createNextMovePlan(
  userId: number,
  situationId: number,
  sessionId: number | null,
  plan: NextMovePlanInput,
  model: string,
  options: {
    clientGenerationId?: string | null;
    cognitiveMetadata?: CognitiveMetadata | null;
    isQa?: boolean;
  } = {},
): Promise<StoredNextMovePlan> {
  await ensureOwnedRecord("situations", userId, situationId);
  await ensureOwnedRecord("intake_sessions", userId, sessionId);
  const situation = await getSituation(userId, situationId);
  const isQa = options.isQa ?? Boolean(situation?.is_qa);
  const compatiblePlan = plan as Partial<NextMovePlanInput> & NextMovePlanInput;
  const generationMode = compatiblePlan.generation_mode ?? "operator_plan";
  const situationRead = compatiblePlan.situation_read ?? plan.situation_summary;
  const likelyBottleneck = compatiblePlan.likely_bottleneck ?? plan.core_bottleneck;
  const keyConstraints =
    compatiblePlan.key_constraints?.length
      ? compatiblePlan.key_constraints
      : plan.recommendation_basis.slice(0, 3).map((basis) => basis.signal);
  const first10MinuteAction =
    compatiblePlan.first_10_minute_action ??
    plan.first_30_minutes[0] ??
    defaultFirst10MinuteAction;
  const contextUsed =
    compatiblePlan.context_used?.length
      ? compatiblePlan.context_used
      : plan.inferred_context_items.slice(0, 6).map((item) => ({
          id: null,
          label: item.label,
          value: item.value,
          category: "other" as const,
          sensitivity: item.sensitivity,
          source: "inferred" as const,
          persistence: item.persistence,
        }));
  const id = await insert(
    `INSERT INTO next_move_plans (
      user_id, situation_id, intake_session_id, model, generation_mode, mode,
      situation_read, likely_bottleneck, key_constraints_json,
      situation_summary, core_bottleneck,
      highest_leverage_move_json, why_this_move, first_10_minute_action_json, first_30_minutes_json,
      next_24_hours_json, next_7_days_json, what_not_to_do_json, likely_trap,
      recommendation_basis_json, restraint_guidance_json, friction_pattern,
      operator_insight_json, local_reality_scout_json, resources_to_seek_json, when_to_get_human_help,
      safety_boundary_json, context_used_json, inferred_context_items_json, task_candidates_json,
      confidence_level, assumptions_json,
      follow_up_questions_json, cognitive_metadata_json, raw_json, client_generation_id, is_qa, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      situationId,
      sessionId,
      model,
      generationMode,
      plan.mode,
      situationRead,
      likelyBottleneck,
      JSON.stringify(keyConstraints),
      plan.situation_summary,
      plan.core_bottleneck,
      JSON.stringify(plan.highest_leverage_move_today),
      plan.why_this_move,
      JSON.stringify(first10MinuteAction),
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
      JSON.stringify(contextUsed),
      JSON.stringify(plan.inferred_context_items),
      JSON.stringify(plan.task_candidates),
      plan.confidence_level,
      JSON.stringify(plan.assumptions),
      JSON.stringify(plan.follow_up_questions_if_any),
      options.cognitiveMetadata ? JSON.stringify(options.cognitiveMetadata) : null,
      JSON.stringify(plan),
      options.clientGenerationId ?? null,
      isQa ? 1 : 0,
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
  { isQa = false }: { isQa?: boolean } = {},
): Promise<StoredNextMovePlan | null> {
  const row = await first<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    WHERE user_id = ?
    ${qaClause("next_move_plans", isQa)}
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
  { isQa = false }: { isQa?: boolean } = {},
): Promise<StoredNextMovePlan[]> {
  const rows = await all<Parameters<typeof rowToNextMovePlan>[0]>(
    `SELECT * FROM next_move_plans
    WHERE user_id = ?
    ${qaClause("next_move_plans", isQa)}
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
  { isQa = false }: { isQa?: boolean } = {},
): Promise<Task[]> {
  const rows = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title,
      situations.urgency AS situation_urgency
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
      ${qaClause("tasks", isQa)}
    ORDER BY
      CASE tasks.status WHEN 'open' THEN 1 WHEN 'ignored' THEN 2 ELSE 3 END,
      tasks.importance DESC,
      tasks.created_at DESC`,
    [userId, situationId],
  );
  return rankTasks(withoutUserIds(rows) as Task[]);
}

export type TaskConversionResult = {
  created: boolean;
  alreadyExisted: boolean;
  items: Array<{ task: Task; globalRank: number }>;
};

function globalRankItems(globalTasks: Task[], planTasks: Task[]) {
  const planTaskIds = new Set(planTasks.map((task) => task.id));
  return globalTasks
    .map((task, index) => ({ task, globalRank: index + 1 }))
    .filter((item) => planTaskIds.has(item.task.id));
}

export async function createTasksFromNextMovePlan(
  userId: number,
  planId: number,
): Promise<TaskConversionResult> {
  const existing = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title,
      situations.urgency AS situation_urgency
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
  const existingTasks = rankTasks(withoutUserIds(existing) as Task[]);

  const plan = await getNextMovePlan(userId, planId);
  if (!plan) throw new Error("Plan not found.");
  const isQa = Boolean(plan.is_qa);

  if (existingTasks.length > 0) {
    const globalTasks = await listTasks(userId, { isQa });
    await attachTaskIdsToOutcomeForPlan(
      userId,
      planId,
      existingTasks.map((task) => task.id),
    );
    return {
      created: false,
      alreadyExisted: true,
      items: globalRankItems(globalTasks, existingTasks),
    };
  }

  const now = nowIso();
  const taskRows =
    plan.task_candidates.length > 0
      ? plan.task_candidates.slice(0, 3).map((candidate) => ({
          title: candidate.title,
          details: `${candidate.details}\n\nWhy ranked: ${candidate.rank_reason}`,
          section: candidate.candidate_type,
          importance: candidate.importance,
          effort: candidate.effort,
          friction_type: candidate.friction_type,
          due_date: candidate.due_date,
        }))
      : [
          ...plan.first_30_minutes.slice(0, 1).map((step) => ({
            ...step,
            section: "first_30_minutes",
            importance: 5,
            effort: 1,
            friction_type: "none" as const,
            due_date: null,
          })),
          ...plan.next_24_hours.slice(0, 1).map((step) => ({
            ...step,
            section: "next_24_hours",
            importance: 4,
            effort: 2,
            friction_type: "none" as const,
            due_date: null,
          })),
          ...plan.next_7_days.slice(0, 1).map((step) => ({
            ...step,
            section: "next_7_days",
            importance: 3,
            effort: 3,
            friction_type: "none" as const,
            due_date: null,
          })),
        ];

  for (const task of taskRows) {
    await run(
      `INSERT INTO tasks (
        user_id, title, life_area_id, project_id, situation_id, source_next_move_plan_id,
        source_plan_section, status, importance, effort, friction_type, due_date,
        notes, is_qa, created_at, updated_at
      ) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        task.title,
        plan.situation_id,
        plan.id,
        task.section,
        task.importance,
        task.effort,
        task.friction_type,
        task.due_date,
        task.details,
        isQa ? 1 : 0,
        now,
        now,
      ],
    );
  }

  const created = await all<Task & UserScopedRow>(
    `SELECT
      tasks.*,
      life_areas.name AS life_area_name,
      projects.name AS project_name,
      situations.title AS situation_title,
      situations.urgency AS situation_urgency
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
  const createdTasks = rankTasks(withoutUserIds(created) as Task[]);
  const globalTasks = await listTasks(userId, { isQa });
  await attachTaskIdsToOutcomeForPlan(
    userId,
    planId,
    createdTasks.map((task) => task.id),
  );
  return {
    created: true,
    alreadyExisted: false,
    items: globalRankItems(globalTasks, createdTasks),
  };
}

type OutcomeRecordRow = Omit<
  OutcomeRecord,
  "task_ids_created" | "is_qa"
> &
  UserScopedRow & {
    task_ids_created_json: string;
    is_qa?: number;
  };

function rowToOutcomeRecord(row: OutcomeRecordRow): OutcomeRecord {
  const safeRow = withoutUserId(row);
  const { task_ids_created_json, ...record } = safeRow;
  return {
    ...record,
    task_ids_created: parseJson(task_ids_created_json, []),
    is_qa: rowBoolean(row.is_qa),
  };
}

export async function createOutcomeRecord(
  userId: number,
  input: {
    source_message_id?: number | null;
    conversation_id?: string | null;
    next_move_plan_id?: number | null;
    detected_state: string;
    intervention_type: string;
    recommended_action?: string | null;
    task_ids_created?: number[];
    user_outcome?: OutcomeValue;
    evidence?: string;
    followup_at?: string | null;
    notes?: string;
    is_qa?: boolean;
  },
): Promise<OutcomeRecord> {
  await ensureOwnedRecord("intake_messages", userId, input.source_message_id ?? null);
  await ensureOwnedRecord(
    "next_move_plans",
    userId,
    input.next_move_plan_id ?? null,
  );
  const now = nowIso();
  const id = randomUUID();
  await run(
    `INSERT INTO outcome_records (
      id, user_id, source_message_id, conversation_id, next_move_plan_id,
      detected_state, intervention_type, recommended_action, task_ids_created_json,
      user_outcome, evidence, followup_at, notes, is_qa, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      input.source_message_id ?? null,
      input.conversation_id ?? null,
      input.next_move_plan_id ?? null,
      input.detected_state,
      input.intervention_type,
      input.recommended_action ?? null,
      JSON.stringify(input.task_ids_created ?? []),
      input.user_outcome ?? "unknown",
      input.evidence ?? "",
      input.followup_at ?? null,
      input.notes ?? "",
      input.is_qa ? 1 : 0,
      now,
      now,
    ],
  );
  const created = await getOutcomeRecord(userId, id);
  if (!created) throw new Error("Created outcome record could not be loaded.");
  return created;
}

export async function getOutcomeRecord(
  userId: number,
  id: string,
): Promise<OutcomeRecord | null> {
  const row = await first<OutcomeRecordRow>(
    "SELECT * FROM outcome_records WHERE id = ? AND user_id = ?",
    [id, userId],
  );
  return row ? rowToOutcomeRecord(row) : null;
}

export async function listRecentUnresolvedOutcomeRecords(
  userId: number,
  { limit = 5, isQa = false }: { limit?: number; isQa?: boolean } = {},
): Promise<OutcomeRecord[]> {
  const rows = await all<OutcomeRecordRow>(
    `SELECT * FROM outcome_records
    WHERE user_id = ?
      AND user_outcome IN ('unknown', 'needs_followup')
      ${qaClause("outcome_records", isQa)}
    ORDER BY created_at DESC
    LIMIT ?`,
    [userId, limit],
  );
  return rows.map(rowToOutcomeRecord);
}

export async function updateOutcomeRecord(
  userId: number,
  id: string,
  input: {
    user_outcome?: OutcomeValue;
    evidence?: string;
    followup_at?: string | null;
    notes?: string;
    task_ids_created?: number[];
  },
): Promise<OutcomeRecord | null> {
  const existing = await getOutcomeRecord(userId, id);
  if (!existing) return null;
  await run(
    `UPDATE outcome_records SET
      user_outcome = ?,
      evidence = ?,
      followup_at = ?,
      notes = ?,
      task_ids_created_json = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?`,
    [
      input.user_outcome ?? existing.user_outcome,
      input.evidence ?? existing.evidence,
      input.followup_at === undefined ? existing.followup_at : input.followup_at,
      input.notes ?? existing.notes,
      JSON.stringify(input.task_ids_created ?? existing.task_ids_created),
      nowIso(),
      id,
      userId,
    ],
  );
  return getOutcomeRecord(userId, id);
}

export async function updateOutcomeForNextMovePlan(
  userId: number,
  planId: number,
  input: {
    user_outcome: OutcomeValue;
    evidence: string;
    notes?: string;
  },
) {
  const row = await first<OutcomeRecordRow>(
    `SELECT * FROM outcome_records
    WHERE user_id = ? AND next_move_plan_id = ?
    ORDER BY created_at DESC
    LIMIT 1`,
    [userId, planId],
  );
  if (!row) return null;
  return updateOutcomeRecord(userId, row.id, input);
}

export async function attachTaskIdsToOutcomeForPlan(
  userId: number,
  planId: number,
  taskIds: number[],
) {
  if (taskIds.length === 0) return null;
  const row = await first<OutcomeRecordRow>(
    `SELECT * FROM outcome_records
    WHERE user_id = ? AND next_move_plan_id = ?
    ORDER BY created_at DESC
    LIMIT 1`,
    [userId, planId],
  );
  if (!row) return null;
  const existing = rowToOutcomeRecord(row);
  const merged = Array.from(new Set([...existing.task_ids_created, ...taskIds]));
  return updateOutcomeRecord(userId, existing.id, { task_ids_created: merged });
}

type GenerationEventRow = Omit<
  GenerationEvent,
  "is_qa" | "response_rewritten" | "web_search_used"
> &
  UserScopedRow & {
    is_qa?: number;
    response_rewritten?: number;
    web_search_used?: number;
  };

function rowToGenerationEvent(row: GenerationEventRow) {
  return {
    ...withoutUserId(row),
    response_rewritten: rowBoolean(row.response_rewritten),
    web_search_used: rowBoolean(row.web_search_used),
    is_qa: rowBoolean(row.is_qa),
  } as GenerationEvent;
}

export async function startGenerationEvent(
  userId: number,
  input: {
    client_generation_id: string;
    generation_type: GenerationType;
    situation_id?: number | null;
    retry_count?: number;
    is_qa?: boolean;
  },
): Promise<GenerationEvent> {
  const now = nowIso();
  await run(
    `INSERT INTO generation_events (
      user_id, client_generation_id, situation_id, generation_type, started_at,
      status, retry_count, is_qa, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)
    ON CONFLICT(user_id, client_generation_id) DO UPDATE SET
      status = 'running',
      started_at = excluded.started_at,
      completed_at = NULL,
      duration_ms = NULL,
      state_detected = NULL,
      intervention_type = NULL,
      model_used_by_stage_json = NULL,
      prompt_tokens_by_stage_json = NULL,
      completion_tokens_by_stage_json = NULL,
      evaluator_score = NULL,
      response_rewritten = 0,
      tasks_created_count = 0,
      memory_items_used = 0,
      web_search_used = 0,
      cognitive_metadata_json = NULL,
      retry_count = excluded.retry_count,
      error_category = NULL,
      updated_at = excluded.updated_at`,
    [
      userId,
      input.client_generation_id,
      input.situation_id ?? null,
      input.generation_type,
      now,
      input.retry_count ?? 0,
      input.is_qa ? 1 : 0,
      now,
      now,
    ],
  );
  const event = await getGenerationEvent(userId, input.client_generation_id);
  if (!event) throw new Error("Generation event could not be loaded.");
  return event;
}

export async function getGenerationEvent(
  userId: number,
  clientGenerationId: string,
): Promise<GenerationEvent | null> {
  const row = await first<GenerationEventRow>(
    "SELECT * FROM generation_events WHERE user_id = ? AND client_generation_id = ?",
    [userId, clientGenerationId],
  );
  return row ? rowToGenerationEvent(row) : null;
}

export async function completeGenerationEvent(
  userId: number,
  clientGenerationId: string,
  input: {
    status: Exclude<GenerationStatus, "running">;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    estimatedCost?: number | null;
    stateDetected?: string | null;
    interventionType?: string | null;
    modelUsedByStage?: Record<string, string> | null;
    promptTokensByStage?: Record<string, number> | null;
    completionTokensByStage?: Record<string, number> | null;
    evaluatorScore?: number | null;
    responseRewritten?: boolean | null;
    tasksCreatedCount?: number | null;
    memoryItemsUsed?: number | null;
    webSearchUsed?: boolean | null;
    cognitiveMetadata?: CognitiveMetadata | null;
    errorCategory?: string | null;
  },
) {
  const existing = await getGenerationEvent(userId, clientGenerationId);
  const now = nowIso();
  const startedAt = existing?.started_at ? Date.parse(existing.started_at) : Date.now();
  const durationMs = Math.max(0, Date.parse(now) - startedAt);
  await run(
    `UPDATE generation_events SET
      completed_at = ?,
      duration_ms = ?,
      status = ?,
      model = COALESCE(?, model),
      input_tokens = COALESCE(?, input_tokens),
      output_tokens = COALESCE(?, output_tokens),
      estimated_cost = COALESCE(?, estimated_cost),
      state_detected = COALESCE(?, state_detected),
      intervention_type = COALESCE(?, intervention_type),
      model_used_by_stage_json = COALESCE(?, model_used_by_stage_json),
      prompt_tokens_by_stage_json = COALESCE(?, prompt_tokens_by_stage_json),
      completion_tokens_by_stage_json = COALESCE(?, completion_tokens_by_stage_json),
      evaluator_score = COALESCE(?, evaluator_score),
      response_rewritten = COALESCE(?, response_rewritten),
      tasks_created_count = COALESCE(?, tasks_created_count),
      memory_items_used = COALESCE(?, memory_items_used),
      web_search_used = COALESCE(?, web_search_used),
      cognitive_metadata_json = COALESCE(?, cognitive_metadata_json),
      error_category = ?,
      updated_at = ?
    WHERE user_id = ? AND client_generation_id = ?`,
    [
      now,
      durationMs,
      input.status,
      input.model ?? null,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.estimatedCost ?? null,
      input.stateDetected ?? null,
      input.interventionType ?? null,
      input.modelUsedByStage ? JSON.stringify(input.modelUsedByStage) : null,
      input.promptTokensByStage ? JSON.stringify(input.promptTokensByStage) : null,
      input.completionTokensByStage
        ? JSON.stringify(input.completionTokensByStage)
        : null,
      input.evaluatorScore ?? null,
      typeof input.responseRewritten === "boolean"
        ? input.responseRewritten
          ? 1
          : 0
        : null,
      input.tasksCreatedCount ?? null,
      input.memoryItemsUsed ?? null,
      typeof input.webSearchUsed === "boolean" ? (input.webSearchUsed ? 1 : 0) : null,
      input.cognitiveMetadata ? JSON.stringify(input.cognitiveMetadata) : null,
      input.errorCategory ?? null,
      now,
      userId,
      clientGenerationId,
    ],
  );
}

export async function cancelGenerationEvent(
  userId: number,
  clientGenerationId: string,
) {
  await completeGenerationEvent(userId, clientGenerationId, {
    status: "canceled",
    errorCategory: "client_canceled",
  });
}

export async function markRunningGenerationAsRetry(
  userId: number,
  generationType: GenerationType,
  situationId: number | null,
) {
  await run(
    `UPDATE generation_events SET
      status = 'retry',
      completed_at = ?,
      updated_at = ?
    WHERE user_id = ?
      AND generation_type = ?
      AND status = 'running'
      AND ${situationId === null ? "situation_id IS NULL" : "situation_id = ?"}`,
    situationId === null
      ? [nowIso(), nowIso(), userId, generationType]
      : [nowIso(), nowIso(), userId, generationType, situationId],
  );
}

export async function isGenerationAbandoned(
  userId: number,
  clientGenerationId: string,
) {
  const event = await getGenerationEvent(userId, clientGenerationId);
  return (
    event?.status === "canceled" ||
    event?.status === "timeout" ||
    event?.status === "retry"
  );
}

export async function clearQaData(userId: number) {
  await run("DELETE FROM outcome_records WHERE user_id = ? AND is_qa = 1", [
    userId,
  ]);
  await run("DELETE FROM tasks WHERE user_id = ? AND is_qa = 1", [userId]);
  await run("DELETE FROM inferred_context_items WHERE user_id = ? AND is_qa = 1", [
    userId,
  ]);
  await run("DELETE FROM next_move_plans WHERE user_id = ? AND is_qa = 1", [userId]);
  await run("DELETE FROM intake_messages WHERE user_id = ? AND is_qa = 1", [userId]);
  await run("DELETE FROM intake_sessions WHERE user_id = ? AND is_qa = 1", [userId]);
  await run("DELETE FROM situations WHERE user_id = ? AND is_qa = 1", [userId]);
  await run("DELETE FROM generation_events WHERE user_id = ? AND is_qa = 1", [
    userId,
  ]);
}
