import { execFileSync } from "node:child_process";

import {
  attachBranchExpansionToTree,
  findDecisionOption,
  getDecisionNode,
  rootDecisionNode,
} from "../decision-tree";
import { inferBoardTitle } from "../entry-domains";
import {
  generateBranchExpansion,
  generateNextMovePlan,
  reconcileMemoryAndBoardUpdate,
  type ReconciliationGenerationContext,
  type StrategistContext,
} from "../flowpath-ai";
import {
  branchExpansionResultSchema,
  decisionTreeSchema,
  reconciliationResultSchema,
} from "../schemas";
import type {
  CheckIn,
  DecisionTree,
  InferredContextItem,
  IntakeMessage,
  IntakeSession,
  Profile,
  Situation,
  StoredNextMovePlan,
  Task,
} from "../types";
import { evalScenarios } from "./fixtures";
import { mockOutputsByScenarioId } from "./mock-outputs";
import { writeEvalReport } from "./report";
import { scoreEvalSuite } from "./rubric";
import type { EvalMemoryItem, EvalOutput, EvalScenario, EvalTrace } from "./types";

type EvalEnv = Record<string, string | undefined>;

const DEFAULT_LIVE_SMOKE_SCENARIO_IDS = [
  "tennis_local_community",
  "community_not_dating",
  "career_no_cold_application_traction",
  "memory_correction_private_writing",
  "board_update_weekends_only",
] as const;

const LIVE_EVAL_COMMAND = [
  "FLOWPATH_LIVE_EVALS=1 \\",
  "FLOWPATH_LIVE_EVAL_MAX_CALLS=5 \\",
  `FLOWPATH_LIVE_EVAL_SCENARIOS=${DEFAULT_LIVE_SMOKE_SCENARIO_IDS.join(",")} \\`,
  "npm run evals:live",
].join("\n");

export function liveEvalReadiness(args: string[], env: EvalEnv) {
  const requestedLive = args.includes("--live") || env.FLOWPATH_LIVE_EVALS === "1";
  if (!requestedLive) {
    return { requestedLive, ready: false, missing: [] as string[] };
  }
  const missing: string[] = [];
  if (env.FLOWPATH_LIVE_EVALS !== "1") missing.push("FLOWPATH_LIVE_EVALS=1");
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  if (!Number.isInteger(callBudget) || callBudget < 1) {
    missing.push("FLOWPATH_LIVE_EVAL_MAX_CALLS");
  }
  return { requestedLive, ready: missing.length === 0, missing };
}

export function resolveEvalMode(args: string[], env: EvalEnv) {
  const readiness = liveEvalReadiness(args, env);
  if (!readiness.requestedLive) return "offline" as const;
  if (!readiness.ready) return "live_unavailable" as const;
  return "live" as const;
}

function currentGitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function scenarioCountFromEnv(env: EvalEnv) {
  const parsed = Number(env.FLOWPATH_LIVE_EVAL_MAX_SCENARIOS);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return 3;
}

function parseScenarioIds(value: string | undefined) {
  return value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? null;
}

export function selectLiveEvalScenarios(scenarios: EvalScenario[], env: EvalEnv) {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const explicitIds = parseScenarioIds(env.FLOWPATH_LIVE_EVAL_SCENARIOS);
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  if (explicitIds?.length) {
    const unknown = explicitIds.filter((id) => !scenarioById.has(id));
    if (unknown.length) {
      throw new Error(`Unknown live eval scenario id(s): ${unknown.join(", ")}.`);
    }
    if (Number.isInteger(callBudget) && explicitIds.length > callBudget) {
      throw new Error(
        `Live eval budget ${callBudget} is lower than explicit scenario count ${explicitIds.length}.`,
      );
    }
    return explicitIds.map((id) => scenarioById.get(id)).filter((item): item is EvalScenario => Boolean(item));
  }

  const defaultScenarios = DEFAULT_LIVE_SMOKE_SCENARIO_IDS.map((id) =>
    scenarioById.get(id),
  ).filter((item): item is EvalScenario => Boolean(item));
  const maxScenarios = Math.min(scenarioCountFromEnv(env), callBudget || defaultScenarios.length);
  return defaultScenarios.slice(0, maxScenarios);
}

