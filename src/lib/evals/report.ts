import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  CriticalFailure,
  EvalScenarioResult,
  EvalSuiteReport,
  LiveComparisonReport,
} from "./types";

function percent(score: number, maxScore: number) {
  if (!maxScore) return "0%";
  return `${Math.round((score / maxScore) * 100)}%`;
}

function failureMarkdown(failure: CriticalFailure) {
  const evidence = failure.evidence;
  if (!evidence) return `${failure.id}: ${failure.note}`;
  return [
    `${failure.id}: ${failure.note}`,
    `field=${evidence.fieldPath}`,
    `visible=${evidence.visible}`,
    `source=${evidence.source}`,
    `web_search_calls=${evidence.webSearchCallCount}`,
    evidence.searchStatus ? `search_status=${evidence.searchStatus}` : null,
    `text="${evidence.text.replace(/\s+/g, " ")}"`,
  ]
    .filter(Boolean)
    .join("; ");
}

function scenarioMarkdown(result: EvalScenarioResult) {
  const lines = [
    `### ${result.passed ? "PASS" : "FAIL"}: ${result.scenarioName}`,
    "",
    `Score: ${result.overallScore.toFixed(1)} / ${result.maxScore} (${percent(
      result.overallScore,
      result.maxScore,
    )})`,
    "",
  ];

  if (result.criticalFailures.length) {
    lines.push("Critical failures:");
    for (const failure of result.criticalFailures) {
      lines.push(`- ${failureMarkdown(failure)}`);
    }
    lines.push("");
  }

  lines.push("| Dimension | Score | Notes |");
  lines.push("| --- | ---: | --- |");
  for (const item of result.scores) {
    lines.push(
      `| ${item.label} | ${item.score.toFixed(1)} / ${item.maxScore} | ${item.notes.join(" ")} |`,
    );
  }
  lines.push("");
  if (result.notes.length) {
    lines.push("Notes:");
    for (const note of result.notes) lines.push(`- ${note}`);
    lines.push("");
  }
  return lines.join("\n");
}

function suiteBreakdownMarkdown(results: EvalScenarioResult[]) {
  const grouped = new Map<string, EvalScenarioResult[]>();
  for (const result of results) {
    const suite = result.suite ?? "regression";
    grouped.set(suite, [...(grouped.get(suite) ?? []), result]);
  }
  if (grouped.size <= 1) return [];
  const lines = [
    "## Suite Summary",
    "",
    "| Suite | Scenarios | Score | Critical failures |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const [suite, suiteResults] of grouped) {
    const score = suiteResults.reduce((sum, result) => sum + result.overallScore, 0);
    const maxScore = suiteResults.reduce((sum, result) => sum + result.maxScore, 0);
    const failures = suiteResults.reduce(
      (sum, result) => sum + result.criticalFailures.length,
      0,
    );
    lines.push(
      `| ${suite} | ${suiteResults.length} | ${score.toFixed(1)} / ${maxScore} | ${failures} |`,
    );
  }
  lines.push("");
  return lines;
}

function comparisonFixCues(result: {
  flowpath: Pick<EvalScenarioResult, "criticalFailures">;
}) {
  const failureIds = new Set(result.flowpath.criticalFailures.map((failure) => failure.id));
  const cues: string[] = [];
  if (
    failureIds.has("vague_search_action") ||
    failureIds.has("hallucinated_local_without_search")
  ) {
    cues.push(
      "Turn local/current next actions into concrete search/check workflows with query terms, shortlist criteria, quantity, time boundary, success, and fallback.",
    );
  }
  if (failureIds.has("branch_step_mixing") || failureIds.has("duplicate_branches")) {
    cues.push(
      "Move step-like options out of root branches and into the selected path/action leaf.",
    );
  }
  if (failureIds.has("vague_reconciliation_followup")) {
    cues.push(
      "Make reconciliation follow-up either an explicit no-action-needed reason or a practical next move.",
    );
  }
  if (failureIds.has("internal_jargon_labels")) {
    cues.push("Translate internal strategy language into normal user-facing branch labels.");
  }
  return cues;
}

