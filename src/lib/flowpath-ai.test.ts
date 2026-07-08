import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  branchExpansionJsonSchema,
  branchExpansionSystemPrompt,
  boardNextMoveInstruction,
  buildFirstIntakeQuestionPromptInput,
  firstIntakeQuestionSystemPrompt,
  intakeInferredMemoryInstruction,
  operatorPlanInstruction,
  parseStructuredOutputWithRepair,
  parseFirstIntakeQuestionOutput,
  privacyAwareConstraintInstruction,
  reconciliationJsonSchema,
  reconciliationSystemPrompt,
  socialConnectionInstruction,
  StructuredOutputRecoveryError,
  trimNextMovePlanOutput,
} from "./flowpath-ai";
import { buildFallbackDecisionTree } from "./decision-tree";
import {
  DEFAULT_SAFETY_BOUNDARY,
  nextMovePlanSchema,
  reconciliationResultSchema,
  safetyBoundarySchema,
  type NextMovePlanInput,
} from "./schemas";
import type { Situation } from "./types";
import { nextMovePlanPromptModules } from "./prompts/flowpath-plan-prompts";

const baseSituation: Situation = {
  id: 1,
  title: "Research local service providers for a time-sensitive project",
  description: "",
  category: "custom",
  status: "active",
  urgency: "medium",
  created_at: "2026-05-30T00:00:00.000Z",
  updated_at: "2026-05-30T00:00:00.000Z",
};

const simpleStructuredSchema = z.object({
  answer: z.string(),
});

function parseSimpleStructuredOutput(outputText: string) {
  return simpleStructuredSchema.parse(JSON.parse(outputText));
}

test("structured output parser returns valid JSON without repair", async () => {
  let repairCalls = 0;
  const result = await parseStructuredOutputWithRepair({
    name: "test_structured_output",
    outputText: JSON.stringify({ answer: "ready" }),
    parse: parseSimpleStructuredOutput,
    repairOutputText: async () => {
      repairCalls += 1;
      return { outputText: JSON.stringify({ answer: "unused" }) };
    },
  });

  assert.equal(result.parsed.answer, "ready");
  assert.equal(result.structuredOutputRepaired, false);
  assert.equal(result.structuredOutputAttempts, 1);
  assert.equal(result.structuredOutputRepairAttempts, 0);
  assert.equal(repairCalls, 0);
});

test("structured output parser repairs malformed JSON once", async () => {
  const result = await parseStructuredOutputWithRepair({
    name: "test_structured_output",
    outputText: '{"answer": "almost"',
    parse: parseSimpleStructuredOutput,
    repairOutputText: async ({ initialErrorSummary, initialRawOutputExcerpt }) => {
      assert.match(initialErrorSummary, /JSON|position|Expected/i);
      assert.match(initialRawOutputExcerpt, /almost/);
      return { outputText: JSON.stringify({ answer: "repaired" }) };
    },
  });

  assert.equal(result.parsed.answer, "repaired");
  assert.equal(result.structuredOutputRepaired, true);
  assert.equal(result.structuredOutputAttempts, 2);
  assert.equal(result.structuredOutputRepairAttempts, 1);
  assert.match(result.initialRawOutputExcerpt ?? "", /almost/);
});

test("structured output parser repairs schema-invalid JSON once", async () => {
  const result = await parseStructuredOutputWithRepair({
    name: "test_structured_output",
    outputText: JSON.stringify({ answer: 42 }),
    parse: parseSimpleStructuredOutput,
    repairOutputText: async ({ initialErrorSummary }) => {
      assert.match(initialErrorSummary, /Expected string|Invalid input/i);
      return { outputText: JSON.stringify({ answer: "schema repaired" }) };
    },
  });

  assert.equal(result.parsed.answer, "schema repaired");
  assert.equal(result.structuredOutputRepaired, true);
  assert.match(result.initialErrorSummary ?? "", /answer|Expected string|Invalid input/i);
});