function liveEvalContextForScenario(scenario: EvalScenario, index: number): StrategistContext {
  const now = new Date().toISOString();
  const userText = scenario.userInputs.join("\n");
  const profile: Profile = {
    id: 1,
    personal_profile: "QA eval profile for FlowPath output quality.",
    current_season: "Evaluation fixture",
    core_priorities: "",
    constraints: "",
    operating_principles: "",
    remember: "",
    challenge_on: "",
    context_constraints: {},
    created_at: now,
    updated_at: now,
  };
  const situation: Situation = {
    id: index + 1,
    title: inferBoardTitle(scenario.entryDomain, userText),
    description: userText,
    category: scenario.entryDomain,
    status: "active",
    urgency: scenario.expected.urgentStability ? "crisis" : "medium",
    is_qa: true,
    latest_plan_id: null,
    latest_plan_mode: null,
    latest_plan_move: null,
    created_at: now,
    updated_at: now,
  };
  const session: IntakeSession = {
    id: index + 1,
    situation_id: situation.id,
    current_stage: "ready_to_generate",
    is_complete: true,
    summary_so_far: userText,
    context_constraints: {},
    is_qa: true,
    created_at: now,
    updated_at: now,
  };
  const messages: IntakeMessage[] = scenario.userInputs.map((content, messageIndex) => ({
    id: messageIndex + 1,
    session_id: session.id,
    role: "user",
    content,
    client_message_id: `eval-${scenario.id}-${messageIndex}`,
    is_qa: true,
    created_at: now,
  }));
  return {
    profile,
    situation,
    session,
    messages,
    openTasks: [] satisfies Task[],
    recentCheckIns: [] satisfies CheckIn[],
    recentPlans: [] satisfies StoredNextMovePlan[],
  };
}

function baseEvalBoard(scenario: EvalScenario, index: number, now: string): Situation {
  const userText = scenario.userInputs.join("\n");
  return {
    id: index + 1,
    title: inferBoardTitle(scenario.entryDomain, userText),
    description: userText,
    category: scenario.entryDomain,
    status: "active",
    urgency: scenario.expected.urgentStability ? "crisis" : "medium",
    is_qa: true,
    latest_plan_id: null,
    latest_plan_mode: null,
    latest_plan_move: null,
    created_at: now,
    updated_at: now,
  };
}

function searchStatuses(tree: DecisionTree | null | undefined) {
  if (!tree) return [];
  return [
    ...new Set(
      tree.nodes.flatMap((node) => [
        node.search_status,
        ...node.options.map((option) => option.search_status),
      ]),
    ),
  ].filter(Boolean);
}

function traceFromPlan({
  scenario,
  output,
  model,
  modelRole,
  webSearchAllowed,
  webSearchCallCount,
}: {
  scenario: EvalScenario;
  output: EvalOutput;
  model: string | null;
  modelRole: string | null;
  webSearchAllowed: boolean;
  webSearchCallCount: number;
}): EvalTrace {
  const tree = output.decisionTree;
  const root = tree ? rootDecisionNode(tree) : null;
  const recommended = tree ? findDecisionOption(tree, tree.recommended_option_id) : null;
  return {
    scenarioId: scenario.id,
    generationKind: "plan",
    model,
    modelRole,
    webSearchAllowed,
    webSearchCallCount,
    schemaValid: Boolean(tree && decisionTreeSchema.safeParse(tree).success),
    promptSections: [
      "boardSnapshotPrompt",
      "moveMapRootPrompt",
      "branchQualityInstruction",
      "recommendedLineInstruction",
      "actionLeafInstruction",
      "searchHonestyInstruction",
      "toneAndRealismInstruction",
    ],
    boardTitle: output.boardTitle,
    rootQuestion: root?.question,
    branchOptions: root?.options.map((option) => option.label),
    recommendedBranch: recommended?.label,
    actionLeaf: output.decisionTree?.current_action.title,
    searchStatusSummary: searchStatuses(tree),
    notes: [
      `expected_primary_domain=${scenario.expected.primaryDomain}`,
      `supplied_entry_domain=${scenario.entryDomain}`,
    ],
  };
}

