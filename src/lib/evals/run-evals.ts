import { execFileSync } from "node:child_process";

import { inferBoardTitle } from "../entry-domains";
import { generateNextMovePlan, type StrategistContext } from "../flowpath-ai";
import type {
  CheckIn,
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
import type { EvalOutput, EvalScenario } from "./types";

type EvalEnv = Record<string, string | undefined>;

export function resolveEvalMode(args: string[], env: EvalEnv) {
  const requestedLive = args.includes("--live") || env.FLOWPATH_LIVE_EVALS === "1";
  if (!requestedLive) return "offline" as const;
  if (env.FLOWPATH_LIVE_EVALS !== "1") {
    throw new Error("Live evals require FLOWPATH_LIVE_EVALS=1.");
  }
  if (!env.OPENAI_API_KEY) {
    throw new Error("Live evals require OPENAI_API_KEY.");
  }
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  if (!Number.isInteger(callBudget) || callBudget < 1) {
    throw new Error("Live evals require FLOWPATH_LIVE_EVAL_MAX_CALLS with an explicit positive integer.");
  }
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

async function runLiveEvalOutputs(
  scenarios: EvalScenario[],
  env: EvalEnv,
): Promise<Record<string, EvalOutput>> {
  const maxScenarios = scenarioCountFromEnv(env);
  const callBudget = Number(env.FLOWPATH_LIVE_EVAL_MAX_CALLS);
  const selectedScenarios = scenarios.slice(0, maxScenarios);
  if (selectedScenarios.length > callBudget) {
    throw new Error(
      `Live eval budget ${callBudget} is lower than selected scenario count ${selectedScenarios.length}.`,
    );
  }
  console.log(
    `Live FlowPath evals are enabled. Estimated model calls: ${selectedScenarios.length}.`,
  );
  const outputs: Record<string, EvalOutput> = {};
  for (const [index, scenario] of selectedScenarios.entries()) {
    const generated = await generateNextMovePlan(liveEvalContextForScenario(scenario, index), {
      allowWebSearch: env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1",
    });
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
  }
  return outputs;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = resolveEvalMode(args, process.env);
  const writeReport = !args.includes("--no-write");
  const generatedAt = new Date().toISOString();
  const outputsByScenarioId =
    mode === "live"
      ? await runLiveEvalOutputs(evalScenarios, process.env)
      : mockOutputsByScenarioId;
  const report = scoreEvalSuite(evalScenarios, outputsByScenarioId, {
    generatedAt,
    mode,
    gitCommit: currentGitCommit(),
    modelConfig:
      mode === "live"
        ? `FLOWPATH_LIVE_EVALS=1; max_calls=${process.env.FLOWPATH_LIVE_EVAL_MAX_CALLS}; web_search=${process.env.FLOWPATH_LIVE_EVAL_WEB_SEARCH === "1"}`
        : "offline mocked outputs",
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
