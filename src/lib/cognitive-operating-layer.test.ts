import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCognitivePlanContext,
  detectRepeatedTopic,
  detectUserState,
  evaluateNextMovePlan,
  inferOutcomeFromUserMessage,
  selectIntervention,
  selectRelevantMemory,
  shouldUseWebSearch,
} from "./cognitive-operating-layer";
import type {
  InferredContextItem,
  IntakeMessage,
  NextMovePlan,
  Profile,
  Situation,
} from "./types";

const baseSituation: Situation = {
  id: 1,
  title: "Test situation",
  description: "I need a useful next move.",
  category: "custom",
  status: "active",
  urgency: "medium",
  created_at: "2026-05-23T00:00:00.000Z",
  updated_at: "2026-05-23T00:00:00.000Z",
};

const baseProfile: Profile = {
  id: 1,
  personal_profile: "Works on FlowPath, a Next.js and TypeScript product.",
  current_season: "Trying to turn planning into execution.",
  core_priorities: "Product usefulness, writing, and NYC social connection.",
  constraints: "Low energy late at night; prefers one concrete next action.",
  operating_principles: "Avoid overlong generic advice.",
  remember: "For coding questions, prefer repo-specific implementation steps.",
  challenge_on: "Challenge loops where more thinking replaces action.",
  context_constraints: {
    location: {
      value: "NYC",
      precision: "city_or_metro",
      persistence: "save_broad_constraint",
    },
  },
  created_at: "2026-05-23T00:00:00.000Z",
  updated_at: "2026-05-23T00:00:00.000Z",
};

const memoryItems: InferredContextItem[] = [
  {
    id: 1,
    label: "Project tooling",
    value: "FlowPath uses Next.js App Router, TypeScript, Tailwind, libSQL, and OpenAI.",
    category: "work_career",
    sensitivity: "low",
    persistence: "saved_memory",
    source: "manual",
    situation_id: null,
    intake_session_id: null,
    next_move_plan_id: null,
    created_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
  },
  {
    id: 2,
    label: "Screenplay focus",
    value: "Creative work should preserve character psychology and subtext.",
    category: "creative_personal_project",
    sensitivity: "low",
    persistence: "saved_memory",
    source: "manual",
    situation_id: null,
    intake_session_id: null,
    next_move_plan_id: null,
    created_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
  },
  {
    id: 3,
    label: "Social context",
    value: "NYC location matters for social and dating recommendations.",
    category: "location",
    sensitivity: "moderate",
    persistence: "saved_memory",
    source: "manual",
    situation_id: null,
    intake_session_id: null,
    next_move_plan_id: null,
    created_at: "2026-05-23T00:00:00.000Z",
    updated_at: "2026-05-23T00:00:00.000Z",
  },
];

function stateFor(message: string) {
  return detectUserState({
    userMessage: message,
    situation: baseSituation,
    messages: [],
    profile: baseProfile,
    inferredContextItems: memoryItems,
  });
}

test("state detector classifies core cognitive modes", () => {
  assert.equal(
    stateFor("I'm asking the same thing again and I keep overthinking it.").primary_state,
    "rumination_mode",
  );
  assert.equal(
    stateFor("Help me decide GTM and pricing for my startup MVP.").primary_state,
    "product_strategy_mode",
  );
  assert.equal(
    stateFor("I'm a founder looping on landing-page polish instead of customer validation.").primary_state,
    "product_strategy_mode",
  );
  assert.equal(
    stateFor("Debug this Next.js TypeScript API route implementation.").primary_state,
    "coding_mode",
  );
  assert.equal(
    stateFor("Give me screenplay feedback on the character subtext.").primary_state,
    "creative_mode",
  );
  assert.equal(
    stateFor("Can I mix this medication with a workout?").primary_state,
    "health_caution_mode",
  );
  assert.equal(
    stateFor("Look up the latest OpenAI API docs and pricing.").primary_state,
    "research_mode",
  );
});

test("rumination detection caps tasks and redirects to one action", () => {
  const messages: IntakeMessage[] = [
    {
      id: 1,
      session_id: 1,
      role: "user",
      content: "What if I picked the wrong product direction?",
      created_at: "2026-05-23T00:00:00.000Z",
    },
    {
      id: 2,
      session_id: 1,
      role: "assistant",
      content: "Choose one validation action.",
      created_at: "2026-05-23T00:01:00.000Z",
    },
    {
      id: 3,
      session_id: 1,
      role: "user",
      content: "What if I picked the wrong product direction again?",
      created_at: "2026-05-23T00:02:00.000Z",
    },
  ];

  assert.equal(detectRepeatedTopic(messages, messages[2].content), true);
  const context = buildCognitivePlanContext({
    userMessage: messages[2].content,
    situation: baseSituation,
    messages,
    profile: baseProfile,
    inferredContextItems: memoryItems,
  });

  assert.equal(context.stateDetection.primary_state, "rumination_mode");
  assert.equal(context.intervention.intervention_type, "stop_rumination_redirect_to_action");
  assert.equal(context.intervention.max_tasks, 1);
});

test("intervention selector handles execution and caution modes", () => {
  const execution = stateFor("I am ready to act today. Give me the concrete next steps.");
  assert.equal(selectIntervention(execution, { userMessage: execution.user_intent }).should_create_tasks, true);

  const health = stateFor("Is this medication side effect dangerous?");
  const healthIntervention = selectIntervention(health, { userMessage: health.user_intent });
  assert.equal(healthIntervention.intervention_type, "health_caution");
  assert.match(healthIntervention.must_avoid.join(" "), /Definitive diagnosis/i);
});