export function renderEvalReportMarkdown(report: EvalSuiteReport) {
  const structuredRepairAttempts =
    report.traces?.reduce(
      (sum, trace) => sum + (trace.structuredOutputRepairAttempts ?? 0),
      0,
    ) ?? 0;
  const structuredRepairSuccesses =
    report.traces?.filter((trace) => trace.structuredOutputRepaired).length ?? 0;
  const structuredRepairFailures = report.results.reduce(
    (sum, result) =>
      sum +
      result.criticalFailures.filter(
        (failure) => failure.id === "structured_repair_failed",
      ).length,
    0,
  );
  const lines = [
    "# FlowPath Output Quality Eval",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    ...(report.suite ? [`Suite: ${report.suite}`] : []),
    `Git commit: ${report.gitCommit ?? "unknown"}`,
    `Model config: ${report.modelConfig ?? "offline mocks"}`,
    ...(report.selectedScenarioIds?.length
      ? [`Scenario IDs: ${report.selectedScenarioIds.join(", ")}`]
      : []),
    ...(typeof report.totalModelCalls === "number"
      ? [`Model calls: ${report.totalModelCalls}`]
      : []),
    ...(typeof report.webSearchEnabled === "boolean"
      ? [`Web search enabled: ${report.webSearchEnabled ? "yes" : "no"}`]
      : []),
    ...(report.mode === "live"
      ? [
          `Structured output repairs: ${structuredRepairSuccesses} succeeded / ${structuredRepairAttempts} attempted; ${structuredRepairFailures} failed`,
        ]
      : []),
    "",
    `Overall: ${report.passed ? "PASS" : "FAIL"} - ${report.overallScore.toFixed(
      1,
    )} / ${report.maxScore} (${percent(report.overallScore, report.maxScore)})`,
    "",
    ...suiteBreakdownMarkdown(report.results),
    "## Scenario Summary",
    "",
    "| Scenario | Result | Score | Critical failures |",
    "| --- | --- | ---: | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${result.scenarioName} | ${result.passed ? "PASS" : "FAIL"} | ${result.overallScore.toFixed(
        1,
      )} / ${result.maxScore} | ${
        result.criticalFailures.map((failure) => failure.id).join(", ") || "-"
      } |`,
    );
  }

  lines.push("", "## Scenario Details", "");
  for (const result of report.results) {
    lines.push(scenarioMarkdown(result));
  }

  if (report.traces?.length) {
    lines.push("## Live Trace Summary", "");
    for (const trace of report.traces) {
      lines.push(`### ${trace.scenarioId}`);
      lines.push("");
      lines.push(`- Generation: ${trace.generationKind}`);
      lines.push(`- Model: ${trace.model ?? "unknown"}`);
      lines.push(`- Model role: ${trace.modelRole ?? "unknown"}`);
      lines.push(`- Web search allowed: ${trace.webSearchAllowed ? "yes" : "no"}`);
      lines.push(`- Web search calls: ${trace.webSearchCallCount}`);
      lines.push(`- Schema valid: ${trace.schemaValid ? "yes" : "no"}`);
      if (trace.structuredOutputRepaired) {
        lines.push(
          `- Structured output repair: yes (${trace.structuredOutputRepairAttempts ?? 1} attempt)`,
        );
      } else if (typeof trace.structuredOutputRepaired === "boolean") {
        lines.push("- Structured output repair: no");
      }
      if (trace.structuredOutputInitialError) {
        lines.push(`- Initial structured-output error: ${trace.structuredOutputInitialError}`);
      }
      if (trace.structuredOutputRawExcerpt) {
        lines.push(`- Invalid output excerpt: ${trace.structuredOutputRawExcerpt}`);
      }
      lines.push(`- Prompt sections: ${trace.promptSections.join(", ") || "unknown"}`);
      lines.push(`- Board title: ${trace.boardTitle}`);
      if (trace.rootQuestion) lines.push(`- Root: ${trace.rootQuestion}`);
      if (trace.branchOptions?.length) {
        lines.push(`- Branches: ${trace.branchOptions.join(" | ")}`);
      }
      if (trace.recommendedBranch) {
        lines.push(`- Recommended branch: ${trace.recommendedBranch}`);
      }
      if (trace.actionTitle && trace.actionTitle !== trace.actionLeaf) {
        lines.push(`- Action title: ${trace.actionTitle}`);
      }
      if (trace.actionLeaf) lines.push(`- Action: ${trace.actionLeaf}`);
      if (trace.memoryOperations?.length) {
        lines.push(`- Memory operations: ${trace.memoryOperations.join(" | ")}`);
      }
      if (trace.searchStatusSummary?.length) {
        lines.push(`- Search statuses: ${trace.searchStatusSummary.join(", ")}`);
      }
      if (trace.notes?.length) {
        lines.push(`- Notes: ${trace.notes.join(" | ")}`);
      }
      lines.push("");
    }
  }

  lines.push(
    "## Next Fix Cues",
    "",
    "- Critical failures should be fixed before tuning weighted scores.",
    "- Branch quality failures usually point to prompt/schema drift in Move Map generation.",
    "- Search honesty failures should be fixed in postprocessing before making prompts more ambitious.",
    "- Memory failures usually mean stale/deleted memory is still selected into generation context.",
    "",
  );

  return lines.join("\n");
}