test("structured output parser throws structured recovery error after repair fails", async () => {
  await assert.rejects(
    () =>
      parseStructuredOutputWithRepair({
        name: "test_structured_output",
        outputText: '{"answer": "almost"',
        parse: parseSimpleStructuredOutput,
        repairOutputText: async () => ({ outputText: JSON.stringify({ answer: 42 }) }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof StructuredOutputRecoveryError);
      assert.match(error.initialErrorSummary, /JSON|position|Expected/i);
      assert.match(error.repairErrorSummary, /answer|Expected string|Invalid input/i);
      assert.match(error.initialRawOutputExcerpt, /almost/);
      return true;
    },
  );
});

test("privacy-aware prompt instructs least-sensitive constraint collection", () => {
  assert.match(privacyAwareConstraintInstruction, /least sensitive useful/i);
  assert.match(privacyAwareConstraintInstruction, /exact bank balances/i);
  assert.match(privacyAwareConstraintInstruction, /exact address/i);
  assert.match(privacyAwareConstraintInstruction, /exact date of birth/i);
  assert.match(privacyAwareConstraintInstruction, /parents did for a living/i);
});

test("board prompt frames FlowPath as a domain-general next-move engine", () => {
  assert.match(boardNextMoveInstruction, /system-led next-move engine/i);
  assert.match(boardNextMoveInstruction, /current position/i);
  assert.match(boardNextMoveInstruction, /constraints/i);
  assert.match(boardNextMoveInstruction, /assets/i);
  assert.match(boardNextMoveInstruction, /legal moves/i);
  assert.match(boardNextMoveInstruction, /Board Snapshot/i);
  assert.match(boardNextMoveInstruction, /Work\/Money\/Career/i);
  assert.match(boardNextMoveInstruction, /People\/Community\/Belonging/i);
  assert.match(boardNextMoveInstruction, /Craft\/Creativity\/Personal Mastery/i);
  assert.match(boardNextMoveInstruction, /urgent stability/i);
});

test("operator prompt requires decision tree branches and honest search status", () => {
  assert.match(operatorPlanInstruction, /decision_tree/i);
  assert.match(operatorPlanInstruction, /Move Map/i);
  assert.match(operatorPlanInstruction, /2-5 strategic branch options/i);
  assert.match(operatorPlanInstruction, /Recommend one line/i);
  assert.match(operatorPlanInstruction, /first_action/i);
  assert.match(operatorPlanInstruction, /which path should I take/i);
  assert.match(operatorPlanInstruction, /not sequential tasks/i);
  assert.match(operatorPlanInstruction, /next_steps/i);
  assert.match(operatorPlanInstruction, /action leaf/i);
  assert.match(operatorPlanInstruction, /search_status searched only when web search was actually used/i);
  assert.match(operatorPlanInstruction, /do not imply "I found"/i);
});

test("next move plan prompt modules separate board, move map, action, memory, search, and safety jobs", () => {
  assert.match(nextMovePlanPromptModules.boardSnapshotPrompt, /current position/i);
  assert.match(nextMovePlanPromptModules.boardSnapshotPrompt, /primary domain/i);
  assert.match(nextMovePlanPromptModules.boardSnapshotPrompt, /constraints/i);
  assert.match(nextMovePlanPromptModules.boardSnapshotPrompt, /assets/i);
  assert.match(nextMovePlanPromptModules.boardSnapshotPrompt, /assumptions/i);

  assert.match(nextMovePlanPromptModules.moveMapRootPrompt, /root Move Map/i);
  assert.match(nextMovePlanPromptModules.moveMapRootPrompt, /2-5 strategic branch options/i);
  assert.match(nextMovePlanPromptModules.moveMapRootPrompt, /sixth only when genuinely needed/i);
  assert.doesNotMatch(nextMovePlanPromptModules.moveMapRootPrompt, /exactly three/i);

  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /user-facing product copy/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /plain-language real-world option/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /Acting fundamentals/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /On-camera acting/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /Improv class/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /container/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /highest-signal/i);
  assert.match(nextMovePlanPromptModules.userFacingLabelInstruction, /provider/i);

  assert.match(nextMovePlanPromptModules.taskExtractionInstruction, /subordinate to the selected Move Map line/i);
  assert.match(nextMovePlanPromptModules.memoryExtractionInstruction, /Do not duplicate existing memory/i);
  assert.match(nextMovePlanPromptModules.safetyBoundaryInstruction, /urgent housing instability/i);
  assert.match(nextMovePlanPromptModules.outputSchemaInstruction, /schema requires/i);
  assert.doesNotMatch(operatorPlanInstruction, /life areas/i);
  assert.doesNotMatch(operatorPlanInstruction, /projects/i);
  assert.doesNotMatch(operatorPlanInstruction, /operator analysis/i);
  assert.doesNotMatch(operatorPlanInstruction, /full plan/i);
});

