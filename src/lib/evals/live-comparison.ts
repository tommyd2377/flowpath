import OpenAI from "openai";
import { z } from "zod";

import type { DecisionSearchStatus, DecisionTree } from "../types";
import type {
  EvalOutput,
  EvalScenario,
  EvalTrace,
  PairwiseJudgeResult,
} from "./types";

type EvalEnv = Record<string, string | undefined>;

const entryDomainIds = [
  "work_money_career",
  "people_community_belonging",
  "craft_creativity_mastery",
] as const;

const recommendationLevels = [
  "recommended",
  "viable",
  "supplement",
  "not_now",
  "risky",
] as const;

const searchStatuses = [
  "not_needed",
  "needed",
  "searched",
  "failed",
  "unavailable",
] as const;

const preferenceChoices = ["a", "b", "tie"] as const;

export const DEFAULT_LIVE_COMPARISON_SCENARIO_IDS = [
  "acting_class_brooklyn",
  "tennis_local_community",
  "career_no_cold_application_traction",
  "community_not_dating",
  "memory_correction_private_writing",
] as const;

export const DEFAULT_BASELINE_MODEL = "gpt-5.5";
export const DEFAULT_PAIRWISE_JUDGE_MODEL = "gpt-5.5";

export const LIVE_COMPARISON_COMMAND = [
  "FLOWPATH_LIVE_EVALS=1 \\",
  "FLOWPATH_LIVE_EVAL_MAX_CALLS=15 \\",
  `FLOWPATH_LIVE_EVAL_SCENARIOS=${DEFAULT_LIVE_COMPARISON_SCENARIO_IDS.join(",")} \\`,
  "npm run evals:live:compare",
].join("\n");

export const LIVE_COMPARISON_JUDGE_COMMAND = [
  "FLOWPATH_LIVE_EVALS=1 \\",
  "FLOWPATH_LIVE_EVAL_MAX_CALLS=15 \\",
  "FLOWPATH_LIVE_EVAL_JUDGE=1 \\",
  `FLOWPATH_LIVE_EVAL_SCENARIOS=${DEFAULT_LIVE_COMPARISON_SCENARIO_IDS.join(",")} \\`,
  "npm run evals:live:compare",
].join("\n");

export const ANTI_OVERFIT_LIVE_COMPARISON_COMMAND = [
  "FLOWPATH_LIVE_EVALS=1 \\",
  "FLOWPATH_LIVE_EVAL_MAX_CALLS=40 \\",
  "FLOWPATH_LIVE_EVAL_JUDGE=1 \\",
  "FLOWPATH_LIVE_EVAL_SUITE=anti_overfit \\",
  "FLOWPATH_LIVE_EVAL_MAX_SCENARIOS=10 \\",
  "npm run evals:live:compare",
].join("\n");

export const ANTI_OVERFIT_LIVE_COMPARISON_SEARCH_COMMAND = [
  "FLOWPATH_LIVE_EVALS=1 \\",
  "FLOWPATH_LIVE_EVAL_MAX_CALLS=40 \\",
  "FLOWPATH_LIVE_EVAL_JUDGE=1 \\",
  "FLOWPATH_LIVE_EVAL_SUITE=anti_overfit \\",
  "FLOWPATH_LIVE_EVAL_MAX_SCENARIOS=10 \\",
  "OPENAI_WEB_SEARCH_ENABLED=true \\",
  "npm run evals:live:compare",
].join("\n");