export async function writeEvalReport(
  report: EvalSuiteReport,
  outputDir = path.join(process.cwd(), "docs", "evals"),
) {
  const runsDir = path.join(outputDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const safeTimestamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(
    runsDir,
    report.mode === "live" ? `${safeTimestamp}-live.json` : `${safeTimestamp}.json`,
  );
  const latestPath = path.join(
    outputDir,
    report.mode === "live"
      ? "latest-flowpath-live-eval.md"
      : report.suite === "anti_overfit"
        ? "latest-flowpath-anti-overfit-eval.md"
        : report.suite === "regression"
          ? "latest-flowpath-regression-eval.md"
          : "latest-flowpath-eval.md",
  );
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestPath, `${renderEvalReportMarkdown(report)}\n`, "utf8");
  return {
    jsonPath,
    latestPath,
  };
}

export function renderLiveComparisonReportMarkdown(report: LiveComparisonReport) {
  const flowpathRepairAttempts = report.results.reduce(
    (sum, result) =>
      sum + (result.flowpathTrace?.structuredOutputRepairAttempts ?? 0),
    0,
  );
  const flowpathRepairSuccesses = report.results.filter(
    (result) => result.flowpathTrace?.structuredOutputRepaired,
  ).length;
  const flowpathRepairFailures = report.results.reduce(
    (sum, result) =>
      sum +
      result.flowpath.criticalFailures.filter(
        (failure) => failure.id === "structured_repair_failed",
      ).length,
    0,
  );
  const lines = [
    "# FlowPath Live Comparison Eval",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    ...(report.suite ? [`Suite: ${report.suite}`] : []),
    `Git commit: ${report.gitCommit ?? "unknown"}`,
    `Model config: ${report.modelConfig ?? "unknown"}`,
    `Scenario IDs: ${report.selectedScenarioIds.join(", ")}`,
    `Model calls: ${report.totalModelCalls} / ${report.budget}`,
    `Web search enabled: ${report.webSearchEnabled ? "yes" : "no"}`,
    ...(report.searchMode ? [`Search mode: ${report.searchMode}`] : []),
    `Pairwise judge: ${report.judgeEnabled ? "enabled" : report.judgeRequested ? "requested but skipped by budget" : "disabled"}`,
    `FlowPath structured output repairs: ${flowpathRepairSuccesses} succeeded / ${flowpathRepairAttempts} attempted; ${flowpathRepairFailures} failed`,
    "",
    `FlowPath average: ${report.flowpathAverageScore.toFixed(1)} / ${report.flowpathMaxScore.toFixed(1)}`,
    `Baseline average: ${report.baselineAverageScore.toFixed(1)} / ${report.baselineMaxScore.toFixed(1)}`,
    `Delta: ${report.delta >= 0 ? "+" : ""}${report.delta.toFixed(1)}`,
    `Pairwise: FlowPath ${report.pairwiseWins.flowpath}, baseline ${report.pairwiseWins.baseline}, ties ${report.pairwiseWins.tie}`,
    `Critical failures: FlowPath ${report.criticalFailures.flowpath}, baseline ${report.criticalFailures.baseline}`,
    "",
    "## Scenario Summary",
    "",
    "| Scenario | FlowPath | Baseline | Delta | Pairwise | Critical failures |",
    "| --- | ---: | ---: | ---: | --- | --- |",
  ];

  for (const result of report.results) {
    const flowpathFailures =
      result.flowpath.criticalFailures.map((failure) => failure.id).join(", ") || "-";
    const baselineFailures =
      result.baseline.criticalFailures.map((failure) => failure.id).join(", ") || "-";
    lines.push(
      `| ${result.scenarioName} | ${result.flowpath.overallScore.toFixed(1)} / ${result.flowpath.maxScore} | ${result.baseline.overallScore.toFixed(1)} / ${result.baseline.maxScore} | ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(1)} | ${result.pairwiseJudge?.winner ?? "-"} | FlowPath: ${flowpathFailures}; baseline: ${baselineFailures} |`,
    );
  }

  lines.push("", "## Scenario Details", "");
  for (const result of report.results) {
    lines.push(`### ${result.scenarioName}`);
    lines.push("");
    lines.push(`- FlowPath: ${result.flowpath.overallScore.toFixed(1)} / ${result.flowpath.maxScore}`);
    lines.push(`- Baseline: ${result.baseline.overallScore.toFixed(1)} / ${result.baseline.maxScore}`);
    lines.push(`- Delta: ${result.delta >= 0 ? "+" : ""}${result.delta.toFixed(1)}`);
    if (result.pairwiseJudge) {
      lines.push(
        `- Pairwise: judge chose ${result.pairwiseJudge.judgeRawChoice.toUpperCase()}; A=${result.pairwiseJudge.outputASystem}; B=${result.pairwiseJudge.outputBSystem}; mapped winner=${result.pairwiseJudge.mappedWinner}`,
      );
      lines.push(`- Judge model: ${result.pairwiseJudge.model}`);
      lines.push(`- Judge rationale: ${result.pairwiseJudge.rationale}`);
      if (result.pairwiseJudge.mappingWarning) {
        lines.push(`- Pairwise mapping warning: ${result.pairwiseJudge.mappingWarning}`);
      }
    } else if (result.pairwiseJudgeError) {
      lines.push(`- Pairwise judge failed: ${result.pairwiseJudgeError}`);
    }
    if (result.flowpath.criticalFailures.length) {
      lines.push("- FlowPath critical failure details:");
      for (const failure of result.flowpath.criticalFailures) {
        lines.push(`  - ${failureMarkdown(failure)}`);
      }
    }
    if (result.baseline.criticalFailures.length) {
      lines.push("- Baseline critical failure details:");
      for (const failure of result.baseline.criticalFailures) {
        lines.push(`  - ${failureMarkdown(failure)}`);
      }
    }
    if (result.flowpathTrace) {
      lines.push(`- FlowPath model: ${result.flowpathTrace.model ?? "unknown"}`);
      lines.push(`- FlowPath branches: ${result.flowpathTrace.branchOptions?.join(" | ") || "none"}`);
      if (
        result.flowpathTrace.actionTitle &&
        result.flowpathTrace.actionTitle !== result.flowpathTrace.actionLeaf
      ) {
        lines.push(`- FlowPath action title: ${result.flowpathTrace.actionTitle}`);
      }
      lines.push(`- FlowPath action: ${result.flowpathTrace.actionLeaf ?? "none"}`);
      lines.push(`- FlowPath web-search calls: ${result.flowpathTrace.webSearchCallCount}`);
      if (result.flowpathTrace.structuredOutputRepaired) {
        lines.push(
          `- FlowPath structured output repaired: yes (${result.flowpathTrace.structuredOutputRepairAttempts ?? 1} attempt)`,
        );
      }
      if (result.flowpathTrace.structuredOutputInitialError) {
        lines.push(
          `- FlowPath initial structured-output error: ${result.flowpathTrace.structuredOutputInitialError}`,
        );
      }
    }
    if (result.baselineTrace) {
      lines.push(`- Baseline model: ${result.baselineTrace.model ?? "unknown"}`);
      lines.push(`- Baseline branches: ${result.baselineTrace.branchOptions?.join(" | ") || "none"}`);
      if (
        result.baselineTrace.actionTitle &&
        result.baselineTrace.actionTitle !== result.baselineTrace.actionLeaf
      ) {
        lines.push(`- Baseline action title: ${result.baselineTrace.actionTitle}`);
      }
      lines.push(`- Baseline action: ${result.baselineTrace.actionLeaf ?? "none"}`);
      lines.push(`- Baseline web-search calls: ${result.baselineTrace.webSearchCallCount}`);
    }
    const fixCues = comparisonFixCues(result);
    if (fixCues.length) {
      lines.push("- Recommended fix cues:");
      for (const cue of fixCues) lines.push(`  - ${cue}`);
    }
    if (result.notes.length) {
      lines.push(`- Notes: ${result.notes.join(" | ")}`);
    }
    lines.push("");
  }

  lines.push(
    "## Interpretation",
    "",
    "- FlowPath does not need to beat the baseline on prose polish.",
    "- The intended advantage is next-action clarity, branch distinction, continuity/memory use, search honesty, and actionable Move Map structure.",
    "- Inspect scenario deltas and critical failures before changing prompts or model routing.",
    "",
  );

  return lines.join("\n");
}

export async function writeLiveComparisonReport(
  report: LiveComparisonReport,
  outputDir = path.join(process.cwd(), "docs", "evals"),
) {
  const runsDir = path.join(outputDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const safeTimestamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = path.join(runsDir, `${safeTimestamp}-live-comparison.json`);
  const latestPath = path.join(outputDir, "latest-flowpath-live-comparison.md");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(
    latestPath,
    `${renderLiveComparisonReportMarkdown(report)}\n`,
    "utf8",
  );
  return {
    jsonPath,
    latestPath,
  };
}
