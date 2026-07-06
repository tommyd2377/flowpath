import assert from "node:assert/strict";
import test from "node:test";

import { branchExpansionResultSchema } from "../schemas";
import { evalScenarios } from "./fixtures";
import { mockOutputsByScenarioId } from "./mock-outputs";
import { renderEvalReportMarkdown } from "./report";
import {
  detectBranchQualityIssues,
  scoreEvalScenario,
  scoreEvalSuite,
} from "./rubric";
import { resolveEvalMode } from "./run-evals";
import type { EvalOutput } from "./types";

function cloneOutput(output: EvalOutput): EvalOutput {
  return JSON.parse(JSON.stringify(output)) as EvalOutput;
}

function dimensionScore(result: ReturnType<typeof scoreEvalScenario>, id: string) {
  const score = result.scores.find((item) => item.id === id);
  assert.ok(score, `missing score for ${id}`);
  return score.score;
}

test("offline eval fixtures cover the required scenario set and score successfully", () => {
  assert.equal(evalScenarios.length, 10);
  for (const scenario of evalScenarios) {
    assert.ok(mockOutputsByScenarioId[scenario.id], `missing mock output for ${scenario.id}`);
  }

  const report = scoreEvalSuite(evalScenarios, mockOutputsByScenarioId, {
    generatedAt: "2026-07-06T00:00:00.000Z",
    mode: "offline",
    gitCommit: "test",
    modelConfig: "offline mocked outputs",
  });

  assert.equal(report.passed, true);
  assert.equal(report.results.every((result) => result.passed), true);
  assert.ok(report.overallScore / report.maxScore > 0.8);
});

test("branch expansion schema accepts decision nodes and action leaves but rejects too many options", () => {
  const validDecisionNode = mockOutputsByScenarioId.tennis_local_community.branchExpansion;
  assert.ok(validDecisionNode);
  assert.equal(branchExpansionResultSchema.safeParse(validDecisionNode).success, true);

  const validActionLeaf = {
    result_type: "action_leaf",
    node: null,
    action_leaf: {
      kind: "action",
      title: "Contact one class",
      first_action: "Send one message asking whether beginners can join this weekend.",
      first_10_minutes: "Find the contact form and paste the short message.",
      success_condition: "One message is sent.",
      if_blocked: "Call the listed number or choose the next class.",
      search_status: "needed",
    },
    reasoning_summary: "The path is actionable.",
    selected_path_summary: "Recurring beginner class",
    memory_used: [],
    assumptions: [],
    search_needed: true,
  };
  assert.equal(branchExpansionResultSchema.safeParse(validActionLeaf).success, true);

  const tooManyOptions = JSON.parse(JSON.stringify(validDecisionNode));
  while (tooManyOptions.node.options.length < 7) {
    tooManyOptions.node.options.push({
      label: `Extra option ${tooManyOptions.node.options.length}`,
      short_rationale: "Distinct but over the hard option limit.",
      recommendation_level: "viable",
      can_explore: true,
      search_status: "not_needed",
      friction: "medium",
      time_to_feedback: "This week",
      first_action_preview: "Do one small thing.",
    });
  }
  assert.equal(branchExpansionResultSchema.safeParse(tooManyOptions).success, false);
});

test("search honesty fails when searched status appears without a search call", () => {
  const scenario = evalScenarios.find((item) => item.id === "tennis_local_community");
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  assert.ok(output.decisionTree);
  output.decisionTree.nodes[0].search_status = "searched";
  output.decisionTree.nodes[0].options[0].search_status = "searched";
  output.webSearchCallCount = 0;

  const result = scoreEvalScenario(scenario, output);
  assert.ok(
    result.criticalFailures.some(
      (failure) => failure.id === "hallucinated_local_without_search",
    ),
  );
});

test("branch quality detects duplicate branches and task-like peer branches", () => {
  const issues = detectBranchQualityIssues([
    { label: "Search for a class" },
    { label: "Send a message" },
    { label: "Search for a class" },
  ]);
  assert.ok(issues.duplicateLabels.length > 0);
  assert.ok(issues.taskLikeLabels.length >= 2);

  const scenario = evalScenarios.find((item) => item.id === "yoga_social_connection");
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.yoga_social_connection);
  assert.ok(output.decisionTree);
  output.decisionTree.nodes[0].options[1].label =
    output.decisionTree.nodes[0].options[0].label;
  const result = scoreEvalScenario(scenario, output);
  assert.ok(result.criticalFailures.some((failure) => failure.id === "duplicate_branches"));
});