export const baselineAnswerSchema = z.object({
  summary: z.string().trim().min(1).max(1400),
  primary_domain: z.enum(entryDomainIds),
  secondary_domains: z.array(z.enum(entryDomainIds)).max(2),
  current_position: z.string().trim().min(1).max(1200),
  goal: z.string().trim().min(1).max(900),
  constraints: z.array(z.string().trim().min(1).max(240)).max(8),
  assets: z.array(z.string().trim().min(1).max(240)).max(8),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(8),
  options: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        rationale: z.string().trim().min(1).max(800),
        recommendation_level: z.enum(recommendationLevels),
        first_action_preview: z.string().trim().min(1).max(240),
        search_status: z.enum(searchStatuses),
      }),
    )
    .min(1)
    .max(6),
  recommended_next_move: z.string().trim().min(1).max(500),
  first_action: z.string().trim().min(1).max(700),
  first_10_minutes: z.string().trim().min(1).max(600),
  success_condition: z.string().trim().min(1).max(500),
  if_blocked: z.string().trim().min(1).max(500),
  assumptions_to_watch: z.array(z.string().trim().min(1).max(240)).max(6),
  memory_updates: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(160),
        value: z.string().trim().min(1).max(500),
        status: z.enum(["active", "stale", "deleted", "merged"]),
      }),
    )
    .max(6),
  search_status: z.enum(searchStatuses),
});

export type BaselineAnswer = z.infer<typeof baselineAnswerSchema>;

const pairwiseJudgeSchema = z.object({
  winner: z.string().trim().min(1).max(80),
  better_actionability: z.enum(preferenceChoices),
  better_branch_clarity: z.enum(preferenceChoices),
  better_realism: z.enum(preferenceChoices),
  better_context_use: z.enum(preferenceChoices),
  better_safety_search_honesty: z.enum(preferenceChoices),
  rationale: z.string().trim().min(1).max(1400),
});

export function liveComparisonRequested(args: string[], env: EvalEnv) {
  return (
    args.includes("--live-compare") ||
    env.FLOWPATH_LIVE_EVAL_MODE === "compare" ||
    env.FLOWPATH_LIVE_COMPARE === "1"
  );
}

export function liveComparisonReadiness(args: string[], env: EvalEnv) {
  const requestedLiveCompare = liveComparisonRequested(args, env);
  if (!requestedLiveCompare) {
    return { requestedLiveCompare, ready: false, missing: [] as string[] };
  }

  const missing: string[] = [];
  if (env.FLOWPATH_LIVE_EVALS !== "1") missing.push("FLOWPATH_LIVE_EVALS=1");
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  if (!Number.isInteger(callBudget) || callBudget < 2) {
    missing.push("FLOWPATH_LIVE_EVAL_MAX_CALLS");
  }

  return { requestedLiveCompare, ready: missing.length === 0, missing };
}

function parseScenarioIds(value: string | undefined) {
  return value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean) ?? null;
}

export function selectLiveComparisonScenarios(
  scenarios: EvalScenario[],
  env: EvalEnv,
  callsPerScenario = 2,
) {
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const explicitIds =
    parseScenarioIds(env.FLOWPATH_LIVE_EVAL_SCENARIOS) ??
    (env.FLOWPATH_LIVE_EVAL_SUITE
      ? scenarios.map((scenario) => scenario.id)
      : [...DEFAULT_LIVE_COMPARISON_SCENARIO_IDS]);
  const unknown = explicitIds.filter((id) => !scenarioById.has(id));
  if (unknown.length) {
    throw new Error(`Unknown live comparison scenario id(s): ${unknown.join(", ")}.`);
  }

  const budget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  const maxByBudget = Number.isInteger(budget)
    ? Math.max(0, Math.floor(budget / Math.max(1, callsPerScenario)))
    : explicitIds.length;
  const maxByEnv = Number(env.FLOWPATH_LIVE_EVAL_MAX_SCENARIOS);
  const maxScenarios =
    Number.isInteger(maxByEnv) && maxByEnv > 0
      ? Math.min(maxByEnv, maxByBudget || explicitIds.length)
      : maxByBudget || explicitIds.length;
  const selectedIds = explicitIds.slice(0, maxScenarios);
  const skippedScenarioIds = explicitIds.slice(selectedIds.length);

  return {
    scenarios: selectedIds
      .map((id) => scenarioById.get(id))
      .filter((item): item is EvalScenario => Boolean(item)),
    requestedScenarioIds: explicitIds,
    skippedScenarioIds,
    budget: Number.isInteger(budget) ? budget : null,
    callsPerScenario,
  };
}