function evalMemoryItem(
  id: string,
  label: string,
  value: string,
  status: EvalMemoryItem["status"],
): EvalMemoryItem {
  return { id, label, value, status };
}

function inferredMemoryItem(
  id: number,
  label: string,
  value: string,
  category: InferredContextItem["category"],
  now: string,
): InferredContextItem {
  return {
    id,
    label,
    value,
    category,
    sensitivity: "low",
    persistence: "saved_memory",
    source: "manual",
    status: "active",
    confidence: "high",
    superseded_by_id: null,
    last_confirmed_at: null,
    reconciliation_note: null,
    situation_id: null,
    intake_session_id: null,
    next_move_plan_id: null,
    is_qa: true,
    created_at: now,
    updated_at: now,
  };
}

function reconciliationContextForScenario(
  scenario: EvalScenario,
  index: number,
): ReconciliationGenerationContext {
  const now = new Date().toISOString();
  const board = baseEvalBoard(scenario, index, now);
  const existingMemory =
    scenario.id === "memory_correction_private_writing"
      ? [
          inferredMemoryItem(
            101,
            "Monetize writing",
            "The user wants to monetize writing.",
            "creative_personal_project",
            now,
          ),
        ]
      : [
          inferredMemoryItem(
            201,
            "Weekday availability",
            "The user can attend weekday sessions.",
            "time",
            now,
          ),
        ];
  return {
    date: now,
    source:
      scenario.id === "memory_correction_private_writing"
        ? "memory_correction"
        : "board_update",
    user_update: scenario.userInputs.join("\n"),
    board: {
      id: board.id,
      title: board.title,
      description: board.description,
      category: board.category,
      status: board.status,
      urgency: board.urgency,
    },
    latest_plan: {
      id: index + 1,
      situation_read: board.description,
      situation_summary: board.title,
      key_constraints:
        scenario.id === "board_update_weekends_only"
          ? ["Current path may assume weekday availability"]
          : ["Writing should not be professionalized without user consent"],
      highest_leverage_move_title:
        scenario.id === "board_update_weekends_only"
          ? "Find a weekend-compatible option"
          : "Protect private writing practice",
      likely_trap:
        scenario.id === "board_update_weekends_only"
          ? "Continuing with weekday-dependent options"
          : "Reintroducing professionalization after the correction",
      assumptions:
        scenario.id === "board_update_weekends_only"
          ? ["Some existing options may be weekday-only"]
          : ["Professionalization was an older assumption"],
    },
    move_map: {
      selected_path:
        scenario.id === "board_update_weekends_only" ? ["weekday_option"] : ["professional_submission"],
      selected_path_labels:
        scenario.id === "board_update_weekends_only"
          ? ["Weekday class"]
          : ["Professional submission"],
      active_node_id: "root",
      recommended_option_id:
        scenario.id === "board_update_weekends_only"
          ? "weekday_option"
          : "professional_submission",
    },
    existing_memory: existingMemory,
    intake_summary: {
      session_summary: board.description,
      recent_messages: scenario.userInputs.map((content) => ({
        role: "user",
        content,
      })),
    },
    task_or_action_history: [],
  };
}

function memoryItemsFromReconciliation(
  scenario: EvalScenario,
  reconciliation: Awaited<ReturnType<typeof reconcileMemoryAndBoardUpdate>>["reconciliation"],
) {
  const items: EvalMemoryItem[] = [];
  const existingById =
    scenario.id === "memory_correction_private_writing"
      ? new Map([["101", evalMemoryItem("101", "Monetize writing", "The user wants to monetize writing.", "active")]])
      : new Map([["201", evalMemoryItem("201", "Weekday availability", "The user can attend weekday sessions.", "active")]]);

  for (const operation of reconciliation.operations) {
    if (operation.type === "create_memory") {
      items.push(evalMemoryItem(operation.label, operation.label, operation.value, "active"));
    } else if (operation.type === "update_memory") {
      items.push(
        evalMemoryItem(
          operation.memory_id,
          operation.label || existingById.get(operation.memory_id)?.label || operation.memory_id,
          operation.value || existingById.get(operation.memory_id)?.value || "",
          "active",
        ),
      );
    } else if (operation.type === "mark_stale" || operation.type === "delete_memory") {
      const existing = existingById.get(operation.memory_id);
      items.push(
        evalMemoryItem(
          operation.memory_id,
          existing?.label || operation.memory_id,
          existing?.value || "",
          operation.type === "delete_memory" ? "deleted" : "stale",
        ),
      );
    } else if (operation.type === "merge_memory") {
      items.push(evalMemoryItem(operation.label, operation.label, operation.value, "active"));
    }
  }
  return items.length ? items : [...existingById.values()];
}