test("branch quality module forbids sequential task lists as root branches", () => {
  const instruction = nextMovePlanPromptModules.branchQualityInstruction;
  assert.match(instruction, /strategic alternatives/i);
  assert.match(instruction, /not sequential tasks/i);
  assert.match(instruction, /search local options/i);
  assert.match(instruction, /send one message/i);
  assert.match(instruction, /choose one weekly place/i);
  assert.match(instruction, /peer branches/i);
  assert.match(instruction, /Do not force exactly three branches/i);
  assert.match(instruction, /professional networking/i);
  assert.match(instruction, /local belonging/i);
  assert.match(instruction, /not dating/i);
});

test("user-facing label module bans internal strategy labels", () => {
  const instruction = nextMovePlanPromptModules.userFacingLabelInstruction;
  assert.match(instruction, /Move Map labels are user-facing/i);
  assert.match(instruction, /Do not use internal strategy vocabulary/i);
  assert.match(instruction, /lowest-friction/i);
  assert.match(instruction, /supporting prerequisite/i);
  assert.match(instruction, /class, course, clinic, group, or workshop/i);
  assert.match(instruction, /ask whether this level fits/i);
});

test("action leaf module requires concrete executable actions", () => {
  const instruction = nextMovePlanPromptModules.actionLeafInstruction;
  assert.match(instruction, /executable verb/i);
  assert.match(instruction, /object of action/i);
  assert.match(instruction, /scope or quantity/i);
  assert.match(instruction, /search query terms/i);
  assert.match(instruction, /shortlist criteria/i);
  assert.match(instruction, /target quantity/i);
  assert.match(instruction, /success condition/i);
  assert.match(instruction, /if-blocked fallback/i);
  assert.match(instruction, /Avoid vague actions/i);
  assert.match(instruction, /Network more/i);
  assert.match(instruction, /memory corrections/i);
  assert.match(instruction, /No action needed/i);
  assert.match(instruction, /private 30-minute writing session/i);
});

test("search honesty module forbids local verification claims without search", () => {
  const instruction = nextMovePlanPromptModules.searchHonestyInstruction;
  assert.match(instruction, /web_search_call_count is zero/i);
  assert.match(instruction, /do not imply "I found"/i);
  assert.match(instruction, /Use search_status searched only when web search was actually used/i);
  assert.match(instruction, /mark search_status needed/i);
  assert.match(instruction, /concrete search\/check workflow/i);
  assert.match(instruction, /target quantity/i);
  assert.match(instruction, /shortlist criteria/i);
  assert.match(instruction, /specific provider/i);
  assert.match(instruction, /advanced level/i);
  assert.match(instruction, /placement or fit/i);
});

test("social tone module avoids dating assumptions and manipulative language", () => {
  const instruction = nextMovePlanPromptModules.toneAndRealismInstruction;
  assert.match(instruction, /do not assume dating/i);
  assert.match(instruction, /friends\/community/i);
  assert.match(instruction, /pickup-artist/i);
  assert.match(instruction, /manipulation/i);
  assert.match(instruction, /repeatable real-world containers/i);
  assert.match(instruction, /preserve dignity and agency/i);
  assert.match(instruction, /deficient, broken, or socially failing/i);
  assert.match(instruction, /not trying to date/i);
});