export function shouldRunPairwiseJudge(env: EvalEnv, scenarioCount: number) {
  const judgeRequested = env.FLOWPATH_LIVE_EVAL_JUDGE === "1";
  const budget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  const judgeEnabled =
    judgeRequested && Number.isInteger(budget) && budget >= scenarioCount * 3;
  return { judgeRequested, judgeEnabled };
}

export function baselineModelFromEnv(env: EvalEnv) {
  return env.FLOWPATH_LIVE_EVAL_BASELINE_MODEL?.trim() || DEFAULT_BASELINE_MODEL;
}

export function judgeModelFromEnv(env: EvalEnv) {
  return env.FLOWPATH_LIVE_EVAL_JUDGE_MODEL?.trim() || DEFAULT_PAIRWISE_JUDGE_MODEL;
}

export function buildDirectBaselinePrompt(
  scenario: EvalScenario,
  options: { webSearchAvailable?: boolean } = {},
) {
  const system = [
    "You are a top-tier standalone assistant being benchmarked against FlowPath.",
    "Give the user your strongest direct answer for deciding what to do next.",
    "Be concrete, realistic, non-brutal, and specific to the user's constraints.",
    "Identify practical options, choose the best next move, and give one executable first action.",
    "Do not give generic advice like network more, research options, or put yourself out there unless you make it concrete.",
    "Do not hallucinate current, local, provider-specific, deadline, price, availability, or class-level facts.",
    options.webSearchAvailable
      ? "Web search may be available only if the runtime explicitly provides it. Use searched/current claims only when search actually runs."
      : "Web search is not available in this benchmark. If local/current data would matter, mark search_status as needed and make the first action a concrete search or fit-check step.",
    "For social/community boards, do not assume dating unless the user asks for dating. Favor repeated real-world containers, dignity, and low-friction belonging.",
    "For urgent stability or crisis-like boards, prioritize immediate risk reduction and avoid overconfident legal, medical, or financial claims.",
    "Return only the requested JSON shape.",
  ].join("\n");

  const user = {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    entry_domain: scenario.entryDomain,
    user_inputs: scenario.userInputs,
    output_contract: {
      primary_domain:
        "Preserve the selected entry domain unless the user explicitly changes it.",
      secondary_domains:
        "Infer additive secondary domains only when the user's words support them.",
      options:
        "Return recognizable user-facing options, usually 2-5 and hard max 6. Options are parallel choices, not sequential steps.",
      first_action:
        "Include an executable verb, object, scope or quantity, success condition, and if-blocked fallback.",
      search_status:
        "Use searched only if search actually ran. Otherwise use needed, not_needed, failed, or unavailable.",
    },
  };

  return { system, user };
}

const baselineJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "primary_domain",
    "secondary_domains",
    "current_position",
    "goal",
    "constraints",
    "assets",
    "assumptions",
    "options",
    "recommended_next_move",
    "first_action",
    "first_10_minutes",
    "success_condition",
    "if_blocked",
    "assumptions_to_watch",
    "memory_updates",
    "search_status",
  ],
  properties: {
    summary: { type: "string" },
    primary_domain: { type: "string", enum: entryDomainIds },
    secondary_domains: {
      type: "array",
      maxItems: 2,
      items: { type: "string", enum: entryDomainIds },
    },
    current_position: { type: "string" },
    goal: { type: "string" },
    constraints: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    assets: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    assumptions: {
      type: "array",
      maxItems: 8,
      items: { type: "string" },
    },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "label",
          "rationale",
          "recommendation_level",
          "first_action_preview",
          "search_status",
        ],
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
          recommendation_level: { type: "string", enum: recommendationLevels },
          first_action_preview: { type: "string" },
          search_status: { type: "string", enum: searchStatuses },
        },
      },
    },
    recommended_next_move: { type: "string" },
    first_action: { type: "string" },
    first_10_minutes: { type: "string" },
    success_condition: { type: "string" },
    if_blocked: { type: "string" },
    assumptions_to_watch: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    memory_updates: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value", "status"],
        properties: {
          label: { type: "string" },
          value: { type: "string" },
          status: { type: "string", enum: ["active", "stale", "deleted", "merged"] },
        },
      },
    },
    search_status: { type: "string", enum: searchStatuses },
  },
};

const pairwiseJudgeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "winner",
    "better_actionability",
    "better_branch_clarity",
    "better_realism",
    "better_context_use",
    "better_safety_search_honesty",
    "rationale",
  ],
  properties: {
    winner: { type: "string" },
    better_actionability: { type: "string", enum: preferenceChoices },
    better_branch_clarity: { type: "string", enum: preferenceChoices },
    better_realism: { type: "string", enum: preferenceChoices },
    better_context_use: { type: "string", enum: preferenceChoices },
    better_safety_search_honesty: { type: "string", enum: preferenceChoices },
    rationale: { type: "string" },
  },
};

function extractOutputText(response: unknown) {
  if (
    response &&
    typeof response === "object" &&
    "output_text" in response &&
    typeof response.output_text === "string"
  ) {
    return response.output_text;
  }

  const output = (response as { output?: unknown[] })?.output;
  if (!Array.isArray(output)) return "";

  return output
    .flatMap((item) => {
      const content = (item as { content?: unknown[] })?.content;
      if (!Array.isArray(content)) return [];
      return content.flatMap((part) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
          ? [part.text]
          : [],
      );
    })
    .join("\n");
}

function honestSearchStatus(
  status: z.infer<typeof baselineAnswerSchema>["search_status"],
  webSearchCallCount: number,
): DecisionSearchStatus {
  if (status === "searched" && webSearchCallCount === 0) return "needed";
  return status;
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

export function trimBaselineAnswerForSchema(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const raw = value as Record<string, unknown>;
  const trimString = (field: string, maxLength: number) => {
    if (typeof raw[field] === "string") {
      raw[field] = truncate(raw[field], maxLength);
    }
  };
  trimString("summary", 1400);
  trimString("current_position", 1200);
  trimString("goal", 900);
  trimString("recommended_next_move", 500);
  trimString("first_action", 700);
  trimString("first_10_minutes", 600);
  trimString("success_condition", 500);
  trimString("if_blocked", 500);

  for (const field of [
    ["constraints", 240],
    ["assets", 240],
    ["assumptions", 240],
    ["assumptions_to_watch", 240],
  ] as const) {
    const [key, maxLength] = field;
    if (Array.isArray(raw[key])) {
      raw[key] = raw[key].map((item) =>
        typeof item === "string" ? truncate(item, maxLength) : item,
      );
    }
  }

  if (Array.isArray(raw.options)) {
    raw.options = raw.options.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const option = { ...(item as Record<string, unknown>) };
      if (typeof option.label === "string") option.label = truncate(option.label, 120);
      if (typeof option.rationale === "string") {
        option.rationale = truncate(option.rationale, 800);
      }
      if (typeof option.first_action_preview === "string") {
        option.first_action_preview = truncate(option.first_action_preview, 240);
      }
      return option;
    });
  }

  if (Array.isArray(raw.memory_updates)) {
    raw.memory_updates = raw.memory_updates.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const memory = { ...(item as Record<string, unknown>) };
      if (typeof memory.label === "string") memory.label = truncate(memory.label, 160);
      if (typeof memory.value === "string") memory.value = truncate(memory.value, 500);
      return memory;
    });
  }

  return raw;
}

function actionFromBaseline(answer: BaselineAnswer) {
  return {
    title: truncate(answer.recommended_next_move, 180),
    details: truncate(answer.first_action, 2000),
    estimated_minutes: 10,
    success_condition: truncate(answer.success_condition, 1000),
    fallback: truncate(answer.if_blocked, 1000),
  };
}