async function runLiveReconciliationScenario(
  scenario: EvalScenario,
  index: number,
): Promise<{ output: EvalOutput; modelCalls: number }> {
  const generated = await reconcileMemoryAndBoardUpdate(
    reconciliationContextForScenario(scenario, index),
  );
  const reconciliation = generated.reconciliation;
  const boardUpdates = reconciliation.board_updates;
  const output: EvalOutput = {
    scenarioId: scenario.id,
    boardTitle:
      boardUpdates?.title || (scenario.id === "board_update_weekends_only"
        ? "Find a weekend-friendly path"
        : "Keep writing private for now"),
    primaryDomain: boardUpdates?.category || scenario.entryDomain,
    secondaryDomains: [],
    boardState: {
      currentPosition: boardUpdates?.current_position_summary || reconciliation.summary,
      goal:
        boardUpdates?.goals_to_add.join(" ") ||
        (scenario.id === "board_update_weekends_only"
          ? "Find a weekend-compatible path."
          : "Keep writing private for now."),
      constraints: boardUpdates?.constraints_to_add ?? [],
      assets: boardUpdates?.assets_to_add ?? [],
      assumptions: boardUpdates?.assumptions_to_add ?? [],
    },
    reconciliation,
    memoryItems: memoryItemsFromReconciliation(scenario, reconciliation),
    webSearchCallCount: 0,
    notes: `Live reconciliation model: ${generated.model}`,
  };
  output.trace = {
    scenarioId: scenario.id,
    generationKind: "reconciliation",
    model: generated.model,
    modelRole: generated.modelRole,
    webSearchAllowed: false,
    webSearchCallCount: 0,
    schemaValid: reconciliationResultSchema.safeParse(reconciliation).success,
    promptSections: ["reconciliationSystemPrompt", "reconciliationJsonSchema"],
    boardTitle: output.boardTitle,
    actionLeaf: reconciliation.recommended_followup_action,
    memoryOperations: reconciliation.operations.map((operation) => operation.type),
    notes: [
      reconciliation.user_visible_explanation,
      reconciliation.move_map_effect?.reason ?? "",
    ].filter(Boolean),
  };
  return { output, modelCalls: 1 };
}

function isReconciliationScenario(scenario: EvalScenario) {
  return (
    scenario.id === "memory_correction_private_writing" ||
    scenario.id === "board_update_weekends_only"
  );
}