test("branch expansion prompt is scoped to one selected path and avoids fake forks", () => {
  assert.match(branchExpansionSystemPrompt, /one selected branch/i);
  assert.match(branchExpansionSystemPrompt, /not writing a complete board plan/i);
  assert.match(branchExpansionSystemPrompt, /decision node/i);
  assert.match(branchExpansionSystemPrompt, /action leaf/i);
  assert.match(branchExpansionSystemPrompt, /user-facing product copy/i);
  assert.match(branchExpansionSystemPrompt, /2-5 options/i);
  assert.match(branchExpansionSystemPrompt, /Do not force exactly three/i);
  assert.match(branchExpansionSystemPrompt, /sequential steps/i);
  assert.match(branchExpansionSystemPrompt, /Do not hallucinate local\/current\/external facts/i);
  assert.match(branchExpansionSystemPrompt, /concrete action leaf/i);
  assert.match(branchExpansionSystemPrompt, /friendship\/community/i);
  assert.match(branchExpansionSystemPrompt, /not dating/i);
});

test("branch expansion JSON schema requires branch metadata and search status", () => {
  const schema = JSON.stringify(branchExpansionJsonSchema);
  assert.match(schema, /result_type/);
  assert.match(schema, /decision_node/);
  assert.match(schema, /action_leaf/);
  assert.match(schema, /short_rationale/);
  assert.match(schema, /recommendation_level/);
  assert.match(schema, /first_action_preview/);
  assert.match(schema, /search_status/);
  assert.match(schema, /search_needed/);
});

test("generated decision tree trim fills blank child node questions", () => {
  const output = trimNextMovePlanOutput({
    decision_tree: {
      id: "tree-1",
      root_node_id: "root",
      active_node_id: "action-1",
      recommended_option_id: "option-1",
      selected_path: ["option-1"],
      created_at: "2026-07-07T00:00:00.000Z",
      updated_at: "2026-07-07T00:00:00.000Z",
      nodes: [
        {
          id: "root",
          kind: "decision",
          title: "Root",
          question: "Which path should you take?",
          context_summary: "A root decision.",
          options: [],
        },
        {
          id: "action-1",
          kind: "action",
          title: "Contact or sign up",
          question: "   ",
          context_summary: "A generated action node with a blank question.",
          options: [],
        },
      ],
    },
  }) as {
    decision_tree: { nodes: Array<{ question: string }> };
  };

  assert.equal(
    output.decision_tree.nodes[1]?.question,
    "Take the next action for Contact or sign up.",
  );
});

test("reconciliation prompt prevents append-only contradictory memory", () => {
  assert.match(reconciliationSystemPrompt, /reconciliation engine/i);
  assert.match(reconciliationSystemPrompt, /Do not merely append/i);
  assert.match(reconciliationSystemPrompt, /updated, merged, marked stale, or forgotten/i);
  assert.match(reconciliationSystemPrompt, /direct user corrections as authoritative/i);
  assert.match(reconciliationSystemPrompt, /requires_user_confirmation/i);
  assert.match(reconciliationSystemPrompt, /selected Move Map path is still valid/i);
  assert.match(reconciliationSystemPrompt, /recommended_followup_action/i);
  assert.match(reconciliationSystemPrompt, /No action needed/i);
  assert.match(reconciliationSystemPrompt, /recalculate, or continue/i);
  assert.match(reconciliationSystemPrompt, /do not stop at "recalculate"/i);
  assert.match(reconciliationSystemPrompt, /private writing session/i);
});

test("reconciliation JSON schema exposes memory ids and board move-map effects", () => {
  const schema = JSON.stringify(reconciliationJsonSchema);
  assert.match(schema, /update_memory/);
  assert.match(schema, /merge_memory/);
  assert.match(schema, /mark_stale/);
  assert.match(schema, /delete_memory/);
  assert.match(schema, /memory_id/);
  assert.match(schema, /memory_ids/);
  assert.match(schema, /board_updates/);
  assert.match(schema, /move_map_effect/);
  assert.match(schema, /recommended_followup_action/);
});