export function baselineAnswerToEvalOutput({
  scenario,
  answer,
  model,
  webSearchAllowed,
  webSearchCallCount,
}: {
  scenario: EvalScenario;
  answer: BaselineAnswer;
  model: string;
  webSearchAllowed: boolean;
  webSearchCallCount: number;
}): EvalOutput {
  const now = new Date().toISOString();
  const rootId = `baseline-root-${scenario.id}`;
  const recommended =
    answer.options.find((option) => option.recommendation_level === "recommended") ??
    answer.options[0];
  const recommendedId = `baseline-option-${Math.max(
    0,
    answer.options.indexOf(recommended),
  )}`;
  const currentAction = actionFromBaseline(answer);
  const decisionTree: DecisionTree = {
    id: `baseline-tree-${scenario.id}`,
    board_id: null,
    root_node_id: rootId,
    active_node_id: rootId,
    selected_path: [recommendedId],
    recommended_option_id: recommendedId,
    current_action: currentAction,
    nodes: [
      {
        id: rootId,
        parent_id: null,
        selected_from_option_id: null,
        kind: "decision",
        title: truncate(answer.goal, 180),
        question: truncate(answer.goal, 500),
        context_summary: truncate(answer.current_position, 1200),
        selected_option_id: recommendedId,
        status: "active",
        search_status: honestSearchStatus(answer.search_status, webSearchCallCount),
        generated_at: now,
        action: null,
        options: answer.options.map((option, index) => {
          const optionId = `baseline-option-${index}`;
          const optionSearchStatus = honestSearchStatus(
            option.search_status,
            webSearchCallCount,
          );
          return {
            id: optionId,
            node_id: rootId,
            label: truncate(option.label, 120),
            description: truncate(option.rationale, 1000),
            move_type: "mixed" as const,
            recommendation_level: option.recommendation_level,
            why: truncate(option.rationale, 1200),
            upside: truncate(option.rationale, 900),
            downside: "Tradeoffs should be checked against the user's constraints.",
            friction: "medium" as const,
            time_to_feedback: "This week",
            requires_web_search: optionSearchStatus !== "not_needed",
            search_status: optionSearchStatus,
            next_node_id: null,
            can_explore: true,
            first_action: {
              title: truncate(option.first_action_preview, 180),
              details: truncate(option.first_action_preview, 2000),
              estimated_minutes: 10,
              success_condition: truncate(answer.success_condition, 1000),
              fallback: truncate(answer.if_blocked, 1000),
            },
            success_condition: truncate(answer.success_condition, 1000),
            fallback: truncate(answer.if_blocked, 1000),
            selected: optionId === recommendedId,
            next_steps: [],
            sources: [],
          };
        }),
      },
    ],
    created_at: now,
    updated_at: now,
  };

  return {
    scenarioId: scenario.id,
    boardTitle: truncate(answer.summary, 180),
    primaryDomain: answer.primary_domain,
    secondaryDomains: answer.secondary_domains,
    boardState: {
      currentPosition: answer.current_position,
      goal: answer.goal,
      constraints: answer.constraints,
      assets: answer.assets,
      assumptions: [...answer.assumptions, ...answer.assumptions_to_watch],
    },
    decisionTree,
    memoryItems: answer.memory_updates.map((item, index) => ({
      id: `baseline-memory-${index}`,
      label: item.label,
      value: item.value,
      status: item.status,
    })),
    webSearchCallCount,
    notes: `Direct baseline model: ${model}`,
    trace: {
      scenarioId: scenario.id,
      generationKind: "plan",
      model,
      modelRole: "direct_baseline",
      webSearchAllowed,
      webSearchCallCount,
      schemaValid: true,
      promptSections: ["directGpt55BaselinePrompt", "directBaselineJsonSchema"],
      boardTitle: truncate(answer.summary, 180),
      rootQuestion: answer.goal,
      branchOptions: answer.options.map((option) => option.label),
      recommendedBranch: recommended.label,
      actionLeaf: answer.recommended_next_move,
      searchStatusSummary: [
        ...new Set([
          honestSearchStatus(answer.search_status, webSearchCallCount),
          ...answer.options.map((option) =>
            honestSearchStatus(option.search_status, webSearchCallCount),
          ),
        ]),
      ],
      notes: [answer.summary],
    } satisfies EvalTrace,
  };
}

