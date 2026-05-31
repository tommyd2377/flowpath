import assert from "node:assert/strict";
import test from "node:test";

import { buildFirstIntakePlan, buildFirstIntakeQuestion } from "./intake";
import { interviewerOutputSchema } from "./schemas";
import type { SituationRoutingContext } from "./situation-routing";

function plan(input: Partial<SituationRoutingContext> & { title: string }) {
  return buildFirstIntakePlan({
    description: "",
    category: "custom",
    urgency: "medium",
    ...input,
  });
}

function assertUsableFirstQuestion(
  input: Partial<SituationRoutingContext> & { title: string },
  expected: {
    subtype: string;
    purpose: string;
    reflects: RegExp;
    avoids?: RegExp;
  },
) {
  const result = plan(input);
  assert.equal(result.subtype, expected.subtype);
  assert.equal(result.questionPurpose, expected.purpose);
  assert.notEqual(result.genericityRisk, "high");
  assert.match(result.question, expected.reflects);
  if (expected.avoids) assert.doesNotMatch(result.question, expected.avoids);
  return result;
}

test("routine medication decision asks about the decision concern, not recovery", () => {
  const result = assertUsableFirstQuestion(
    {
      title:
        "I'm trying to decide if I should ask my doctor for a generic prescription.",
      category: "health_recovery",
      urgency: "low",
    },
    {
      subtype: "routine_medication_discussion",
      purpose: "clarify_decision",
      reflects: /medication|prescription|doctor/i,
      avoids: /body-respecting|stabilizing|24-72 hours/i,
    },
  );

  assert.match(result.question, /side effects|cost|works/i);
});

test("symptom triage asks for current symptom details", () => {
  assertUsableFirstQuestion(
    {
      title: "I've had a weird rash and dizziness since yesterday.",
      category: "health_recovery",
      urgency: "medium",
    },
    {
      subtype: "symptom_triage",
      purpose: "clarify_current_state",
      reflects: /symptom|how long|severe|suddenly/i,
    },
  );
});

test("fitness recovery can use physical recovery framing", () => {
  assertUsableFirstQuestion(
    {
      title: "I'm rebuilding running stamina after an injury.",
      category: "health_recovery",
      urgency: "medium",
    },
    {
      subtype: "fitness_or_physical_recovery",
      purpose: "clarify_current_state",
      reflects: /recover|rebuild|pain|reinjury|consistency/i,
    },
  );
});

test("product pricing decision asks about the pricing tradeoff", () => {
  assertUsableFirstQuestion(
    {
      title: "I'm trying to decide whether to make my product free or charge early users.",
      category: "business",
      urgency: "medium",
    },
    {
      subtype: "product_strategy",
      purpose: "clarify_tradeoff",
      reflects: /free-versus-charging|API\/token costs|early users/i,
    },
  );
});

test("coding implementation blocker asks for system-specific constraints", () => {
  assertUsableFirstQuestion(
    {
      title: "I need help fixing a Next.js API route implementation bug.",
      category: "work_career",
      urgency: "medium",
    },
    {
      subtype: "coding_implementation",
      purpose: "clarify_constraint",
      reflects: /implementation blocker|file|route|error|design constraint/i,
    },
  );
});

test("creative character revision asks about the character arc", () => {
  assertUsableFirstQuestion(
    {
      title: "I need to revise the main character arc in my script.",
      category: "creative_project",
      urgency: "medium",
    },
    {
      subtype: "character_psychology",
      purpose: "clarify_creative_bottleneck",
      reflects: /character arc|want|moral turn|emotional payoff/i,
    },
  );
});

test("dating and social plans ask about the specific next action", () => {
  assertUsableFirstQuestion(
    {
      title: "I'm deciding whether to text someone from a dating app and ask to meet.",
      category: "relationships_connection",
      urgency: "medium",
    },
    {
      subtype: "dating_decision",
      purpose: "clarify_decision",
      reflects: /dating decision|message|meet|boundary|safer next step/i,
    },
  );
});

test("suspicious financial charge asks for transaction facts", () => {
  assertUsableFirstQuestion(
    {
      title: "I think I found a suspicious brokerage account charge.",
      category: "money_stability",
      urgency: "high",
    },
    {
      subtype: "suspicious_charge",
      purpose: "clarify_risk_or_safety",
      reflects: /charge or transaction|amount|merchant|date|pending|posted/i,
    },
  );
});

test("housing and benefits decisions ask about concrete process risk", () => {
  assertUsableFirstQuestion(
    {
      title: "I need to decide what to do about a rent assistance benefits letter.",
      category: "housing",
      urgency: "high",
    },
    {
      subtype: "benefits_or_assistance",
      purpose: "clarify_risk_or_safety",
      reflects: /benefits|assistance|eligibility|deadline|document|amount/i,
    },
  );
});

test("too many open loops asks for the pressure point", () => {
  assertUsableFirstQuestion(
    {
      title: "I have too many app ideas and don't know what to work on today.",
      category: "overwhelm",
      urgency: "medium",
    },
    {
      subtype: "too_many_tasks",
      purpose: "clarify_priority",
      reflects: /app idea|pressure|avoiding|highest payoff/i,
    },
  );
});

test("research and comparison questions use a reusable situation archetype", () => {
  const result = assertUsableFirstQuestion(
    {
      title: "Research local service providers for a time-sensitive project",
      category: "custom",
      urgency: "medium",
    },
    {
      subtype: "research_or_comparison",
      purpose: "clarify_success_criteria",
      reflects: /Research local service providers for a time-sensitive project|criteria that matter|options worth comparing|who to contact|example/i,
      avoids: /most want to change about this situation/i,
    },
  );

  assert.equal(result.genericityRisk, "low");
});

test("simple factual or logistical questions avoid heavy intake", () => {
  assertUsableFirstQuestion(
    {
      title: "What time does the DMV close today?",
      category: "something_else",
      urgency: "low",
    },
    {
      subtype: "factual_question",
      purpose: "clarify_goal",
      reflects: /fact|current|local information/i,
    },
  );
});

test("first question string API still returns the planned question", () => {
  const situation = {
    title: "I'm trying to decide whether to make my product free or charge early users.",
    category: "business",
    urgency: "medium" as const,
  };

  assert.equal(
    buildFirstIntakeQuestion(situation),
    buildFirstIntakePlan(situation).question,
  );
});

test("crisis and immediate danger routing still works", () => {
  assert.match(
    buildFirstIntakeQuestion(
      {
        title: "I feel suicidal and need crisis support",
        category: "social",
        urgency: "medium",
      },
    ),
    /call or text 988/i,
  );
  assert.match(
    buildFirstIntakeQuestion(
      {
        title: "Someone is in immediate danger",
        category: "social",
        urgency: "medium",
      },
    ),
    /call 911 or your local emergency number/i,
  );
});

test("follow-up interviewer schema remains structured for model-generated turns", () => {
  const parsed = interviewerOutputSchema.parse({
    question: "What constraint matters most?",
    current_stage: "understanding_constraints",
    is_complete: false,
    summary_so_far: "The user is deciding what to do next.",
    recommended_urgency: null,
    recommended_mode: null,
    inferred_context_items: [],
  });

  assert.equal(parsed.question, "What constraint matters most?");
});
