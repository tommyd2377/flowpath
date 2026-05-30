import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import {
  buildCognitiveMetadata,
  buildCognitivePlanContext,
} from "./cognitive-operating-layer";
import { assertNoProhibitedData, ProhibitedDataError } from "./privacy";
import type { NextMovePlanInput } from "./schemas";

const dbPath = path.join(os.tmpdir(), `flowpath-repository-${process.pid}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.APP_TIMEZONE = "UTC";

let db: Awaited<typeof import("@/lib/db")>;
let repository: Awaited<typeof import("./repository")>;

function splitStatements(sql: string) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrations() {
  const migrationsDirectory = path.resolve(process.cwd(), "migrations");
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), "utf8");
    for (const statement of splitStatements(sql)) {
      await db.run(statement);
    }
  }
}

function minimalPlan(title = "Do one useful action"): NextMovePlanInput {
  return {
    mode: "growth",
    situation_summary: "A focused situation needs one next action.",
    core_bottleneck: "The next action needs to be concrete.",
    highest_leverage_move_today: {
      title,
      description: "Take one concrete action.",
      estimated_minutes: 20,
      success_condition: "The action is done.",
    },
    why_this_move: "It creates useful progress.",
    first_30_minutes: [{ title, details: "Do the smallest useful version." }],
    next_24_hours: [{ title: "Review result", details: "Write what changed." }],
    next_7_days: [{ title: "Repeat if useful", details: "Use the signal." }],
    what_not_to_do: ["Do not expand the scope."],
    likely_trap: "Overplanning.",
    recommendation_basis: [
      { signal: "Need action", source: "situation", implication: "Keep it small." },
    ],
    restraint_guidance: {
      should_push: false,
      reason: "Small action is enough.",
      minimum_viable_move: title,
      recovery_move: "Stop after the action.",
      scope_boundary: "Do not add new tasks.",
    },
    operator_insight: {
      naive_path: "Think more.",
      operator_path: "Run one experiment.",
      wasted_motion_to_avoid: "More abstraction.",
    },
    friction_pattern: "Scope creep.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use appropriate human help for high-stakes issues.",
    safety_boundary: {
      risk_level: "low",
      professional_help_signal: "Use human help when appropriate.",
      do_not_rely_on_ai_for: "Do not rely on FlowPath for emergency decisions.",
      urgent_support_guidance: "Use emergency services for immediate danger.",
    },
    inferred_context_items: [],
    task_candidates: [
      {
        title,
        details: "Do the smallest useful version.",
        description: "Do the smallest useful version.",
        estimated_minutes: 20,
        friction_level: "low",
        leverage: "high",
        why_now: "It creates an outcome signal.",
        success_condition: "The action is done.",
        category: "test",
        source_message_id: null,
        candidate_type: "immediate_next_action",
        importance: 5,
        effort: 1,
        friction_type: "none",
        rank_reason: "Small and high leverage.",
        due_date: null,
      },
    ],
    confidence_level: "medium",
    assumptions: [],
    follow_up_questions_if_any: [],
  };
}

before(async () => {
  db = await import("@/lib/db");
  repository = await import("./repository");
  await applyMigrations();
});

after(() => {
  db.db.close();
  fs.rmSync(dbPath, { force: true });
});

test("new profiles do not store manual memory explainer text", async () => {
  const profile = await repository.getProfile(1);

  assert.equal(profile.personal_profile, "");
  assert.equal(profile.current_season, "");
  assert.equal(profile.core_priorities, "");
  assert.equal(profile.constraints, "");
  assert.equal(profile.operating_principles, "");
  assert.equal(profile.remember, "");
  assert.equal(profile.challenge_on, "");
});

test("converts stored plan steps to tasks without re-blocking generated plan text", async () => {
  const plan: NextMovePlanInput = {
    mode: "stability",
    situation_summary: "User needs a safer broad plan for money pressure.",
    core_bottleneck: "The next step needs to stay practical and non-sensitive.",
    highest_leverage_move_today: {
      title: "Set the next money step",
      description: "Choose one broad action that reduces exposure.",
      estimated_minutes: 30,
      success_condition: "The next action is written down.",
    },
    why_this_move: "It creates a concrete next action without needing exact details.",
    first_30_minutes: [
      {
        title: "Write the broad constraint",
        details: "Use a safe range for the pressure and leave out exact balances.",
      },
    ],
    next_24_hours: [
      {
        title: "Call the bank",
        details: "Ask about account 123456789 and keep the note broad afterward.",
      },
    ],
    next_7_days: [
      {
        title: "Review the next stable step",
        details: "Keep future planning at the constraint level.",
      },
    ],
    what_not_to_do: ["Do not store exact sensitive details in planning notes."],
    likely_trap: "Overloading the plan with private details.",
    recommendation_basis: [
      {
        signal: "Money pressure",
        source: "situation",
        implication: "The plan needs broad constraints rather than exact account data.",
      },
    ],
    restraint_guidance: {
      should_push: false,
      reason: "A smaller stabilizing step is enough.",
      minimum_viable_move: "Write the broad next action.",
      recovery_move: "Stop after the first clear action.",
      scope_boundary: "Do not expand into full financial planning.",
    },
    operator_insight: {
      naive_path: "Try to solve the whole money situation today.",
      operator_path: "Create one safer next action and avoid exact stored details.",
      wasted_motion_to_avoid: "Collecting more private detail than the task needs.",
    },
    friction_pattern: "Too much detail can block action.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use qualified human help for financial decisions.",
    safety_boundary: {
      risk_level: "medium",
      professional_help_signal:
        "Use appropriate human help for financial or legal decisions.",
      do_not_rely_on_ai_for: "Do not rely on FlowPath for financial decisions.",
      urgent_support_guidance:
        "If there is immediate danger, contact emergency support.",
    },
    inferred_context_items: [
      {
        label: "Broad money pressure",
        value: "Money pressure is tight, without exact account details.",
        category: "money",
        sensitivity: "moderate",
        persistence: "saved_memory",
        source: "plan",
      },
    ],
    task_candidates: [
      {
        title: "Write the broad constraint",
        details: "Use a safe range for the pressure and leave out exact balances.",
        description: "Use a safe range for the pressure and leave out exact balances.",
        estimated_minutes: 15,
        friction_level: "low",
        leverage: "high",
        why_now: "It is the safest first move from the plan.",
        success_condition: "A broad next action is written without exact financial details.",
        category: "money",
        source_message_id: null,
        candidate_type: "immediate_next_action",
        importance: 5,
        effort: 1,
        friction_type: "none",
        rank_reason: "It is the safest first move from the plan.",
        due_date: null,
      },
      {
        title: "Call the bank",
        details: "Ask about account 123456789 and keep the note broad afterward.",
        description: "Ask about account 123456789 and keep the note broad afterward.",
        estimated_minutes: 30,
        friction_level: "medium",
        leverage: "medium",
        why_now: "It moves the situation forward after the first action.",
        success_condition: "The call is made or the next contact window is known.",
        category: "money",
        source_message_id: null,
        candidate_type: "follow_up",
        importance: 4,
        effort: 2,
        friction_type: "needs_person",
        rank_reason: "It moves the situation forward after the first action.",
        due_date: null,
      },
      {
        title: "Review the next stable step",
        details: "Keep future planning at the constraint level.",
        description: "Keep future planning at the constraint level.",
        estimated_minutes: 20,
        friction_level: "medium",
        leverage: "medium",
        why_now: "It keeps the plan scoped.",
        success_condition: "The next stable step is chosen.",
        category: "money",
        source_message_id: null,
        candidate_type: "supporting",
        importance: 3,
        effort: 3,
        friction_type: "none",
        rank_reason: "It keeps the plan scoped.",
        due_date: null,
      },
    ],
    confidence_level: "medium",
    assumptions: [],
    follow_up_questions_if_any: [],
  };

  assert.throws(
    () => assertNoProhibitedData(plan.next_24_hours[0].details),
    ProhibitedDataError,
  );

  const situation = await repository.createSituation(1, {
    title: "I am facing a money problem",
    category: "money",
    urgency: "medium",
  });
  const profile = await repository.getProfile(1);
  const cognitiveContext = buildCognitivePlanContext({
    userMessage: "I am facing a money problem and need one action.",
    situation,
    profile,
    inferredContextItems: [],
    allowWebSearch: false,
  });
  const cognitiveMetadata = buildCognitiveMetadata({
    context: cognitiveContext,
    evaluator: null,
    responseRewritten: false,
    modelUsedByStage: { generator: "test-model" },
    promptTokensByStage: { generator: 10 },
    completionTokensByStage: { generator: 20 },
    totalEstimatedCost: null,
    webSearchUsed: false,
  });
  const storedPlan = await repository.createNextMovePlan(
    1,
    situation.id,
    null,
    plan,
    "test-model",
    { cognitiveMetadata },
  );
  assert.equal(
    storedPlan.cognitive_metadata?.state_detection.primary_state,
    "legal_financial_caution_mode",
  );

  const outcome = await repository.createOutcomeRecord(1, {
    conversation_id: String(situation.id),
    next_move_plan_id: storedPlan.id,
    detected_state: cognitiveContext.stateDetection.primary_state,
    intervention_type: cognitiveContext.intervention.intervention_type,
    recommended_action: plan.highest_leverage_move_today.title,
  });
  assert.equal(outcome.user_outcome, "unknown");

  const conversion = await repository.createTasksFromNextMovePlan(1, storedPlan.id);
  const tasks = conversion.items.map((item) => item.task);

  assert.equal(tasks.length, 3);
  assert.equal(conversion.created, true);
  assert.equal(conversion.items.every((item) => item.globalRank > 0), true);
  assert.equal(tasks[1].title, "Call the bank");
  assert.equal(
    tasks[1].notes,
    "Ask about account 123456789 and keep the note broad afterward.\n\nWhy ranked: It moves the situation forward after the first action.",
  );

  const existingTasks = await repository.createTasksFromNextMovePlan(1, storedPlan.id);
  assert.equal(existingTasks.items.length, 3);
  assert.equal(existingTasks.alreadyExisted, true);

  const updatedOutcome = await repository.getOutcomeRecord(1, outcome.id);
  assert.equal(updatedOutcome?.task_ids_created.length, 3);

  const feedback = await repository.updateOutcomeForNextMovePlan(1, storedPlan.id, {
    user_outcome: "acted",
    evidence: "I did it",
  });
  assert.equal(feedback?.user_outcome, "acted");
});

test("inferred context items downgrade model-saved memory and can be updated or deleted", async () => {
  const situation = await repository.createSituation(1, {
    title: "I need career direction",
    category: "work_career",
    urgency: "medium",
  });

  const created = await repository.createInferredContextItem(
    1,
    {
      label: "Career proof gap",
      value: "Needs a stronger proof asset before more outreach.",
      category: "work_career",
      sensitivity: "low",
      persistence: "saved_memory",
      source: "plan",
      situation_id: situation.id,
      intake_session_id: null,
      next_move_plan_id: null,
    },
    { allowSavedMemory: false },
  );

  assert.equal(created.persistence, "proposed_memory");
  assert.equal(created.situation_title, "I need career direction");

  const saved = await repository.updateInferredContextItem(1, created.id, {
    persistence: "saved_memory",
  });
  assert.equal(saved?.persistence, "saved_memory");

  const deleted = await repository.deleteInferredContextItem(1, created.id);
  assert.equal(deleted, true);
  const remaining = await repository.listInferredContextItems(1);
  assert.equal(remaining.some((item) => item.id === created.id), false);
});

test("sensitive inferred context is not silently saved", async () => {
  const created = await repository.createInferredContextItem(
    1,
    {
      label: "Safety concern",
      value: "Use only broad safety context.",
      category: "safety_risk",
      sensitivity: "high",
      persistence: "saved_memory",
      source: "intake",
      situation_id: null,
      intake_session_id: null,
      next_move_plan_id: null,
    },
    { allowSavedMemory: false },
  );

  assert.equal(created.persistence, "proposed_memory");
  await repository.deleteInferredContextItem(1, created.id);
});

test("inferred context creation dedupes repeated notes in the same situation", async () => {
  const situation = await repository.createSituation(1, {
    title: "I need to clean up repeated memory cards",
    category: "work_career",
    urgency: "medium",
  });

  const first = await repository.createInferredContextItem(1, {
    label: "Available focus time",
    value: "About 2 focused hours tomorrow.",
    category: "time",
    sensitivity: "moderate",
    persistence: "session_only",
    source: "intake",
    situation_id: situation.id,
    intake_session_id: null,
    next_move_plan_id: null,
  });
  const second = await repository.createInferredContextItem(1, {
    label: "Available focused work time",
    value: "About 2 focused hours available tomorrow for career-search work.",
    category: "time",
    sensitivity: "high",
    persistence: "session_only",
    source: "plan",
    situation_id: situation.id,
    intake_session_id: null,
    next_move_plan_id: null,
  });

  assert.equal(second.id, first.id);
  assert.equal(second.sensitivity, "high");

  const items = await repository.listInferredContextItems(1);
  const matchingItems = items.filter(
    (item) =>
      item.situation_id === situation.id &&
      item.category === "time" &&
      item.persistence === "session_only",
  );
  assert.equal(matchingItems.length, 1);
});

test("QA cleanup removes QA outcome records", async () => {
  const outcome = await repository.createOutcomeRecord(1, {
    detected_state: "execution_mode",
    intervention_type: "one_next_action",
    recommended_action: "Do one QA action",
    is_qa: true,
  });

  await repository.clearQaData(1);
  assert.equal(await repository.getOutcomeRecord(1, outcome.id), null);
});

test("outcome harness events dedupe and update intervention summaries", async () => {
  const event = await repository.createOutcomeHarnessEvent(1, {
    eventType: "suggested_action_shown",
    source: "suggested_action",
    stateDetected: "execution_mode",
    interventionType: "one_next_action",
    domain: "work",
    subtype: "test",
    metadata: { estimatedMinutes: 20 },
    dedupeKey: "repo-test-shown",
    isQa: true,
  });
  const duplicate = await repository.createOutcomeHarnessEvent(1, {
    eventType: "suggested_action_shown",
    source: "suggested_action",
    stateDetected: "execution_mode",
    interventionType: "one_next_action",
    domain: "work",
    subtype: "test",
    metadata: { estimatedMinutes: 20 },
    dedupeKey: "repo-test-shown",
    isQa: true,
  });
  assert.equal(duplicate.id, event.id);

  await repository.createOutcomeHarnessEvent(1, {
    eventType: "suggested_action_accepted",
    source: "suggested_action",
    stateDetected: "execution_mode",
    interventionType: "one_next_action",
    domain: "work",
    subtype: "test",
    metadata: { estimatedMinutes: 20 },
    isQa: true,
  });

  const summaries = await repository.summarizeInterventionEffectiveness(1, {
    isQa: true,
  });
  const matching = summaries.find(
    (item) => item.domain === "work" && item.subtype === "test",
  );
  assert.equal(matching?.shown_count, 1);
  assert.equal(matching?.accepted_count, 1);
  assert.ok((matching?.effectiveness_score ?? 0) > 0);

  const dashboard = await repository.getOutcomeHarnessDashboardSummary(1, {
    isQa: true,
  });
  assert.ok(dashboard.totals.suggestedActionsShown >= 1);
  assert.ok(dashboard.rates.acceptRate > 0);
});

test("ignored suggested actions are detected lazily without user-facing spam", async () => {
  const situation = await repository.createSituation(
    1,
    {
      title: "Outcome harness stale action",
      category: "work_career",
      urgency: "medium",
    },
    { isQa: true },
  );
  const storedPlan = await repository.createNextMovePlan(
    1,
    situation.id,
    null,
    minimalPlan("Try one stale action"),
    "test-model",
    { isQa: true },
  );
  await repository.createOutcomeHarnessEvent(1, {
    situationId: situation.id,
    conversationId: String(situation.id),
    planId: storedPlan.id,
    eventType: "suggested_action_shown",
    source: "suggested_action",
    stateDetected: "execution_mode",
    interventionType: "one_next_action",
    domain: "work",
    subtype: "stale",
    metadata: { estimatedMinutes: 20 },
    dedupeKey: `stale-test-shown:${storedPlan.id}`,
    isQa: true,
  });
  await db.run(
    "UPDATE outcome_harness_events SET created_at = ? WHERE dedupe_key = ?",
    [
      "2026-05-28T00:00:00.000Z",
      `stale-test-shown:${storedPlan.id}`,
    ],
  );

  const ignored = await repository.recordIgnoredSuggestedActions(1, { isQa: true });
  assert.equal(
    ignored.some(
      (event) =>
        event.event_type === "suggested_action_ignored" &&
        event.plan_id === storedPlan.id,
    ),
    true,
  );
});
