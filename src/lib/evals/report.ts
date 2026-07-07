import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { EvalScenarioResult, EvalSuiteReport } from "./types";

function percent(score: number, maxScore: number) {
  if (!maxScore) return "0%";
  return `${Math.round((score / maxScore) * 100)}%`;
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
      lines.push(`- ${failure.id}: ${failure.note}`);
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

export function renderEvalReportMarkdown(report: EvalSuiteReport) {
  const lines = [
    "# FlowPath Output Quality Eval",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
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
    "",
    `Overall: ${report.passed ? "PASS" : "FAIL"} - ${report.overallScore.toFixed(
      1,
    )} / ${report.maxScore} (${percent(report.overallScore, report.maxScore)})`,
    "",
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
      lines.push(`- Prompt sections: ${trace.promptSections.join(", ") || "unknown"}`);
      lines.push(`- Board title: ${trace.boardTitle}`);
      if (trace.rootQuestion) lines.push(`- Root: ${trace.rootQuestion}`);
      if (trace.branchOptions?.length) {
        lines.push(`- Branches: ${trace.branchOptions.join(" | ")}`);
      }
      if (trace.recommendedBranch) {
        lines.push(`- Recommended branch: ${trace.recommendedBranch}`);
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
      : "latest-flowpath-eval.md",
  );
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestPath, `${renderEvalReportMarkdown(report)}\n`, "utf8");
  return {
    jsonPath,
    latestPath,
  };
}