test("memory selection stays compact and category-aware", () => {
  const codingState = stateFor("Implement a TypeScript route in this Next.js app.");
  const selection = selectRelevantMemory(
    {
      userMessage: "Implement a TypeScript route in this Next.js app.",
      profile: baseProfile,
      inferredContextItems: memoryItems,
    },
    codingState,
  );

  assert.ok(selection.selected_memories.length >= 3);
  assert.ok(selection.selected_memories.length <= 8);
  assert.match(selection.selected_memories.map((item) => item.summary).join(" "), /Next\.js|TypeScript|FlowPath/i);
});

test("web search gating turns on for volatile docs and off for pure creative work", () => {
  const docsState = stateFor("Look up current API docs and pricing.");
  const docsIntervention = selectIntervention(docsState, { userMessage: docsState.user_intent });
  const docsDecision = shouldUseWebSearch(
    { userMessage: "Look up current API docs and pricing.", allowWebSearch: true },
    docsState,
    docsIntervention,
  );
  assert.equal(docsDecision.should_use_web_search, true);

  const creativeState = stateFor("Rewrite this screenplay scene for more subtext.");
  const creativeIntervention = selectIntervention(creativeState, { userMessage: creativeState.user_intent });
  const creativeDecision = shouldUseWebSearch(
    { userMessage: "Rewrite this screenplay scene for more subtext.", allowWebSearch: true },
    creativeState,
    creativeIntervention,
  );
  assert.equal(creativeDecision.should_use_web_search, false);
});

test("evaluator catches generic advice and too many rumination tasks", () => {
  const context = buildCognitivePlanContext({
    userMessage: "I'm asking the same thing again and spiraling.",
    situation: baseSituation,
    messages: [],
    profile: baseProfile,
    inferredContextItems: memoryItems,
  });
  const plan: NextMovePlan = {
    generation_mode: "operator_plan",
    mode: "growth",
    situation_read: "Believe in yourself and keep thinking about it.",
    likely_bottleneck: "Too much thinking.",
    key_constraints: ["Rumination"],
    situation_summary: "The user is looping.",
    core_bottleneck: "No action boundary.",
    highest_leverage_move_today: {
      title: "Think about options",
      description: "Think through what matters.",
      estimated_minutes: 60,
      success_condition: "More clarity.",
    },
    why_this_move: "It may help.",
    first_10_minute_action: { title: "Reflect", details: "Think about the question." },
    first_30_minutes: [{ title: "Reflect", details: "Think about the question." }],
    next_24_hours: [{ title: "Reflect more", details: "Think about the question." }],
    next_7_days: [{ title: "Reflect later", details: "Think about the question." }],
    what_not_to_do: ["Do not panic."],
    likely_trap: "Looping.",
    recommendation_basis: [
      { signal: "Repeated question", source: "message", implication: "Needs action." },
    ],
    restraint_guidance: {
      should_push: false,
      reason: "Keep it small.",
      minimum_viable_move: "One action.",
      recovery_move: "Breathe.",
      scope_boundary: "No more analysis.",
    },
    operator_insight: {
      naive_path: "Think more.",
      operator_path: "Act once.",
      wasted_motion_to_avoid: "More reassurance.",
    },
    friction_pattern: "Rumination.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use appropriate human help if safety is at risk.",
    safety_boundary: {
      risk_level: "low",
      professional_help_signal: "Use human help when appropriate.",
      do_not_rely_on_ai_for: "Do not rely on FlowPath for crisis decisions.",
      urgent_support_guidance: "Use emergency help if needed.",
    },
    context_used: [],
    inferred_context_items: [],
    task_candidates: [
      {
        title: "Think",
        details: "Think about it.",
        description: "Think about it.",
        estimated_minutes: 30,
        friction_level: "medium",
        leverage: "low",
        why_now: "More clarity.",
        success_condition: "More clarity.",
        category: "rumination",
        source_message_id: null,
        candidate_type: "immediate_next_action",
        importance: 2,
        effort: 3,
        friction_type: "unclear",
        rank_reason: "Could help.",
        due_date: null,
      },
      {
        title: "Think again",
        details: "Think again.",
        description: "Think again.",
        estimated_minutes: 30,
        friction_level: "medium",
        leverage: "low",
        why_now: "More clarity.",
        success_condition: "More clarity.",
        category: "rumination",
        source_message_id: null,
        candidate_type: "supporting",
        importance: 2,
        effort: 3,
        friction_type: "unclear",
        rank_reason: "Could help.",
        due_date: null,
      },
    ],
    confidence_level: "low",
    assumptions: [],
    follow_up_questions_if_any: [],
  };

  const evaluation = evaluateNextMovePlan(plan, context);
  assert.equal(evaluation.passes, false);
  assert.equal(evaluation.too_generic, true);
  assert.equal(evaluation.too_abstract, true);
  assert.ok(evaluation.rewrite_instructions.length > 0);
});

test("outcome inference is conservative but catches explicit follow-up language", () => {
  assert.equal(inferOutcomeFromUserMessage("I did it")?.userOutcome, "acted");
  assert.equal(inferOutcomeFromUserMessage("That didn't help")?.userOutcome, "rejected");
  assert.equal(inferOutcomeFromUserMessage("I feel better now")?.userOutcome, "improved");
  assert.equal(inferOutcomeFromUserMessage("Maybe later")?.userOutcome, undefined);
});