export async function generateDirectBaselineAnswer({
  scenario,
  env,
}: {
  scenario: EvalScenario;
  env: EvalEnv;
}) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");
  const model = baselineModelFromEnv(env);
  const { system, user } = buildDirectBaselinePrompt(scenario, {
    webSearchAvailable: false,
  });
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model,
    max_output_tokens: 3500,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user, null, 2) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "flowpath_direct_gpt55_baseline",
        description: "Standalone direct-answer baseline for FlowPath evals.",
        strict: true,
        schema: baselineJsonSchema,
      },
    },
  });
  const outputText = extractOutputText(response);
  if (!outputText) throw new Error("The baseline model returned an empty response.");
  const answer = baselineAnswerSchema.parse(
    trimBaselineAnswerForSchema(JSON.parse(outputText)),
  );
  return {
    answer,
    output: baselineAnswerToEvalOutput({
      scenario,
      answer,
      model,
      webSearchAllowed: false,
      webSearchCallCount: 0,
    }),
    model,
    modelCalls: 1,
  };
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function summarizeOutputForJudge(output: EvalOutput) {
  const root = output.decisionTree?.nodes.find(
    (node) => node.id === output.decisionTree?.root_node_id,
  );
  const recommended = root?.options.find(
    (option) => option.id === output.decisionTree?.recommended_option_id,
  );
  return {
    board_title: output.boardTitle,
    primary_domain: output.primaryDomain,
    secondary_domains: output.secondaryDomains,
    current_position: output.boardState.currentPosition,
    goal: output.boardState.goal,
    constraints: output.boardState.constraints,
    assets: output.boardState.assets,
    branches: root?.options.map((option) => ({
      label: option.label,
      rationale: option.description || option.why,
      recommendation_level: option.recommendation_level,
      search_status: option.search_status,
    })),
    recommended_branch: recommended?.label,
    action: output.decisionTree?.current_action ?? {
      title: output.reconciliation?.recommended_followup_action ?? "",
      details: output.reconciliation?.user_visible_explanation ?? "",
      success_condition: "",
      fallback: output.reconciliation?.follow_up_question ?? "",
    },
    memory_items: output.memoryItems,
    search_calls: output.webSearchCallCount,
    notes: output.notes,
  };
}

export function anonymizePairwiseOutputs({
  scenarioId,
  flowpathOutput,
  baselineOutput,
}: {
  scenarioId: string;
  flowpathOutput: EvalOutput;
  baselineOutput: EvalOutput;
}) {
  const flowpathIsA = stableHash(scenarioId) % 2 === 0;
  return {
    order: {
      a: flowpathIsA ? ("flowpath" as const) : ("baseline" as const),
      b: flowpathIsA ? ("baseline" as const) : ("flowpath" as const),
    },
    outputs: {
      a: summarizeOutputForJudge(flowpathIsA ? flowpathOutput : baselineOutput),
      b: summarizeOutputForJudge(flowpathIsA ? baselineOutput : flowpathOutput),
    },
  };
}

export function buildPairwiseJudgePrompt({
  scenario,
  anonymousOutputs,
}: {
  scenario: EvalScenario;
  anonymousOutputs: ReturnType<typeof anonymizePairwiseOutputs>;
}) {
  return {
    system: [
      "You are judging two anonymous assistant outputs for FlowPath's quality benchmark.",
      "Do not infer which system produced which output. Judge only usefulness for helping the user decide what to do next.",
      "Prefer the output with clearer branches, a more concrete next action, better context use, better search honesty, better safety handling, and realistic but non-demeaning tone.",
      "A polished prose answer should not beat a more useful decision structure unless it is genuinely more actionable.",
      "Return only the requested JSON shape.",
    ].join("\n"),
    user: {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      entry_domain: scenario.entryDomain,
      user_inputs: scenario.userInputs,
      output_a: anonymousOutputs.outputs.a,
      output_b: anonymousOutputs.outputs.b,
    },
  };
}

export function parsePairwisePreferenceChoice(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "a" || normalized === "output a" || normalized === "assistant a") {
    return "a" as const;
  }
  if (normalized === "b" || normalized === "output b" || normalized === "assistant b") {
    return "b" as const;
  }
  if (normalized === "tie" || normalized === "both" || normalized === "neither") {
    return "tie" as const;
  }
  const firstChoice = normalized.match(/\b(?:output|assistant)?\s*([ab])\b/);
  if (firstChoice?.[1] === "a" || firstChoice?.[1] === "b") {
    return firstChoice[1] as "a" | "b";
  }
  if (/\btie\b|\bequal\b|\broughly even\b/.test(normalized)) return "tie" as const;
  return null;
}

