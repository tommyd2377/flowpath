import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCognitivePlanContext,
  detectRepeatedDecisionLoop,
  evaluateNextMovePlan,
} from "./cognitive-operating-layer";
import { outcomeHarnessFixtures } from "./outcome-harness-fixtures";
import type { IntakeMessage, NextMovePlan, Profile, Situation } from "./types";

const profile: Profile = {
  id: 1,
  personal_profile: "",
  current_season: "",
  core_priorities: "",
  constraints: "",
  operating_principles: "Prefer concrete next actions over generic advice.",
  remember: "",
  challenge_on: "",
  context_constraints: {},
  created_at: "2026-05-30T00:00:00.000Z",
  updated_at: "2026-05-30T00:00:00.000Z",
};

function situationFor(text: string, category = "custom"): Situation {
  return {
    id: 1,
    title: text,
    description: text,
    category,
    status: "active",
    urgency: "medium",
    created_at: "2026-05-30T00:00:00.000Z",
    updated_at: "2026-05-30T00:00:00.000Z",
  };
}

test("outcome harness includes 50 deterministic QA fixtures", () => {
  assert.equal(outcomeHarnessFixtures.length, 50);
  for (const fixture of outcomeHarnessFixtures) {
    assert.ok(fixture.id);
    assert.ok(fixture.text.length > 20);
    assert.ok(fixture.expectedDomain);
    assert.ok(fixture.expectedSubtype);
    assert.ok(fixture.expectedQuestionPurpose);
    assert.ok(fixture.maxTaskCount >= 0 && fixture.maxTaskCount <= 3);
  }
});

test("fixture coverage exercises high-stakes caution and lightweight factual paths", () => {
  const health = buildCognitivePlanContext({
    userMessage: "Is this medication side effect dangerous?",
    situation: situationFor("Is this medication side effect dangerous?", "health_recovery"),
    profile,
    inferredContextItems: [],
  });
  assert.equal(health.intervention.intervention_type, "health_caution");
  assert.equal(health.intervention.should_create_tasks, false);

  const financial = buildCognitivePlanContext({
    userMessage: "I found a suspicious financial brokerage charge and need the safe first step.",
    situation: situationFor(
      "I found a suspicious financial brokerage charge and need the safe first step.",
      "money_stability",
    ),
    profile,
    inferredContextItems: [],
  });
  assert.equal(financial.intervention.intervention_type, "financial_or_legal_caution");

  const factual = buildCognitivePlanContext({
    userMessage: "Look up the current DMV closing time today.",
    situation: situationFor("Look up the current DMV closing time today.", "something_else"),
    profile,
    inferredContextItems: [],
    allowWebSearch: true,
  });
  assert.equal(factual.stateDetection.primary_state, "research_mode");
  assert.equal(factual.webSearchDecision.should_use_web_search, true);
  assert.ok(factual.memorySelection.selected_memories.length <= 1);
});

test("repeated-loop cases trigger loop handling without model calls", () => {
  const messages: IntakeMessage[] = [
    {
      id: 1,
      session_id: 1,
      role: "user",
      content: "Should I change product direction?",
      created_at: "2026-05-30T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: 1,
      role: "user",
      content: "I am asking the same product direction question again.",
      created_at: "2026-05-30T00:02:00.000Z",
    },
  ];
  const repeated = detectRepeatedDecisionLoop({
    userMessage: messages[1].content,
    situation: situationFor(messages[1].content, "overwhelm"),
    messages,
    profile,
    inferredContextItems: [],
    historicalEffectiveness: {
      domain: "open_loops_prioritization",
      subtype: "rumination_loop",
      currentState: "rumination_mode",
      summaries: [],
      advisoryText: "",
      hasMeaningfulSignal: false,
      userPrefersShorterTasks: false,
      editedTasksDownCount: 0,
      ignoredSimilarTaskCount: 0,
      repeatedLoopCount: 1,
    },
  });

  assert.equal(repeated, true);
});

test("evaluator rejects generic fixture-style plans", () => {
  const context = buildCognitivePlanContext({
    userMessage: "I am asking the same product direction question again.",
    situation: situationFor(
      "I am asking the same product direction question again.",
      "overwhelm",
    ),
    messages: [],
    profile,
    inferredContextItems: [],
  });
  const plan: NextMovePlan = {
    generation_mode: "operator_plan",
    mode: "growth",
    situation_read: "Believe in yourself and think about it.",
    likely_bottleneck: "Unclear.",
    key_constraints: [],
    situation_summary: "The user is looping.",
    core_bottleneck: "More thinking.",
    highest_leverage_move_today: {
      title: "Think about the direction",
      description: "Reflect until it feels clear.",
      estimated_minutes: 60,
      success_condition: "More clarity.",
    },
    why_this_move: "It may help.",
    first_10_minute_action: { title: "Reflect", details: "Think about it." },
    first_30_minutes: [{ title: "Reflect", details: "Think about it." }],
    next_24_hours: [{ title: "Reflect", details: "Think about it." }],
    next_7_days: [{ title: "Reflect", details: "Think about it." }],
    what_not_to_do: [],
    likely_trap: "Thinking.",
    recommendation_basis: [],
    restraint_guidance: {
      should_push: false,
      reason: "Keep it small.",
      minimum_viable_move: "Think.",
      recovery_move: "Rest.",
      scope_boundary: "No scope.",
    },
    operator_insight: {
      naive_path: "Think more.",
      operator_path: "Think better.",
      wasted_motion_to_avoid: "Thinking badly.",
    },
    friction_pattern: "Loop.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use appropriate human help if needed.",
    safety_boundary: {
      risk_level: "low",
      professional_help_signal: "Use human help when needed.",
      do_not_rely_on_ai_for: "Do not rely on FlowPath for crisis decisions.",
      urgent_support_guidance: "Use emergency help if needed.",
    },
    context_used: [],
    inferred_context_items: [],
    task_candidates: [],
    confidence_level: "low",
    assumptions: [],
    follow_up_questions_if_any: [],
  };

  const evaluation = evaluateNextMovePlan(plan, context);
  assert.equal(evaluation.passes, false);
  assert.equal(evaluation.too_generic, true);
});
