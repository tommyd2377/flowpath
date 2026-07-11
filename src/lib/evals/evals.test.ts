import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { branchExpansionResultSchema } from "../schemas";
import {
  ANTI_OVERFIT_SCENARIO_COUNT,
  EVAL_SCENARIO_TAGS,
  antiOverfitScenarios,
  evalScenarios,
  regressionScenarios,
  scenariosForSuite,
} from "./fixtures";
import { mockOutputsByScenarioId } from "./mock-outputs";
import {
  renderEvalReportMarkdown,
  renderLiveComparisonReportMarkdown,
  writeEvalReport,
  writeLiveComparisonReport,
} from "./report";
import {
  detectBranchQualityIssues,
  detectAntiOverfitLeakage,
  detectMoveMapLabelQualityIssues,
  detectSearchWorkflowGaps,
  scoreEvalScenario,
  scoreEvalSuite,
} from "./rubric";
import {
  anonymizePairwiseOutputs,
  baselineAnswerSchema,
  buildDirectBaselinePrompt,
  buildPairwiseJudgePrompt,
  inferPairwiseRationaleChoice,
  liveComparisonReadiness,
  pairwiseMappingWarningForRationale,
  parsePairwisePreferenceChoice,
  preferenceToSystem,
  selectLiveComparisonScenarios,
  shouldRunPairwiseJudge,
  trimBaselineAnswerForSchema,
} from "./live-comparison";
import {
  evalSuiteFromEnv,
  liveEvalReadiness,
  resolveEvalMode,
  selectLiveEvalScenarios,
} from "./run-evals";
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
  assert.equal(regressionScenarios.length, 12);
  assert.equal(antiOverfitScenarios.length, 30);
  assert.equal(ANTI_OVERFIT_SCENARIO_COUNT, 30);
  assert.equal(evalScenarios.length, 42);
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