export function preferenceToSystem(
  choice: "a" | "b" | "tie",
  order: ReturnType<typeof anonymizePairwiseOutputs>["order"],
) {
  if (choice === "tie") return "tie" as const;
  return order[choice];
}

export function inferPairwiseRationaleChoice(rationale: string) {
  const normalized = rationale.trim().toLowerCase();
  const firstSentence = normalized.split(/[.!?]\s/)[0] ?? normalized;
  if (/\boutput a\b[^.?!]{0,80}\b(?:more useful|better|stronger|wins|preferred|prefer)/.test(firstSentence)) {
    return "a" as const;
  }
  if (/\boutput b\b[^.?!]{0,80}\b(?:more useful|better|stronger|wins|preferred|prefer)/.test(firstSentence)) {
    return "b" as const;
  }
  if (/\bprefer output a\b|\bchoose output a\b|\boutput a is\b[^.?!]{0,80}\bmore useful\b/.test(normalized)) {
    return "a" as const;
  }
  if (/\bprefer output b\b|\bchoose output b\b|\boutput b is\b[^.?!]{0,80}\bmore useful\b/.test(normalized)) {
    return "b" as const;
  }
  return null;
}

export function pairwiseMappingWarningForRationale({
  judgeRawChoice,
  rationale,
}: {
  judgeRawChoice: "a" | "b" | "tie";
  rationale: string;
}) {
  const rationaleChoice = inferPairwiseRationaleChoice(rationale);
  return rationaleChoice && rationaleChoice !== judgeRawChoice
    ? `Judge rationale appears to prefer Output ${rationaleChoice.toUpperCase()} but raw winner was ${judgeRawChoice}.`
    : undefined;
}

export async function runPairwiseJudge({
  scenario,
  flowpathOutput,
  baselineOutput,
  env,
}: {
  scenario: EvalScenario;
  flowpathOutput: EvalOutput;
  baselineOutput: EvalOutput;
  env: EvalEnv;
}): Promise<PairwiseJudgeResult> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY.");
  const model = judgeModelFromEnv(env);
  const anonymousOutputs = anonymizePairwiseOutputs({
    scenarioId: scenario.id,
    flowpathOutput,
    baselineOutput,
  });
  const { system, user } = buildPairwiseJudgePrompt({ scenario, anonymousOutputs });
  const openai = new OpenAI({ apiKey });
  const response = await openai.responses.create({
    model,
    max_output_tokens: 1800,
    input: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user, null, 2) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "flowpath_pairwise_live_eval_judge",
        description: "Pairwise judge output for FlowPath live comparison evals.",
        strict: true,
        schema: pairwiseJudgeJsonSchema,
      },
    },
  });
  const outputText = extractOutputText(response);
  if (!outputText) throw new Error("The pairwise judge returned an empty response.");
  const judged = pairwiseJudgeSchema.parse(JSON.parse(outputText));
  const judgeRawChoice = parsePairwisePreferenceChoice(judged.winner);
  if (!judgeRawChoice) {
    throw new Error(`The pairwise judge returned an unmappable winner: ${judged.winner}`);
  }
  const mappedWinner = preferenceToSystem(judgeRawChoice, anonymousOutputs.order);
  const mappingWarning = pairwiseMappingWarningForRationale({
    judgeRawChoice,
    rationale: judged.rationale,
  });
  return {
    winner: mappedWinner,
    mappedWinner,
    judgeRawChoice,
    outputASystem: anonymousOutputs.order.a,
    outputBSystem: anonymousOutputs.order.b,
    outputOrder: anonymousOutputs.order,
    betterActionability: judged.better_actionability,
    betterBranchClarity: judged.better_branch_clarity,
    betterRealism: judged.better_realism,
    betterContextUse: judged.better_context_use,
    betterSafetySearchHonesty: judged.better_safety_search_honesty,
    rationale: judged.rationale,
    model,
    mappingWarning,
  };
}
