import { execFileSync } from "node:child_process";

import {
  attachBranchExpansionToTree,
  decisionActionTaskNotes,
  findDecisionOption,
  getDecisionNode,
  rootDecisionNode,
} from "../decision-tree";
import { inferBoardTitle } from "../entry-domains";
import {
  generateBranchExpansion,
  generateNextMovePlan,
  reconcileMemoryAndBoardUpdate,
  StructuredOutputRecoveryError,
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
import { scenariosForSuite } from "./fixtures";
import {
  ANTI_OVERFIT_LIVE_COMPARISON_COMMAND,
  ANTI_OVERFIT_LIVE_COMPARISON_SEARCH_COMMAND,
  LIVE_COMPARISON_COMMAND,
  baselineAnswerSchema,
  baselineModelFromEnv,
  generateDirectBaselineAnswer,
  judgeModelFromEnv,
  liveComparisonReadiness,
  liveComparisonRequested,
  runPairwiseJudge,
  selectLiveComparisonScenarios,
  shouldRunPairwiseJudge,
} from "./live-comparison";
import { mockOutputsByScenarioId } from "./mock-outputs";
import { writeEvalReport, writeLiveComparisonReport } from "./report";
import { scoreEvalScenario, scoreEvalSuite } from "./rubric";
import type {
  EvalMemoryItem,
  EvalOutput,
  EvalScenario,
  EvalSuiteSelection,
  EvalTrace,
  LiveComparisonReport,
  LiveComparisonScenarioResult,
} from "./types";

type EvalEnv = Record<string, string | undefined>;

const EVAL_SUITE_VALUES = ["regression", "anti_overfit", "combined"] as const;

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

function liveWebSearchEnabled(env: EvalEnv) {
  return env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1" || env.OPENAI_WEB_SEARCH_ENABLED === "true";
}

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
  if (args.includes("--offline")) return "offline" as const;
  if (liveComparisonRequested(args, env)) {
    const comparisonReadiness = liveComparisonReadiness(args, env);
    return comparisonReadiness.ready
      ? ("live_compare" as const)
      : ("live_compare_unavailable" as const);
  }
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

function liveGenerationFailureId(error: unknown) {
  if (error instanceof StructuredOutputRecoveryError) {
    return "structured_repair_failed" as const;
  }
  if (error instanceof SyntaxError || /json|parse/i.test((error as Error)?.message ?? "")) {
    return "malformed_model_json" as const;
  }
  if (/schema|zod|invalid_type|too_small|too_big/i.test((error as Error)?.message ?? "")) {
    return "schema_validation_failed" as const;
  }
  return "schema_validation_failed" as const;
}

function liveFailureOutput(
  scenario: EvalScenario,
  index: number,
  error: unknown,
): EvalOutput {
  const id = liveGenerationFailureId(error);
  const note =
    error instanceof StructuredOutputRecoveryError
      ? error.repairErrorSummary
      : error instanceof Error
        ? error.message.slice(0, 1200)
        : String(error).slice(0, 1200);
  const rawOutputExcerpt =
    error instanceof StructuredOutputRecoveryError
      ? error.initialRawOutputExcerpt
      : undefined;
  const boardTitle = inferBoardTitle(scenario.entryDomain, scenario.userInputs.join("\n"));
  return {
    scenarioId: scenario.id,
    boardTitle,
    primaryDomain: scenario.entryDomain,
    secondaryDomains: [],
    boardState: {
      currentPosition: scenario.userInputs.join("\n"),
      goal: scenario.userInputs[0] ?? "",
      constraints: [],
      assets: [],
      assumptions: [],
    },
    decisionTree: null,
    webSearchCallCount: 0,
    notes: `Live generation failed: ${note}`,
    generationFailure: {
      id,
      note,
      rawOutputExcerpt,
    },
    trace: {
      scenarioId: scenario.id,
      generationKind: "plan",
      model: null,
      modelRole: null,
      webSearchAllowed: liveWebSearchEnabled(process.env),
      webSearchCallCount: 0,
      schemaValid: false,
      promptSections: [],
      boardTitle,
      structuredOutputRepaired: false,
      structuredOutputRepairAttempts: error instanceof StructuredOutputRecoveryError ? 1 : 0,
      structuredOutputInitialError:
        error instanceof StructuredOutputRecoveryError
          ? error.initialErrorSummary
          : note,
      structuredOutputRawExcerpt: rawOutputExcerpt,
      notes: [`scenario_index=${index}`, `failure=${id}`, note],
    },
  };
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

function parseSuiteValue(value: string | undefined): EvalSuiteSelection | null {
  if (!value) return null;
  const normalized = value.trim().replace(/-/g, "_");
  if ((EVAL_SUITE_VALUES as readonly string[]).includes(normalized)) {
    return normalized as EvalSuiteSelection;
  }
  throw new Error(
    `Unknown eval suite "${value}". Expected one of: ${EVAL_SUITE_VALUES.join(", ")}.`,
  );
}

export function evalSuiteFromEnv(args: string[], env: EvalEnv): EvalSuiteSelection {
  const suiteArg = args.find((arg) => arg.startsWith("--suite="));
  return (
    parseSuiteValue(suiteArg?.slice("--suite=".length)) ??
    parseSuiteValue(env.FLOWPATH_EVAL_SUITE) ??
    parseSuiteValue(env.FLOWPATH_LIVE_EVAL_SUITE) ??
    "combined"
  );
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

  let defaultScenarios = DEFAULT_LIVE_SMOKE_SCENARIO_IDS.map((id) =>
    scenarioById.get(id),
  ).filter((item): item is EvalScenario => Boolean(item));
  if (!defaultScenarios.length) {
    defaultScenarios = scenarios;
  }
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
  structuredOutput,
}: {
  scenario: EvalScenario;
  output: EvalOutput;
  model: string | null;
  modelRole: string | null;
  webSearchAllowed: boolean;
  webSearchCallCount: number;
  structuredOutput?: {
    structuredOutputRepaired: boolean;
    structuredOutputRepairAttempts: number;
    initialErrorSummary?: string;
    initialRawOutputExcerpt?: string;
  };
}): EvalTrace {
  const tree = output.decisionTree;
  const root = tree ? rootDecisionNode(tree) : null;
  const recommended = tree ? findDecisionOption(tree, tree.recommended_option_id) : null;
  const currentAction = output.decisionTree?.current_action;
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
    actionTitle: currentAction?.title,
    actionLeaf: currentAction ? decisionActionTaskNotes(currentAction) : undefined,
    searchStatusSummary: searchStatuses(tree),
    structuredOutputRepaired: structuredOutput?.structuredOutputRepaired,
    structuredOutputRepairAttempts: structuredOutput?.structuredOutputRepairAttempts,
    structuredOutputInitialError: structuredOutput?.initialErrorSummary,
    structuredOutputRawExcerpt: structuredOutput?.initialRawOutputExcerpt,
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
    structuredOutputRepaired: generated.structuredOutput.structuredOutputRepaired,
    structuredOutputRepairAttempts:
      generated.structuredOutput.structuredOutputRepairAttempts,
    structuredOutputInitialError: generated.structuredOutput.initialErrorSummary,
    structuredOutputRawExcerpt: generated.structuredOutput.initialRawOutputExcerpt,
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
    structuredOutputRepaired:
      previousTrace.structuredOutputRepaired ||
      expanded.structuredOutput.structuredOutputRepaired,
    structuredOutputRepairAttempts:
      (previousTrace.structuredOutputRepairAttempts ?? 0) +
      expanded.structuredOutput.structuredOutputRepairAttempts,
    structuredOutputInitialError:
      previousTrace.structuredOutputInitialError ??
      expanded.structuredOutput.initialErrorSummary,
    structuredOutputRawExcerpt:
      previousTrace.structuredOutputRawExcerpt ??
      expanded.structuredOutput.initialRawOutputExcerpt,
  };
  if (output.decisionTree) {
    output.decisionTree = attachBranchExpansionToTree({
      tree,
      nodeId: root.id,
      optionId: option.id,
      selectedPath: tree.selected_path,
      expansion: expanded.expansion,
      webSearchCallCount: expanded.webSearchCallCount,
      contextText: [
        output.boardTitle,
        output.boardState.currentPosition,
        output.boardState.goal,
        ...output.boardState.constraints,
        ...output.boardState.assumptions,
      ].join(" "),
    });
    const childOption = findDecisionOption(output.decisionTree, option.id);
    const childNode = getDecisionNode(output.decisionTree, childOption?.next_node_id);
    output.trace.rootQuestion = root.question;
    output.trace.branchOptions = root.options.map((candidate) => candidate.label);
    output.trace.recommendedBranch = option.label;
    output.trace.actionTitle = childNode?.action?.title ?? output.trace.actionTitle;
    output.trace.actionLeaf = childNode?.action
      ? decisionActionTaskNotes(childNode.action)
      : output.trace.actionLeaf;
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
    try {
      const result = await runLiveFlowPathScenario(scenario, index, env, {
        includeExpansionSmoke: true,
      });
      outputs[scenario.id] = result.output;
      modelCalls += result.modelCalls;
    } catch (error) {
      outputs[scenario.id] = liveFailureOutput(scenario, index, error);
      modelCalls += 1;
      console.warn(
        `Live eval scenario ${scenario.id} failed but the suite will continue.`,
        error instanceof Error ? error.message : error,
      );
    }
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

async function runLiveFlowPathScenario(
  scenario: EvalScenario,
  index: number,
  env: EvalEnv,
  options: { includeExpansionSmoke?: boolean } = {},
): Promise<{ output: EvalOutput; modelCalls: number }> {
  if (isReconciliationScenario(scenario)) {
    return runLiveReconciliationScenario(scenario, index);
  }

  const generated = await generateNextMovePlan(liveEvalContextForScenario(scenario, index), {
    allowWebSearch: liveWebSearchEnabled(env),
  });
  const output: EvalOutput = {
    scenarioId: scenario.id,
    boardTitle:
      generated.plan.situation_summary ||
      inferBoardTitle(scenario.entryDomain, scenario.userInputs.join("\n")),
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
  output.trace = traceFromPlan({
    scenario,
    output,
    model: generated.model,
    modelRole: generated.modelRole,
    webSearchAllowed: liveWebSearchEnabled(env),
    webSearchCallCount: generated.webSearchCallCount,
    structuredOutput: generated.structuredOutput,
  });

  let modelCalls = 1;
  if (options.includeExpansionSmoke) {
    const expansion = await maybeRunBranchExpansionSmoke({
      scenario,
      output,
      generatedPlan: generated,
      webSearchAllowed: liveWebSearchEnabled(env),
    });
    modelCalls += expansion.modelCalls;
  }
  return { output, modelCalls };
}

async function runLiveComparisonReport({
  scenarios,
  env,
  generatedAt,
  suite,
}: {
  scenarios: EvalScenario[];
  env: EvalEnv;
  generatedAt: string;
  suite: EvalSuiteSelection;
}): Promise<LiveComparisonReport> {
  const judgeRequestedForSelection = env.FLOWPATH_LIVE_EVAL_JUDGE === "1";
  const selected = selectLiveComparisonScenarios(
    scenarios,
    env,
    judgeRequestedForSelection ? 3 : 2,
  );
  const { judgeRequested, judgeEnabled } = shouldRunPairwiseJudge(
    env,
    selected.scenarios.length,
  );
  const budget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  const estimatedCalls = selected.scenarios.length * (judgeEnabled ? 3 : 2);
  console.log(
    `Live FlowPath vs baseline comparison is enabled. Estimated model calls: ${estimatedCalls}.`,
  );
  if (selected.skippedScenarioIds.length) {
    console.log(
      `Skipped by budget/scenario cap: ${selected.skippedScenarioIds.join(", ")}.`,
    );
  }
  if (judgeRequested && !judgeEnabled) {
    console.log("Pairwise judge was requested but skipped because the call budget is too low.");
  }

  const results: LiveComparisonScenarioResult[] = [];
  let modelCalls = 0;
  for (const [index, scenario] of selected.scenarios.entries()) {
    let flowpath: Awaited<ReturnType<typeof runLiveFlowPathScenario>>;
    try {
      flowpath = await runLiveFlowPathScenario(scenario, index, env, {
        includeExpansionSmoke: false,
      });
      modelCalls += flowpath.modelCalls;
    } catch (error) {
      flowpath = {
        output: liveFailureOutput(scenario, index, error),
        modelCalls: 1,
      };
      modelCalls += 1;
      console.warn(
        `Live comparison FlowPath scenario ${scenario.id} failed but comparison will continue.`,
        error instanceof Error ? error.message : error,
      );
    }

    let baseline: Awaited<ReturnType<typeof generateDirectBaselineAnswer>>;
    try {
      baseline = await generateDirectBaselineAnswer({ scenario, env });
      modelCalls += baseline.modelCalls;
    } catch (error) {
      const failureNote =
        error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
      const fallbackAnswer = baselineAnswerSchema.parse({
        summary: `Baseline generation failed: ${failureNote}`,
        primary_domain: scenario.entryDomain,
        secondary_domains: [],
        current_position: scenario.userInputs.join("\n") || scenario.name,
        goal: scenario.userInputs[0] || scenario.name,
        constraints: [],
        assets: [],
        assumptions: ["The live baseline output could not be parsed."],
        options: [
          {
            label: "Generation failed",
            rationale: failureNote || "The baseline model response was not usable.",
            recommendation_level: "not_now",
            first_action_preview: "Retry the live eval after inspecting the error.",
            search_status: "not_needed",
          },
        ],
        recommended_next_move: "Retry the live eval after inspecting the error.",
        first_action: "Retry the live eval after inspecting the error.",
        first_10_minutes: "Review the parse or schema error in the live report.",
        success_condition: "The baseline scenario is scored as a controlled failure.",
        if_blocked: "Run the offline evals and inspect the raw model response.",
        assumptions_to_watch: [],
        memory_updates: [],
        search_status: "not_needed",
      });
      baseline = {
        answer: fallbackAnswer,
        output: liveFailureOutput(scenario, index, error),
        model: "generation_failed",
        modelCalls: 1,
      };
      baseline.output.notes = `Live baseline generation failed: ${baseline.output.generationFailure?.note ?? "unknown"}`;
      modelCalls += 1;
      console.warn(
        `Live comparison baseline scenario ${scenario.id} failed but comparison will continue.`,
        error instanceof Error ? error.message : error,
      );
    }

    const flowpathScore = scoreEvalScenario(scenario, flowpath.output);
    const baselineScore = scoreEvalScenario(scenario, baseline.output);
    let pairwiseJudge = null;
    let pairwiseJudgeError: string | null = null;
    if (judgeEnabled && !flowpath.output.generationFailure && !baseline.output.generationFailure) {
      try {
        pairwiseJudge = await runPairwiseJudge({
          scenario,
          flowpathOutput: flowpath.output,
          baselineOutput: baseline.output,
          env,
        });
      } catch (error) {
        pairwiseJudgeError =
          error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
        console.warn(
          `Pairwise judge failed for scenario ${scenario.id}; comparison will continue.`,
          pairwiseJudgeError,
        );
      } finally {
        modelCalls += 1;
      }
    }

    results.push({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      flowpath: flowpathScore,
      baseline: baselineScore,
      delta: flowpathScore.overallScore - baselineScore.overallScore,
      pairwiseJudge,
      pairwiseJudgeError,
      flowpathTrace: flowpath.output.trace,
      baselineTrace: baseline.output.trace,
      notes: [
        pairwiseJudge
          ? `pairwise_winner=${pairwiseJudge.winner}`
          : pairwiseJudgeError
            ? `pairwise_judge_failed=${pairwiseJudgeError}`
            : "pairwise_judge_not_run",
      ],
    });
  }

  const flowpathScore = results.reduce(
    (sum, result) => sum + result.flowpath.overallScore,
    0,
  );
  const baselineScore = results.reduce(
    (sum, result) => sum + result.baseline.overallScore,
    0,
  );
  const flowpathMax = results.reduce((sum, result) => sum + result.flowpath.maxScore, 0);
  const baselineMax = results.reduce((sum, result) => sum + result.baseline.maxScore, 0);
  const pairwiseWins = {
    flowpath: results.filter((result) => result.pairwiseJudge?.winner === "flowpath").length,
    baseline: results.filter((result) => result.pairwiseJudge?.winner === "baseline").length,
    tie: results.filter((result) => result.pairwiseJudge?.winner === "tie").length,
  };
  const scenarioCount = Math.max(1, results.length);

  return {
    generatedAt,
    mode: "live_compare",
    suite,
    gitCommit: currentGitCommit(),
    modelConfig: `flowpath_models=existing routing; baseline=${baselineModelFromEnv(
      env,
    )}; judge=${judgeEnabled ? judgeModelFromEnv(env) : "disabled"}; web_search=${liveWebSearchEnabled(env)}`,
    selectedScenarioIds: selected.scenarios.map((scenario) => scenario.id),
    totalModelCalls: modelCalls,
    webSearchEnabled: liveWebSearchEnabled(env),
    searchMode: liveWebSearchEnabled(env)
      ? "FlowPath search-enabled; baseline no-search"
      : "No-search comparison",
    judgeEnabled,
    judgeRequested,
    budget: Number.isInteger(budget) ? budget : 0,
    flowpathAverageScore: flowpathScore / scenarioCount,
    baselineAverageScore: baselineScore / scenarioCount,
    flowpathMaxScore: flowpathMax / scenarioCount,
    baselineMaxScore: baselineMax / scenarioCount,
    delta: (flowpathScore - baselineScore) / scenarioCount,
    pairwiseWins,
    criticalFailures: {
      flowpath: results.reduce(
        (sum, result) => sum + result.flowpath.criticalFailures.length,
        0,
      ),
      baseline: results.reduce(
        (sum, result) => sum + result.baseline.criticalFailures.length,
        0,
      ),
    },
    results,
    passed: results.every((result) => result.flowpath.passed),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const suite = evalSuiteFromEnv(args, process.env);
  const suiteScenarios = scenariosForSuite(suite);
  const mode = resolveEvalMode(args, process.env);
  if (mode === "live_compare_unavailable") {
    const readiness = liveComparisonReadiness(args, process.env);
    console.log("Live comparison evals were not run because required env vars are missing.");
    console.log(`Missing: ${readiness.missing.join(", ") || "unknown"}.`);
    console.log("Run a bounded live comparison with:");
    console.log(LIVE_COMPARISON_COMMAND);
    console.log("Run a bounded anti-overfit comparison with:");
    console.log(ANTI_OVERFIT_LIVE_COMPARISON_COMMAND);
    console.log("Run FlowPath-search-enabled anti-overfit comparison with:");
    console.log(ANTI_OVERFIT_LIVE_COMPARISON_SEARCH_COMMAND);
    return;
  }
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
  if (mode === "live_compare") {
    const report = await runLiveComparisonReport({
      scenarios: suiteScenarios,
      env: process.env,
      generatedAt,
      suite,
    });
    console.log(
      `${report.passed ? "PASS" : "FAIL"} FlowPath ${report.flowpathAverageScore.toFixed(
        1,
      )}/${report.flowpathMaxScore.toFixed(1)} vs baseline ${report.baselineAverageScore.toFixed(
        1,
      )}/${report.baselineMaxScore.toFixed(1)} across ${report.results.length} scenario(s).`,
    );
    for (const result of report.results) {
      console.log(
        `- ${result.scenarioName}: FlowPath ${result.flowpath.overallScore.toFixed(
          1,
        )}/${result.flowpath.maxScore}; baseline ${result.baseline.overallScore.toFixed(
          1,
        )}/${result.baseline.maxScore}; delta ${
          result.delta >= 0 ? "+" : ""
        }${result.delta.toFixed(1)}${
          result.pairwiseJudge ? `; judge=${result.pairwiseJudge.winner}` : ""
        }`,
      );
    }
    if (writeReport) {
      const paths = await writeLiveComparisonReport(report);
      console.log(`Wrote Markdown report: ${paths.latestPath}`);
      console.log(`Wrote JSON report: ${paths.jsonPath}`);
    }
    if (!report.passed) {
      process.exitCode = 1;
    }
    return;
  }
  const liveResult =
    mode === "live" ? await runLiveEvalOutputs(suiteScenarios, process.env) : null;
  const outputsByScenarioId = liveResult?.outputs ?? mockOutputsByScenarioId;
  const scenariosToScore = liveResult?.selectedScenarios ?? suiteScenarios;
  const report = scoreEvalSuite(scenariosToScore, outputsByScenarioId, {
    generatedAt,
    mode,
    suite,
    gitCommit: currentGitCommit(),
    modelConfig:
      mode === "live"
        ? `FLOWPATH_LIVE_EVALS=1; max_calls=${process.env.FLOWPATH_LIVE_EVAL_MAX_CALLS}; scenarios=${scenariosToScore.map((scenario) => scenario.id).join(",")}; web_search=${liveWebSearchEnabled(process.env)}`
        : "offline mocked outputs",
    selectedScenarioIds: scenariosToScore.map((scenario) => scenario.id),
    totalModelCalls: liveResult?.modelCalls,
    webSearchEnabled:
      mode === "live" ? liveWebSearchEnabled(process.env) : undefined,
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
