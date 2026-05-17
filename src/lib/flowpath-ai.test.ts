import assert from "node:assert/strict";
import test from "node:test";

import {
  intakeInferredMemoryInstruction,
  privacyAwareConstraintInstruction,
  socialConnectionInstruction,
} from "./flowpath-ai";
import { nextMovePlanSchema } from "./schemas";

test("privacy-aware prompt instructs least-sensitive constraint collection", () => {
  assert.match(privacyAwareConstraintInstruction, /least sensitive useful/i);
  assert.match(privacyAwareConstraintInstruction, /exact bank balances/i);
  assert.match(privacyAwareConstraintInstruction, /exact address/i);
  assert.match(privacyAwareConstraintInstruction, /exact date of birth/i);
  assert.match(privacyAwareConstraintInstruction, /parents did for a living/i);
});

test("intake memory prompt requires inferred constraints and small task candidates", () => {
  assert.match(intakeInferredMemoryInstruction, /infer practical constraints/i);
  assert.match(intakeInferredMemoryInstruction, /separate profile form/i);
  assert.match(intakeInferredMemoryInstruction, /inferred_context_items/i);
  assert.match(intakeInferredMemoryInstruction, /at most three concrete task_candidates/i);
  assert.match(intakeInferredMemoryInstruction, /session_only for high-sensitivity/i);
});

test("social connection prompt includes consent, boundaries, non-manipulation, and age safety", () => {
  assert.match(socialConnectionInstruction, /social isolation from loneliness/i);
  assert.match(socialConnectionInstruction, /consent/i);
  assert.match(socialConnectionInstruction, /boundaries/i);
  assert.match(socialConnectionInstruction, /pickup-artist tactics/i);
  assert.match(socialConnectionInstruction, /explicit sexual details/i);
  assert.match(socialConnectionInstruction, /under 18/i);
  assert.match(socialConnectionInstruction, /call or text 988/i);
  assert.match(socialConnectionInstruction, /call 911 or their local emergency number/i);
});

test("next move plan schema still requires structured insight fields", () => {
  const parsed = nextMovePlanSchema.safeParse({
    mode: "growth",
    situation_summary: "User is trying to change careers.",
    core_bottleneck: "No proof asset yet.",
    highest_leverage_move_today: {
      title: "Draft proof asset",
      description: "Create a small proof asset for the target role.",
      estimated_minutes: 45,
      success_condition: "A rough proof asset exists.",
    },
    why_this_move: "It creates hiring signal.",
    first_30_minutes: [{ title: "Outline", details: "Pick one target proof asset." }],
    next_24_hours: [{ title: "Draft", details: "Create a rough first version." }],
    next_7_days: [{ title: "Share", details: "Use it in five targeted messages." }],
    what_not_to_do: ["Do not spend weeks browsing courses first."],
    likely_trap: "Hiding in research.",
    recommendation_basis: [
      {
        signal: "Outside the system",
        source: "context constraints",
        implication: "Needs credibility signal before outreach.",
      },
    ],
    restraint_guidance: {
      should_push: true,
      reason: "A small proof asset is realistic.",
      minimum_viable_move: "Draft one artifact.",
      recovery_move: "Stop after the outline if energy drops.",
      scope_boundary: "Do not expand into a full course.",
    },
    operator_insight: {
      naive_path: "Apply to more jobs.",
      operator_path: "Create proof and use it in targeted outreach.",
      wasted_motion_to_avoid: "Long generic coursework.",
    },
    friction_pattern: "Unclear first step.",
    local_reality_scout: {
      used_web_search: false,
      location_basis: "",
      findings: [],
      missing_location_question: "",
    },
    resources_to_seek: [],
    when_to_get_human_help: "Use a career coach or trusted reviewer if stuck.",
    safety_boundary: {
      risk_level: "low",
      professional_help_signal: "Human help is optional.",
      do_not_rely_on_ai_for: "Do not rely on FlowPath for legal or financial decisions.",
      urgent_support_guidance: "If there is immediate danger, use emergency support.",
    },
    inferred_context_items: [
      {
        label: "Needs proof asset",
        value: "Career move depends on a concrete proof asset.",
        category: "work_career",
        sensitivity: "low",
        persistence: "proposed_memory",
        source: "plan",
      },
    ],
    task_candidates: [
      {
        title: "Outline proof asset",
        details: "Choose one target proof asset and write the outline.",
        candidate_type: "immediate_next_action",
        importance: 5,
        effort: 1,
        friction_type: "unclear",
        rank_reason: "It creates proof before more applications.",
        due_date: null,
      },
    ],
    confidence_level: "medium",
    assumptions: [],
    follow_up_questions_if_any: [],
  });

  assert.equal(parsed.success, true);
});