test("anti-overfit fixtures have required metadata, unique IDs, valid tags, and no banned prompt leakage", () => {
  const ids = new Set<string>();
  const validTags = new Set<string>(EVAL_SCENARIO_TAGS);
  for (const scenario of antiOverfitScenarios) {
    assert.equal(scenario.suite, "anti_overfit");
    assert.ok(!ids.has(scenario.id), `duplicate id ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(scenario.name, `missing name for ${scenario.id}`);
    assert.ok(scenario.description, `missing description for ${scenario.id}`);
    assert.ok(scenario.userInputs.length >= 1, `missing user input for ${scenario.id}`);
    assert.ok(
      scenario.tags?.includes("anti_overfit"),
      `missing anti_overfit tag for ${scenario.id}`,
    );
    for (const tag of scenario.tags ?? []) {
      assert.ok(validTags.has(tag), `invalid tag ${tag} on ${scenario.id}`);
    }
    assert.equal(
      detectAntiOverfitLeakage(
        scenario,
        `${scenario.name} ${scenario.description} ${scenario.userInputs.join(" ")}`,
      ).length,
      0,
      `fixture prompt leaks banned Tom-shaped terms: ${scenario.id}`,
    );
  }
});

test("anti-overfit leakage detector catches developer-shaped output concepts", () => {
  const scenario = antiOverfitScenarios.find(
    (item) => item.id === "career_nurse_leave_bedside",
  );
  assert.ok(scenario);
  assert.deepEqual(detectAntiOverfitLeakage(scenario, "Try tennis in Brooklyn."), [
    "tennis",
    "Brooklyn",
  ]);
  assert.deepEqual(
    detectAntiOverfitLeakage(scenario, "Try case management or utilization review."),
    [],
  );
});

test("suite selection separates regression, anti-overfit, and combined scenarios", () => {
  assert.equal(scenariosForSuite("regression").length, 12);
  assert.equal(scenariosForSuite("anti_overfit").length, 30);
  assert.equal(scenariosForSuite("combined").length, 42);
  assert.equal(evalSuiteFromEnv(["--suite=anti-overfit"], {}), "anti_overfit");
  assert.equal(evalSuiteFromEnv([], { FLOWPATH_EVAL_SUITE: "regression" }), "regression");
  assert.equal(
    evalSuiteFromEnv([], { FLOWPATH_LIVE_EVAL_SUITE: "anti_overfit" }),
    "anti_overfit",
  );
  assert.throws(
    () => evalSuiteFromEnv([], { FLOWPATH_EVAL_SUITE: "unknown" }),
    /Unknown eval suite/,
  );
});

test("acting-class eval catches internal branch labels and weak provider grounding", () => {
  const scenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(scenario);

  const issues = detectMoveMapLabelQualityIssues([
    "Brooklyn-first advanced improv container",
    "Highest-signal version",
    "Acting fundamentals",
  ]);
  assert.deepEqual(issues, [
    "Brooklyn-first advanced improv container",
    "Highest-signal version",
  ]);

  const goodOutput = cloneOutput(mockOutputsByScenarioId.acting_class_brooklyn);
  const goodResult = scoreEvalScenario(scenario, goodOutput);
  assert.equal(goodResult.criticalFailures.length, 0);
  assert.ok(dimensionScore(goodResult, "label_quality") >= 2.5);

  const badOutput = cloneOutput(goodOutput);
  assert.ok(badOutput.decisionTree);
  const root = badOutput.decisionTree.nodes[0];
  root.options[0].label = "Brooklyn-first advanced improv container";
  root.options[1].label = "Actor-centered on-camera path";
  root.options[2].label = "Lowest-friction version";
  root.options[3].label = "Highest-signal version";
  root.options[0].first_action.title = "Enroll in BCC Level 3";
  root.options[0].first_action.details = "Enroll in BCC Level 3 today.";
  root.options[0].sources = [];
  badOutput.decisionTree.current_action.title = "Enroll in BCC Level 3";
  badOutput.decisionTree.current_action.details = "Enroll in BCC Level 3 today.";
  badOutput.webSearchCallCount = 0;

  const badResult = scoreEvalScenario(scenario, badOutput);
  assert.ok(
    badResult.criticalFailures.some(
      (failure) => failure.id === "internal_jargon_labels",
    ),
  );
  assert.ok(
    badResult.criticalFailures.some(
      (failure) => failure.id === "ungrounded_provider_recommendation",
    ),
  );
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

test("live eval generation failures become scenario critical failures", () => {
  const scenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.acting_class_brooklyn);
  output.decisionTree = null;
  output.generationFailure = {
    id: "structured_repair_failed",
    note: "The model returned malformed JSON and repair failed.",
    rawOutputExcerpt: "{\"decision_tree\":",
  };
  output.trace = {
    scenarioId: scenario.id,
    generationKind: "plan",
    model: null,
    modelRole: null,
    webSearchAllowed: false,
    webSearchCallCount: 0,
    schemaValid: false,
    promptSections: [],
    boardTitle: output.boardTitle,
    structuredOutputRepaired: false,
    structuredOutputRepairAttempts: 1,
    structuredOutputInitialError: "Unexpected end of JSON input",
    structuredOutputRawExcerpt: "{\"decision_tree\":",
  };

  const result = scoreEvalScenario(scenario, output);
  assert.equal(result.passed, false);
  assert.ok(
    result.criticalFailures.some(
      (failure) => failure.id === "structured_repair_failed",
    ),
  );
});

test("search-needed local actions require concrete search workflow details", () => {
  assert.deepEqual(
    detectSearchWorkflowGaps(
      "Search for 3 recurring beginner adult tennis clinics within 20-30 minutes of 11216 using 'beginner adult tennis clinic near Bed-Stuy'. Shortlist recurring beginner-friendly low-pressure options. Success: 3 candidates or one message sent today. If none appear, ask one coach for group-play referrals.",
    ),
    [],
  );

  const tennisScenario = evalScenarios.find((item) => item.id === "tennis_local_community");
  assert.ok(tennisScenario);
  const vagueTennisOutput = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  assert.ok(vagueTennisOutput.decisionTree);
  vagueTennisOutput.decisionTree.current_action.details =
    "Find a beginner-friendly recurring tennis group.";
  vagueTennisOutput.decisionTree.current_action.success_condition =
    "One group is found.";
  vagueTennisOutput.decisionTree.current_action.fallback =
    "If blocked, try again later.";
  vagueTennisOutput.decisionTree.nodes[0].options[0].first_action.details =
    "Find a beginner-friendly recurring tennis group.";
  vagueTennisOutput.decisionTree.nodes[0].options[0].success_condition =
    "One group is found.";
  vagueTennisOutput.decisionTree.nodes[0].options[0].fallback =
    "If blocked, try again later.";
  const vagueTennisResult = scoreEvalScenario(tennisScenario, vagueTennisOutput);
  assert.ok(
    vagueTennisResult.criticalFailures.some(
      (failure) => failure.id === "vague_search_action",
    ),
  );

  const actingScenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(actingScenario);
  const unsearchedActingOutput = cloneOutput(mockOutputsByScenarioId.acting_class_brooklyn);
  assert.ok(unsearchedActingOutput.decisionTree);
  unsearchedActingOutput.webSearchCallCount = 0;
  unsearchedActingOutput.decisionTree.current_action.title =
    "Send 3 short fit-check messages";
  unsearchedActingOutput.decisionTree.current_action.details =
    "Send 3 short fit-check messages to Brooklyn-accessible improv programs today.";
  unsearchedActingOutput.decisionTree.current_action.success_condition =
    "Messages are sent.";
  unsearchedActingOutput.decisionTree.current_action.fallback =
    "If blocked, try another program.";
  unsearchedActingOutput.decisionTree.nodes[0].search_status = "needed";
  unsearchedActingOutput.decisionTree.nodes[0].options[0].search_status = "needed";
  unsearchedActingOutput.decisionTree.nodes[0].options[0].sources = [];
  const actingResult = scoreEvalScenario(actingScenario, unsearchedActingOutput);
  assert.ok(
    actingResult.criticalFailures.some(
      (failure) => failure.id === "vague_search_action",
    ),
  );
});

test("search honesty allows fit-check caveats but still catches local verification claims", () => {
  const scenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(scenario);
  const caveated = cloneOutput(mockOutputsByScenarioId.acting_class_brooklyn);
  assert.ok(caveated.decisionTree);
  caveated.webSearchCallCount = 0;
  caveated.decisionTree.nodes = caveated.decisionTree.nodes.map((node) => ({
    ...node,
    search_status: "needed",
    options: node.options.map((option) => ({
      ...option,
      search_status: "needed",
      requires_web_search: true,
      sources: [],
    })),
  }));
  caveated.decisionTree.current_action.details =
    "Within 30 minutes today, search for 3-5 adult acting or improv classes in Brooklyn using 'adult acting class Brooklyn'. Shortlist by level fit and schedule, then confirm level fit before enrolling.";
  caveated.decisionTree.current_action.success_condition =
    "One fit-check message is drafted or sent within 48 hours.";
  caveated.decisionTree.current_action.fallback =
    "If level fit is unclear, ask before enrolling.";
  const caveatedResult = scoreEvalScenario(scenario, caveated);
  assert.equal(
    caveatedResult.criticalFailures.some(
      (failure) => failure.id === "hallucinated_local_without_search",
    ),
    false,
  );

  const hallucinated = cloneOutput(caveated);
  assert.ok(hallucinated.decisionTree);
  hallucinated.decisionTree.current_action.details =
    "Use this verified Brooklyn option and enroll today.";
  const hallucinatedResult = scoreEvalScenario(scenario, hallucinated);
  assert.ok(
    hallucinatedResult.criticalFailures.some(
      (failure) => failure.id === "hallucinated_local_without_search",
    ),
  );
  const hallucinationFailure = hallucinatedResult.criticalFailures.find(
    (failure) => failure.id === "hallucinated_local_without_search",
  );
  assert.ok(hallucinationFailure?.evidence);
  assert.equal(hallucinationFailure.evidence.visible, true);
  assert.match(hallucinationFailure.evidence.fieldPath, /current_action\.details/);
  assert.match(hallucinationFailure.evidence.text, /verified Brooklyn option/);
});

test("search honesty does not flag canonical local search instructions", () => {
  const scenario = evalScenarios.find((item) => item.id === "tennis_local_community");
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  assert.ok(output.decisionTree);
  output.webSearchCallCount = 0;
  output.decisionTree.nodes[0].search_status = "needed";
  output.decisionTree.nodes[0].options[0].search_status = "needed";
  output.decisionTree.nodes[0].options[0].label = "Beginner clinic";
  output.decisionTree.nodes[0].options[1].label = "Private lesson";
  output.decisionTree.nodes[0].options[2].label = "Open play";
  output.decisionTree.current_action.title = "Search and shortlist beginner tennis options";
  output.decisionTree.current_action.details =
    "Within 20 minutes today, search for 3 recurring beginner adult tennis options 11216. Use queries like 'beginner adult tennis clinic 11216', 'adult tennis clinic Brooklyn beginner', and 'social tennis drills near me'. Shortlist only options that are recurring, beginner-friendly, low-pressure, and not competitive pickup. Do not treat any local option as verified until you check it.";
  output.decisionTree.current_action.success_condition =
    "Three candidates are saved or one beginner-friendly inquiry is sent today.";
  output.decisionTree.current_action.fallback =
    "If none look right, search for one private or semi-private coach and ask where adult beginners move into group play.";

  const result = scoreEvalScenario(scenario, output);
  assert.equal(
    result.criticalFailures.some(
      (failure) => failure.id === "hallucinated_local_without_search",
    ),
    false,
  );

  output.decisionTree.current_action.details =
    "Search for a coach who offers beginner adult lessons near 11216 and ask whether they can place you into a beginner group afterward.";
  const coachSearchResult = scoreEvalScenario(scenario, output);
  assert.equal(
    coachSearchResult.criticalFailures.some(
      (failure) => failure.id === "hallucinated_local_without_search",
    ),
    false,
  );
});

test("search honesty flags provider or availability claims without search evidence", () => {
  const tennisScenario = evalScenarios.find((item) => item.id === "tennis_local_community");
  assert.ok(tennisScenario);
  const providerOutput = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  assert.ok(providerOutput.decisionTree);
  providerOutput.webSearchCallCount = 0;
  providerOutput.decisionTree.nodes = providerOutput.decisionTree.nodes.map((node) => ({
    ...node,
    search_status: "needed",
    options: node.options.map((option) => ({
      ...option,
      search_status: "needed",
      sources: [],
    })),
  }));
  providerOutput.decisionTree.current_action.details =
    "Brooklyn Tennis Academy offers adult beginner clinics this week, so go there first.";

  const providerResult = scoreEvalScenario(tennisScenario, providerOutput);
  const providerFailure = providerResult.criticalFailures.find(
    (failure) => failure.id === "hallucinated_local_without_search",
  );
  assert.ok(providerFailure);
  assert.equal(providerFailure.evidence?.fieldPath, "decision_tree.current_action.details");
  assert.match(providerFailure.evidence?.text ?? "", /Brooklyn Tennis Academy offers/);

  const actingScenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(actingScenario);
  const bccOutput = cloneOutput(mockOutputsByScenarioId.acting_class_brooklyn);
  assert.ok(bccOutput.decisionTree);
  bccOutput.webSearchCallCount = 0;
  bccOutput.decisionTree.nodes = bccOutput.decisionTree.nodes.map((node) => ({
    ...node,
    search_status: "needed",
    options: node.options.map((option) => ({
      ...option,
      search_status: "needed",
      sources: [],
    })),
  }));
  bccOutput.decisionTree.current_action.details =
    "BCC Level 3 is available and fits your schedule, so enroll today.";

  const bccResult = scoreEvalScenario(actingScenario, bccOutput);
  const bccFailure = bccResult.criticalFailures.find(
    (failure) => failure.id === "hallucinated_local_without_search",
  );
  assert.ok(bccFailure);
  assert.equal(bccFailure.evidence?.source, "canonical_action");
  assert.match(bccFailure.evidence?.text ?? "", /BCC Level 3/);
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

test("community eval catches step-like root branches", () => {
  const scenario = evalScenarios.find((item) => item.id === "community_not_dating");
  assert.ok(scenario);
  const output = cloneOutput(mockOutputsByScenarioId.community_not_dating);
  assert.ok(output.decisionTree);
  output.decisionTree.nodes[0].options.push({
    ...output.decisionTree.nodes[0].options[0],
    id: "choose_weekly_place",
    label: "Choose one weekly place",
    description: "This is a step under a recurring group, not a root branch.",
  });
  const result = scoreEvalScenario(scenario, output);
  assert.ok(
    result.criticalFailures.some(
      (failure) => failure.id === "branch_step_mixing",
    ),
  );
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
  assert.ok(
    vagueMemoryResult.criticalFailures.some(
      (failure) => failure.id === "vague_reconciliation_followup",
    ),
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

test("report renderer includes scenario scores, trace summaries, and critical failure summary", () => {
  const report = scoreEvalSuite(evalScenarios.slice(0, 1), mockOutputsByScenarioId, {
    generatedAt: "2026-07-06T00:00:00.000Z",
    mode: "live",
    gitCommit: "test",
    modelConfig: "live test",
    selectedScenarioIds: ["tennis_local_community"],
    totalModelCalls: 1,
    webSearchEnabled: false,
    traces: [
      {
        scenarioId: "tennis_local_community",
        generationKind: "plan",
        model: "test-model",
        modelRole: "plan_standard",
        webSearchAllowed: false,
        webSearchCallCount: 0,
        schemaValid: true,
        promptSections: ["moveMapRootPrompt"],
        boardTitle: "Use tennis to build local community",
        rootQuestion: "Which tennis path should you take?",
        branchOptions: ["Beginner clinic", "Coach"],
        recommendedBranch: "Beginner clinic",
        actionLeaf: "Contact one beginner clinic",
        searchStatusSummary: ["needed"],
      },
    ],
  });
  const markdown = renderEvalReportMarkdown(report);
  assert.match(markdown, /FlowPath Output Quality Eval/);
  assert.match(markdown, /Tennis \/ local community/);
  assert.match(markdown, /Scenario Summary/);
  assert.match(markdown, /Live Trace Summary/);
  assert.match(markdown, /Beginner clinic/);
});

test("report writer keeps live reports separate from offline reports", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "flowpath-evals-"));
  try {
    const offlineReport = scoreEvalSuite(evalScenarios.slice(0, 1), mockOutputsByScenarioId, {
      generatedAt: "2026-07-06T00:00:00.000Z",
      mode: "offline",
      gitCommit: "test",
      modelConfig: "offline mocked outputs",
    });
    const liveReport = {
      ...offlineReport,
      generatedAt: "2026-07-06T00:00:01.000Z",
      mode: "live" as const,
      modelConfig: "live smoke",
    };
    const offlinePaths = await writeEvalReport(offlineReport, outputDir);
    const livePaths = await writeEvalReport(liveReport, outputDir);
    assert.match(offlinePaths.latestPath, /latest-flowpath-eval\.md$/);
    assert.match(offlinePaths.jsonPath, /2026-07-06T00-00-00-000Z\.json$/);
    assert.match(livePaths.latestPath, /latest-flowpath-live-eval\.md$/);
    assert.match(livePaths.jsonPath, /2026-07-06T00-00-01-000Z-live\.json$/);

    const antiReport = scoreEvalSuite(
      antiOverfitScenarios.slice(0, 1),
      mockOutputsByScenarioId,
      {
        generatedAt: "2026-07-06T00:00:02.000Z",
        mode: "offline",
        suite: "anti_overfit",
        gitCommit: "test",
        modelConfig: "offline mocked outputs",
      },
    );
    const antiPaths = await writeEvalReport(antiReport, outputDir);
    assert.match(antiPaths.latestPath, /latest-flowpath-anti-overfit-eval\.md$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("live comparison report includes FlowPath and baseline comparison fields", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "flowpath-live-compare-"));
  try {
    const scenario = evalScenarios.find((item) => item.id === "tennis_local_community");
    assert.ok(scenario);
    const output = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
    const flowpath = scoreEvalScenario(scenario, output);
    const baseline = scoreEvalScenario(scenario, output);
    const report = {
      generatedAt: "2026-07-07T12:30:00.000Z",
      mode: "live_compare" as const,
      gitCommit: "test",
      modelConfig: "baseline=gpt-5.5; judge=disabled",
      selectedScenarioIds: [scenario.id],
      totalModelCalls: 2,
      webSearchEnabled: false,
      judgeEnabled: true,
      judgeRequested: true,
      budget: 2,
      flowpathAverageScore: flowpath.overallScore,
      baselineAverageScore: baseline.overallScore,
      flowpathMaxScore: flowpath.maxScore,
      baselineMaxScore: baseline.maxScore,
      delta: 0,
      pairwiseWins: { flowpath: 1, baseline: 0, tie: 0 },
      criticalFailures: { flowpath: 0, baseline: 0 },
      results: [
        {
          scenarioId: scenario.id,
          scenarioName: scenario.name,
          flowpath,
          baseline,
          delta: 0,
          pairwiseJudge: {
            winner: "flowpath" as const,
            mappedWinner: "flowpath" as const,
            judgeRawChoice: "b" as const,
            outputASystem: "baseline" as const,
            outputBSystem: "flowpath" as const,
            outputOrder: {
              a: "baseline" as const,
              b: "flowpath" as const,
            },
            betterActionability: "b" as const,
            betterBranchClarity: "b" as const,
            betterRealism: "tie" as const,
            betterContextUse: "b" as const,
            betterSafetySearchHonesty: "tie" as const,
            rationale: "Output B is more useful for deciding what to do next.",
            model: "gpt-5.5",
          },
          flowpathTrace: output.trace,
          baselineTrace: output.trace,
          notes: ["pairwise_winner=flowpath"],
        },
      ],
      passed: true,
    };

    const markdown = renderLiveComparisonReportMarkdown(report);
    assert.match(markdown, /FlowPath Live Comparison Eval/);
    assert.match(markdown, /FlowPath average/);
    assert.match(markdown, /Baseline average/);
    assert.match(markdown, /Pairwise/);
    assert.match(markdown, /judge chose B; A=baseline; B=flowpath; mapped winner=FlowPath/i);

    const paths = await writeLiveComparisonReport(report, outputDir);
    assert.match(paths.latestPath, /latest-flowpath-live-comparison\.md$/);
    assert.match(paths.jsonPath, /2026-07-07T12-30-00-000Z-live-comparison\.json$/);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("live eval mode is explicitly gated without failing when env is missing", () => {
  assert.equal(resolveEvalMode(["--offline"], {}), "offline");
  assert.equal(
    resolveEvalMode(["--offline"], {
      FLOWPATH_LIVE_EVALS: "1",
      FLOWPATH_LIVE_COMPARE: "1",
      OPENAI_API_KEY: "test",
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "3",
    }),
    "offline",
  );
  assert.equal(resolveEvalMode(["--live"], {}), "live_unavailable");
  assert.equal(resolveEvalMode(["--live-compare"], {}), "live_compare_unavailable");
  assert.deepEqual(liveEvalReadiness(["--live"], {}).missing, [
    "FLOWPATH_LIVE_EVALS=1",
    "OPENAI_API_KEY",
    "FLOWPATH_LIVE_EVAL_MAX_CALLS",
  ]);
  assert.equal(
    resolveEvalMode(["--live"], {
      FLOWPATH_LIVE_EVALS: "1",
      OPENAI_API_KEY: "test",
    }),
    "live_unavailable",
  );
  assert.equal(
    resolveEvalMode(["--live"], {
      FLOWPATH_LIVE_EVALS: "1",
      OPENAI_API_KEY: "test",
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "1",
    }),
    "live",
  );
  assert.deepEqual(liveComparisonReadiness(["--live-compare"], {}).missing, [
    "FLOWPATH_LIVE_EVALS=1",
    "OPENAI_API_KEY",
    "FLOWPATH_LIVE_EVAL_MAX_CALLS",
  ]);
  assert.equal(
    resolveEvalMode(["--live-compare"], {
      FLOWPATH_LIVE_EVALS: "1",
      OPENAI_API_KEY: "test",
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "2",
    }),
    "live_compare",
  );
});

test("live eval scenario selection supports explicit IDs and budget caps", () => {
  const selected = selectLiveEvalScenarios(evalScenarios, {
    FLOWPATH_LIVE_EVAL_MAX_CALLS: "2",
    FLOWPATH_LIVE_EVAL_SCENARIOS:
      "community_not_dating,memory_correction_private_writing",
  });
  assert.deepEqual(
    selected.map((scenario) => scenario.id),
    ["community_not_dating", "memory_correction_private_writing"],
  );

  const cappedDefault = selectLiveEvalScenarios(evalScenarios, {
    FLOWPATH_LIVE_EVAL_MAX_CALLS: "2",
  });
  assert.deepEqual(
    cappedDefault.map((scenario) => scenario.id),
    ["tennis_local_community", "community_not_dating"],
  );

  assert.throws(
    () =>
      selectLiveEvalScenarios(evalScenarios, {
        FLOWPATH_LIVE_EVAL_MAX_CALLS: "1",
        FLOWPATH_LIVE_EVAL_SCENARIOS:
          "community_not_dating,memory_correction_private_writing",
      }),
    /budget 1/,
  );
  assert.throws(
    () =>
      selectLiveEvalScenarios(evalScenarios, {
        FLOWPATH_LIVE_EVAL_MAX_CALLS: "1",
        FLOWPATH_LIVE_EVAL_SCENARIOS: "unknown_scenario",
      }),
    /Unknown live eval scenario/,
  );

  const antiDefault = selectLiveEvalScenarios(antiOverfitScenarios, {
    FLOWPATH_LIVE_EVAL_MAX_CALLS: "2",
    FLOWPATH_LIVE_EVAL_MAX_SCENARIOS: "2",
  });
  assert.deepEqual(
    antiDefault.map((scenario) => scenario.id),
    antiOverfitScenarios.slice(0, 2).map((scenario) => scenario.id),
  );
});

test("live comparison scenario selection slices explicit IDs to the call budget", () => {
  const selected = selectLiveComparisonScenarios(
    evalScenarios,
    {
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "4",
      FLOWPATH_LIVE_EVAL_SCENARIOS:
        "acting_class_brooklyn,tennis_local_community,career_no_cold_application_traction",
    },
    2,
  );
  assert.deepEqual(
    selected.scenarios.map((scenario) => scenario.id),
    ["acting_class_brooklyn", "tennis_local_community"],
  );
  assert.deepEqual(selected.skippedScenarioIds, [
    "career_no_cold_application_traction",
  ]);

  const judgePlan = shouldRunPairwiseJudge(
    {
      FLOWPATH_LIVE_EVAL_JUDGE: "1",
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "5",
    },
    2,
  );
  assert.equal(judgePlan.judgeRequested, true);
  assert.equal(judgePlan.judgeEnabled, false);
  assert.equal(
    shouldRunPairwiseJudge(
      {
        FLOWPATH_LIVE_EVAL_JUDGE: "1",
        FLOWPATH_LIVE_EVAL_MAX_CALLS: "6",
      },
      2,
    ).judgeEnabled,
    true,
  );

  const antiSuiteSelection = selectLiveComparisonScenarios(
    antiOverfitScenarios,
    {
      FLOWPATH_LIVE_EVAL_MAX_CALLS: "6",
      FLOWPATH_LIVE_EVAL_SUITE: "anti_overfit",
      FLOWPATH_LIVE_EVAL_MAX_SCENARIOS: "2",
    },
    2,
  );
  assert.deepEqual(
    antiSuiteSelection.scenarios.map((scenario) => scenario.id),
    antiOverfitScenarios.slice(0, 2).map((scenario) => scenario.id),
  );
});

test("direct baseline prompt is fair, search-honest, and action-oriented", () => {
  const scenario = evalScenarios.find((item) => item.id === "acting_class_brooklyn");
  assert.ok(scenario);
  const prompt = buildDirectBaselinePrompt(scenario, {
    webSearchAvailable: false,
  });
  const combined = `${prompt.system}\n${JSON.stringify(prompt.user)}`;
  assert.match(combined, /strongest direct answer/i);
  assert.match(combined, /concrete/i);
  assert.match(combined, /Do not hallucinate current, local/i);
  assert.match(combined, /Web search is not available/i);
  assert.match(combined, /not assume dating/i);
  assert.match(combined, /parallel choices, not sequential steps/i);
  assert.match(combined, /executable verb/i);
});

test("direct baseline parser trims overlong labels before validation", () => {
  const longLabel = "Advanced Brooklyn improv class with fit check ".repeat(4);
  const parsed = baselineAnswerSchema.parse(
    trimBaselineAnswerForSchema({
      summary: "Find an acting class",
      primary_domain: "people_community_belonging",
      secondary_domains: ["craft_creativity_mastery"],
      current_position: "The user wants an acting class in Brooklyn.",
      goal: "Find a class that fits level and social goals.",
      constraints: [],
      assets: [],
      assumptions: [],
      options: [
        {
          label: longLabel,
          rationale: "It fits the user's interest.",
          recommendation_level: "recommended",
          first_action_preview: "Ask whether the class fits the user's experience.",
          search_status: "needed",
        },
      ],
      recommended_next_move: "Ask one class about fit.",
      first_action: "Send one fit-check message.",
      first_10_minutes: "Draft and send the message.",
      success_condition: "One message is sent.",
      if_blocked: "Choose the next class format.",
      assumptions_to_watch: [],
      memory_updates: [],
      search_status: "needed",
    }),
  );
  assert.ok(parsed.options[0].label.length <= 120);
});

test("pairwise judge prompt anonymizes FlowPath and baseline output labels", () => {
  const scenario = evalScenarios.find((item) => item.id === "tennis_local_community");
  assert.ok(scenario);
  const flowpathOutput = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  const baselineOutput = cloneOutput(mockOutputsByScenarioId.tennis_local_community);
  baselineOutput.boardTitle = "Direct baseline answer";

  const anonymous = anonymizePairwiseOutputs({
    scenarioId: scenario.id,
    flowpathOutput,
    baselineOutput,
  });
  assert.ok(["flowpath", "baseline"].includes(anonymous.order.a));
  assert.ok(["flowpath", "baseline"].includes(anonymous.order.b));
  assert.notEqual(anonymous.order.a, anonymous.order.b);

  const prompt = buildPairwiseJudgePrompt({
    scenario,
    anonymousOutputs: anonymous,
  });
  const combined = `${prompt.system}\n${JSON.stringify(prompt.user)}`;
  assert.match(combined, /anonymous assistant outputs/i);
  assert.match(combined, /Do not infer which system/i);
  assert.doesNotMatch(combined, /FlowPath output/i);
  assert.doesNotMatch(combined, /baseline output/i);
  assert.match(combined, /output_a/i);
  assert.match(combined, /output_b/i);
});

test("pairwise preference mapping covers all A/B assignments", () => {
  const flowpathFirst = { a: "flowpath" as const, b: "baseline" as const };
  const baselineFirst = { a: "baseline" as const, b: "flowpath" as const };

  assert.equal(preferenceToSystem("a", flowpathFirst), "flowpath");
  assert.equal(preferenceToSystem("b", flowpathFirst), "baseline");
  assert.equal(preferenceToSystem("a", baselineFirst), "baseline");
  assert.equal(preferenceToSystem("b", baselineFirst), "flowpath");
  assert.equal(preferenceToSystem("tie", flowpathFirst), "tie");
});

test("pairwise preference parser handles A/B phrases and rejects unmappable text", () => {
  assert.equal(parsePairwisePreferenceChoice("a"), "a");
  assert.equal(parsePairwisePreferenceChoice("Output A"), "a");
  assert.equal(parsePairwisePreferenceChoice("assistant b"), "b");
  assert.equal(parsePairwisePreferenceChoice("I choose Output B"), "b");
  assert.equal(parsePairwisePreferenceChoice("tie"), "tie");
  assert.equal(parsePairwisePreferenceChoice("roughly even"), "tie");
  assert.equal(parsePairwisePreferenceChoice("the nicer one"), null);
});

test("pairwise rationale choice helper catches obvious A/B references", () => {
  assert.equal(
    inferPairwiseRationaleChoice("Output A is more useful for deciding what to do next."),
    "a",
  );
  assert.equal(
    inferPairwiseRationaleChoice("Output B better matches the user constraints."),
    "b",
  );
  assert.equal(inferPairwiseRationaleChoice("Both are close and useful."), null);
  assert.match(
    pairwiseMappingWarningForRationale({
      judgeRawChoice: "b",
      rationale: "Output A is more useful for deciding what to do next.",
    }) ?? "",
    /Output A.+raw winner was b/,
  );
  assert.equal(
    pairwiseMappingWarningForRationale({
      judgeRawChoice: "a",
      rationale: "Output A is more useful for deciding what to do next.",
    }),
    undefined,
  );
});