async function maybeRunBranchExpansionSmoke({
  scenario,
  output,
  generatedPlan,
  webSearchAllowed,
}: {
  scenario: EvalScenario;
  output: EvalOutput;
  generatedPlan: Awaited<ReturnType<typeof generateNextMovePlan>>;
  webSearchAllowed: boolean;
}) {
  const expansionScenarioId = process.env.FLOWPATH_LIVE_EVAL_EXPAND_SCENARIO;
  if (!expansionScenarioId || expansionScenarioId !== scenario.id || !output.decisionTree) {
    return { modelCalls: 0 };
  }
  const tree = output.decisionTree;
  const root = rootDecisionNode(tree);
  const option = findDecisionOption(tree, tree.recommended_option_id) ?? root.options[0];
  if (!option) return { modelCalls: 0 };
  const expanded = await generateBranchExpansion(
    {
      date: new Date().toISOString(),
      board: {
        id: tree.board_id ?? 1,
        title: output.boardTitle,
        description: scenario.userInputs.join("\n"),
        category: scenario.entryDomain,
        status: "active",
        urgency: scenario.expected.urgentStability ? "crisis" : "medium",
      },
      plan: {
        id: 1,
        situation_read: generatedPlan.plan.situation_read,
        situation_summary: generatedPlan.plan.situation_summary,
        key_constraints: generatedPlan.plan.key_constraints,
        highest_leverage_move_today: generatedPlan.plan.highest_leverage_move_today,
        operator_insight: generatedPlan.plan.operator_insight,
        likely_trap: generatedPlan.plan.likely_trap,
        local_reality_scout: generatedPlan.plan.local_reality_scout,
        assumptions: generatedPlan.plan.assumptions,
      },
      current_node: root,
      selected_option: option,
      selected_path: tree.selected_path,
      selected_path_labels: [option.label],
      decision_tree_summary: {
        root_node_id: tree.root_node_id,
        active_node_id: tree.active_node_id,
        recommended_option_id: tree.recommended_option_id,
        node_count: tree.nodes.length,
        existing_branch_labels: tree.nodes.flatMap((node) =>
          node.options.map((candidate) => candidate.label),
        ),
      },
      intake_summary: {
        session_summary: scenario.userInputs.join("\n"),
        recent_messages: scenario.userInputs.map((content) => ({
          role: "user",
          content,
        })),
      },
      relevant_memory: [],
      open_tasks: [],
      cognitive_operating_layer: null,
      search_context: {
        allow_web_search: webSearchAllowed,
        search_decision_reason: "not_needed",
        actual_search_results_provided: false,
      },
    },
    { allowWebSearch: webSearchAllowed },
  );
  output.branchExpansion = expanded.expansion;
  const previousTrace = output.trace;
  if (!previousTrace) return { modelCalls: 0 };
  output.trace = {
    ...previousTrace,
    generationKind: "branch_expansion",
    model: expanded.model,
    modelRole: expanded.modelRole,
    webSearchCallCount:
      previousTrace.webSearchCallCount + expanded.webSearchCallCount,
    schemaValid: branchExpansionResultSchema.safeParse(expanded.expansion).success,
    promptSections: [
      ...(output.trace?.promptSections ?? []),
      "branchExpansionSystemPrompt",
      "branchExpansionJsonSchema",
    ],
    notes: [
      ...(output.trace?.notes ?? []),
      `expanded_option=${option.label}`,
      `expansion_result=${expanded.expansion.result_type}`,
    ],
  };
  if (output.decisionTree) {
    output.decisionTree = attachBranchExpansionToTree({
      tree,
      nodeId: root.id,
      optionId: option.id,
      selectedPath: tree.selected_path,
      expansion: expanded.expansion,
      webSearchCallCount: expanded.webSearchCallCount,
    });
    const childOption = findDecisionOption(output.decisionTree, option.id);
    const childNode = getDecisionNode(output.decisionTree, childOption?.next_node_id);
    output.trace.rootQuestion = root.question;
    output.trace.branchOptions = root.options.map((candidate) => candidate.label);
    output.trace.recommendedBranch = option.label;
    output.trace.actionLeaf = childNode?.action?.title ?? output.trace.actionLeaf;
    output.trace.searchStatusSummary = searchStatuses(output.decisionTree);
  }
  return { modelCalls: 1 };
}