test("reconciliation schema accepts update operations and move-map invalidation", () => {
  const parsed = reconciliationResultSchema.parse({
    summary: "Weekend availability changed the board.",
    confidence: "high",
    requires_user_confirmation: false,
    operations: [
      {
        type: "update_memory",
        memory_id: "1",
        label: "Availability",
        value: "Weekends are the only realistic time.",
        category: "time",
        sensitivity: "low",
        persistence: "saved_memory",
        confidence: "high",
        reason: "The user directly corrected availability.",
      },
    ],
    board_updates: {
      title: "",
      description: "",
      category: "",
      status: null,
      urgency: "medium",
      current_position_summary: "The board now has a weekend-only constraint.",
      constraints_to_add: ["Weekend-only availability"],
      constraints_to_remove: ["Weekday availability"],
      assets_to_add: [],
      assets_to_remove: [],
      goals_to_add: [],
      goals_to_remove: [],
      assumptions_to_add: [],
      assumptions_to_remove: [],
    },
    move_map_effect: {
      selected_path_still_valid: false,
      invalidated_node_ids: ["node_1"],
      invalidated_option_ids: ["weekday_option"],
      reason: "The selected path assumed weekday availability.",
      should_recalculate: true,
      should_preserve_existing_tree: false,
    },
    user_visible_explanation: "Updated the board with weekend-only availability.",
    recommended_followup_action:
      "Recalculate this board using weekend-only availability. Success: the Move Map only shows weekend-compatible options. If blocked, choose the current branch only if it can happen on a weekend.",
    follow_up_question: "",
  });

  assert.equal(parsed.operations[0].type, "update_memory");
  assert.equal(parsed.move_map_effect?.should_recalculate, true);
  assert.match(parsed.recommended_followup_action, /Recalculate this board/i);
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
  assert.match(socialConnectionInstruction, /professional networking/i);
  assert.match(socialConnectionInstruction, /local belonging/i);
  assert.match(socialConnectionInstruction, /not dating/i);
  assert.match(socialConnectionInstruction, /consent/i);
  assert.match(socialConnectionInstruction, /boundaries/i);
  assert.match(socialConnectionInstruction, /pickup-artist tactics/i);
  assert.match(socialConnectionInstruction, /explicit sexual details/i);
  assert.match(socialConnectionInstruction, /under 18/i);
  assert.match(socialConnectionInstruction, /immediate danger today/i);
  assert.match(socialConnectionInstruction, /near-term risk/i);
  assert.match(socialConnectionInstruction, /distress without intent/i);
  assert.match(socialConnectionInstruction, /do not ask why/i);
  assert.match(socialConnectionInstruction, /call or text 988/i);
  assert.match(socialConnectionInstruction, /call 911 or their local emergency number/i);
});

test("first intake prompt requires a situation-specific question", () => {
  assert.match(firstIntakeQuestionSystemPrompt, /specific to the submitted board position/i);
  assert.match(firstIntakeQuestionSystemPrompt, /concrete nouns, verbs, places, roles, artifacts/i);
  assert.match(firstIntakeQuestionSystemPrompt, /3-5 plausible lanes/i);
  assert.match(firstIntakeQuestionSystemPrompt, /Do not invent facts/i);
  assert.match(firstIntakeQuestionSystemPrompt, /meaningful progress/i);
  assert.match(firstIntakeQuestionSystemPrompt, /ask a safety-status question first/i);
  assert.match(firstIntakeQuestionSystemPrompt, /immediate danger today/i);
  assert.match(firstIntakeQuestionSystemPrompt, /near-term risk/i);
  assert.match(firstIntakeQuestionSystemPrompt, /distress without intent/i);
  assert.match(firstIntakeQuestionSystemPrompt, /must not ask why/i);
});

test("first intake prompt input includes the situation without a deterministic fallback", () => {
  const input = buildFirstIntakeQuestionPromptInput(baseSituation);

  assert.deepEqual(input.situation, {
    title: baseSituation.title,
    description: baseSituation.description,
    category: baseSituation.category,
    urgency: baseSituation.urgency,
  });
  assert.equal("deterministic_fallback" in input, false);
  assert.match(input.quality_requirements.join(" "), /concrete terms/i);
  assert.match(input.quality_requirements.join(" "), /safety status before/i);
  assert.match(input.quality_requirements.join(" "), /Do not ask why/i);
});