test("memory eval fails when stale memory remains active", () => {
  const scenario = evalScenarios.find(
    (item) => item.id === "memory_correction_private_writing",
  );
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.memory_correction_private_writing);
  const staleMemory = output.memoryItems?.find((memory) =>
    memory.label.includes("Monetize"),
  );
  assert.ok(staleMemory);
  staleMemory.status = "active";

  const result = scoreEvalScenario(scenario, output);
  assert.ok(result.criticalFailures.some((failure) => failure.id === "stale_memory_used"));
});

test("social tone eval treats not-dating as a constraint and penalizes dating assumptions", () => {
  const scenario = evalScenarios.find((item) => item.id === "community_not_dating");
  assert.ok(scenario);

  const goodOutput = cloneOutput(mockOutputsByScenarioId.community_not_dating);
  const goodResult = scoreEvalScenario(scenario, goodOutput);
  assert.ok(dimensionScore(goodResult, "tone_and_realism") >= 2.5);

  const datingOutput = cloneOutput(mockOutputsByScenarioId.community_not_dating);
  assert.ok(datingOutput.decisionTree);
  datingOutput.decisionTree.nodes[0].options.push({
    ...datingOutput.decisionTree.nodes[0].options[0],
    id: "dating_apps",
    label: "Dating apps",
    description: "Use dating apps to meet romantic partners.",
    recommendation_level: "viable",
  });
  const datingResult = scoreEvalScenario(scenario, datingOutput);
  assert.ok(
    dimensionScore(datingResult, "tone_and_realism") <
      dimensionScore(goodResult, "tone_and_realism"),
  );
});

test("reconciliation action scoring rewards concrete next steps over generic updates", () => {
  const memoryScenario = evalScenarios.find(
    (item) => item.id === "memory_correction_private_writing",
  );
  assert.ok(memoryScenario);
  const memoryOutput = cloneOutput(mockOutputsByScenarioId.memory_correction_private_writing);
  const memoryResult = scoreEvalScenario(memoryScenario, memoryOutput);
  assert.ok(dimensionScore(memoryResult, "action_concreteness") >= 2.5);

  const vagueMemoryOutput = cloneOutput(memoryOutput);
  assert.ok(vagueMemoryOutput.reconciliation);
  vagueMemoryOutput.reconciliation.user_visible_explanation = "Memory updated.";
  vagueMemoryOutput.reconciliation.recommended_followup_action = "";
  const vagueMemoryResult = scoreEvalScenario(memoryScenario, vagueMemoryOutput);
  assert.ok(
    dimensionScore(vagueMemoryResult, "action_concreteness") <
      dimensionScore(memoryResult, "action_concreteness"),
  );

  const weekendScenario = evalScenarios.find(
    (item) => item.id === "board_update_weekends_only",
  );
  assert.ok(weekendScenario);
  const weekendResult = scoreEvalScenario(
    weekendScenario,
    cloneOutput(mockOutputsByScenarioId.board_update_weekends_only),
  );
  assert.ok(dimensionScore(weekendResult, "action_concreteness") >= 2.5);
});

test("report renderer includes scenario scores and critical failure summary", () => {
  const report = scoreEvalSuite(evalScenarios.slice(0, 1), mockOutputsByScenarioId, {
    generatedAt: "2026-07-06T00:00:00.000Z",
    mode: "offline",
    gitCommit: "test",
    modelConfig: "offline mocked outputs",
  });
  const markdown = renderEvalReportMarkdown(report);
  assert.match(markdown, /FlowPath Output Quality Eval/);
  assert.match(markdown, /Tennis \/ local community/);
  assert.match(markdown, /Scenario Summary/);
});

test("live eval mode is explicitly gated", () => {
  assert.equal(resolveEvalMode(["--offline"], {}), "offline");
  assert.throws(
    () => resolveEvalMode(["--live"], {}),
    /FLOWPATH_LIVE_EVALS=1/,
  );
  assert.throws(
    () => resolveEvalMode(["--live"], { FLOWPATH_LIVE_EVALS: "1" }),
    /OPENAI_API_KEY/,
  );
  assert.throws(
    () =>
      resolveEvalMode(["--live"], {
        FLOWPATH_LIVE_EVALS: "1",
        OPENAI_API_KEY: "test",
      }),
    /FLOWPATH_LIVE_EVAL_MAX_CALLS/,
  );
  assert.equal(
    resolveEvalMode(["--live"], {
      FLOWPATH_LIVE_EVALS: "1",
      OPENAI_API_KEY: "test",
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "1",
    }),
    "live",
  );
});