async function runLiveEvalOutputs(
  scenarios: EvalScenario[],
  env: EvalEnv,
): Promise<{
  outputs: Record<string, EvalOutput>;
  selectedScenarios: EvalScenario[];
  traces: EvalTrace[];
  modelCalls: number;
}> {
  const selectedScenarios = selectLiveEvalScenarios(scenarios, env);
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  const extraExpansionCall = env.FLOWPATH_LIVE_EVAL_EXPAND_SCENARIO ? 1 : 0;
  if (selectedScenarios.length + extraExpansionCall > callBudget) {
    throw new Error(
      `Live eval budget ${callBudget} is lower than selected scenario count ${
        selectedScenarios.length
      } plus optional expansion calls ${extraExpansionCall}.`,
    );
  }
  console.log(
    `Live FlowPath evals are enabled. Estimated model calls: ${selectedScenarios.length}.`,
  );
  const outputs: Record<string, EvalOutput> = {};
  let modelCalls = 0;
  for (const [index, scenario] of selectedScenarios.entries()) {
    if (isReconciliationScenario(scenario)) {
      const reconciled = await runLiveReconciliationScenario(scenario, index);
      outputs[scenario.id] = reconciled.output;
      modelCalls += reconciled.modelCalls;
      continue;
    }
    const generated = await generateNextMovePlan(liveEvalContextForScenario(scenario, index), {
      allowWebSearch: env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1",
    });
    modelCalls += 1;
    outputs[scenario.id] = {
      scenarioId: scenario.id,
      boardTitle: generated.plan.situation_summary || inferBoardTitle(scenario.entryDomain, scenario.userInputs.join("\n")),
      primaryDomain: scenario.entryDomain,
      secondaryDomains: [],
      boardState: {
        currentPosition: generated.plan.situation_summary,
        goal: generated.plan.situation_read,
        constraints: generated.plan.key_constraints,
        assets: generated.plan.context_used.map((item) => `${item.label}: ${item.value}`),
        assumptions: generated.plan.assumptions,
      },
      decisionTree: generated.plan.decision_tree,
      safetyMode: generated.plan.mode,
      webSearchCallCount: generated.webSearchCallCount,
      notes: `Live eval model: ${generated.model}`,
    };
    outputs[scenario.id].trace = traceFromPlan({
      scenario,
      output: outputs[scenario.id],
      model: generated.model,
      modelRole: generated.modelRole,
      webSearchAllowed: env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1",
      webSearchCallCount: generated.webSearchCallCount,
    });
    const expansion = await maybeRunBranchExpansionSmoke({
      scenario,
      output: outputs[scenario.id],
      generatedPlan: generated,
      webSearchAllowed: env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1",
    });
    modelCalls += expansion.modelCalls;
  }
  return {
    outputs,
    selectedScenarios,
    traces: Object.values(outputs)
      .map((output) => output.trace)
      .filter((trace): trace is EvalTrace => Boolean(trace)),
    modelCalls,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = resolveEvalMode(args, process.env);
  if (mode === "live_unavailable") {
    const readiness = liveEvalReadiness(args, process.env);
    console.log("Live evals were not run because required env vars are missing.");
    console.log(`Missing: ${readiness.missing.join(", ") || "unknown"}.`);
    console.log("Run a bounded live smoke with:");
    console.log(LIVE_EVAL_COMMAND);
    return;
  }
  const writeReport = !args.includes("--no-write");
  const generatedAt = new Date().toISOString();
  const liveResult =
    mode === "live" ? await runLiveEvalOutputs(evalScenarios, process.env) : null;
  const outputsByScenarioId = liveResult?.outputs ?? mockOutputsByScenarioId;
  const scenariosToScore = liveResult?.selectedScenarios ?? evalScenarios;
  const report = scoreEvalSuite(scenariosToScore, outputsByScenarioId, {
    generatedAt,
    mode,
    gitCommit: currentGitCommit(),
    modelConfig:
      mode === "live"
        ? `FLOWPATH_LIVE_EVALS=1; max_calls=${process.env.FLOWPATH_LIVE_EVAL_MAX_CALLS}; scenarios=${scenariosToScore.map((scenario) => scenario.id).join(",")}; web_search=${process.env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1"}`
        : "offline mocked outputs",
    selectedScenarioIds: scenariosToScore.map((scenario) => scenario.id),
    totalModelCalls: liveResult?.modelCalls,
    webSearchEnabled:
      mode === "live" ? process.env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1" : undefined,
    traces: liveResult?.traces,
  });

  console.log(
    `${report.passed ? "PASS" : "FAIL"} ${report.overallScore.toFixed(1)} / ${
      report.maxScore
    } across ${report.results.length} scenario(s).`,
  );
  for (const result of report.results) {
    console.log(
      `- ${result.passed ? "PASS" : "FAIL"} ${result.scenarioName}: ${result.overallScore.toFixed(
        1,
      )}/${result.maxScore}${
        result.criticalFailures.length
          ? ` (${result.criticalFailures.map((failure) => failure.id).join(", ")})`
          : ""
      }`,
    );
  }

  if (writeReport) {
    const paths = await writeEvalReport(report);
    console.log(`Wrote Markdown report: ${paths.latestPath}`);
    console.log(`Wrote JSON report: ${paths.jsonPath}`);
  }

  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