test("first intake output parser maps model output to planner metadata", () => {
  const output = parseFirstIntakeQuestionOutput(
    JSON.stringify({
      question:
        'For "Research local service providers for a time-sensitive project", are you trying to compare quality signals, find reachable providers, understand pricing, or decide who to contact first?',
      domain: "general",
      subtype: "research_or_comparison",
      question_purpose: "clarify_success_criteria",
      decision_shape: "research or comparison focus",
      missing_info_target: "criteria, comparison set, and contact target",
      why_this_question:
        "The situation is research-oriented, so the first useful answer is what signal should end the search.",
      situation_terms_used: ["research", "local service providers", "time-sensitive project"],
    }),
    baseSituation,
  );

  assert.equal(output.subtype, "research_or_comparison");
  assert.equal(output.questionPurpose, "clarify_success_criteria");
  assert.equal(output.genericityRisk, "low");
  assert.match(output.question, /local service providers/i);
  assert.match(output.question, /quality signals|pricing|contact/i);
});

test("first intake output parser does not repeat matching title and description", () => {
  const repeated = "I need help with my blue notebook problem";
  const situation: Situation = {
    ...baseSituation,
    title: repeated,
    description: repeated,
    category: "relationships_connection",
  };
  const output = parseFirstIntakeQuestionOutput(
    JSON.stringify({
      question: "Which constraint should FlowPath clarify first?",
      domain: "relationships/connection",
      subtype: "social_planning",
      question_purpose: "clarify_constraint",
      decision_shape: "constraint clarification",
      missing_info_target: "the barrier that would change the next move",
      why_this_question:
        "The situation needs the first practical constraint before planning.",
      situation_terms_used: ["blue notebook"],
    }),
    situation,
  );

  assert.equal(output.question.split(repeated).length - 1, 1);
});

test("next move plan schema still requires structured insight fields", () => {
  const plan = {
    generation_mode: "operator_plan",
    mode: "growth",
    situation_read: "User is trying to change careers without a proof asset.",
    likely_bottleneck: "No proof asset yet.",
    key_constraints: ["Needs proof before more outreach."],
    situation_summary: "User is trying to change careers.",
    core_bottleneck: "No proof asset yet.",
    highest_leverage_move_today: {
      title: "Draft proof asset",
      description: "Create a small proof asset for the target role.",
      estimated_minutes: 45,
      success_condition: "A rough proof asset exists.",
    },
    why_this_move: "It creates hiring signal.",
    first_10_minute_action: {
      title: "Name the proof asset",
      details: "Write the one artifact the target role would find credible.",
    },
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
    context_used: [
      {
        id: null,
        label: "Career proof gap",
        value: "Needs a concrete proof asset before more generic applications.",
        category: "career",
        sensitivity: "low",
        source: "situation",
        persistence: "session_only",
      },
    ],
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
        description: "Choose one target proof asset and write the outline.",
        estimated_minutes: 30,
        friction_level: "low",
        leverage: "high",
        why_now: "It creates proof before more applications.",
        success_condition: "The proof asset outline exists.",
        category: "work_career",
        source_message_id: null,
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
  } satisfies Omit<NextMovePlanInput, "decision_tree">;
  const parsed = nextMovePlanSchema.safeParse({
    ...plan,
    decision_tree: buildFallbackDecisionTree(plan),
  });

  assert.equal(parsed.success, true);
});

test("safety boundary schema defaults blank generated guidance", () => {
  const parsed = safetyBoundarySchema.parse({
    risk_level: "medium",
    professional_help_signal: "",
    do_not_rely_on_ai_for: "   ",
    urgent_support_guidance: "",
  });

  assert.equal(parsed.risk_level, "medium");
  assert.equal(
    parsed.professional_help_signal,
    DEFAULT_SAFETY_BOUNDARY.professional_help_signal,
  );
  assert.equal(
    parsed.do_not_rely_on_ai_for,
    DEFAULT_SAFETY_BOUNDARY.do_not_rely_on_ai_for,
  );
  assert.equal(
    parsed.urgent_support_guidance,
    DEFAULT_SAFETY_BOUNDARY.urgent_support_guidance,
  );
});
