import { all } from "../src/lib/db";

type GenerationEventSummaryRow = {
  flow_type: string | null;
  generation_type: string;
  status: string;
  flow_status: string | null;
  model: string | null;
  duration_ms: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  estimated_cost_usd: number | null;
  web_search_call_count: number | null;
  tasks_created_count: number | null;
  used_evaluator: number | null;
  evaluator_triggered_revision: number | null;
  safety_route_triggered: number | null;
  quota_tier: string | null;
  quota_usage_type: string | null;
  error_category: string | null;
  error_message_sanitized: string | null;
  started_at: string;
};

type GroupSummary = {
  key: string;
  count: number;
  successes: number;
  errors: number;
  quotaBlocked: number;
  safetyRouted: number;
  durations: number[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  webSearchCalls: number;
  evaluatorUses: number;
  evaluatorRevisions: number;
  tasksCreated: number;
};

type ModelSummary = {
  key: string;
  count: number;
  durations: number[];
  outputTokens: number;
};

function numberArg(name: string, fallback: number) {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function fmtMs(value: number | null) {
  return value == null ? "n/a" : `${Math.round(value)}ms`;
}

function fmtMoney(value: number) {
  return value > 0 ? `$${value.toFixed(4)}` : "n/a";
}

function groupKey(row: GenerationEventSummaryRow) {
  return row.flow_type || row.generation_type;
}

function ensureGroup(groups: Map<string, GroupSummary>, key: string) {
  const existing = groups.get(key);
  if (existing) return existing;
  const created: GroupSummary = {
    key,
    count: 0,
    successes: 0,
    errors: 0,
    quotaBlocked: 0,
    safetyRouted: 0,
    durations: [],
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    webSearchCalls: 0,
    evaluatorUses: 0,
    evaluatorRevisions: 0,
    tasksCreated: 0,
  };
  groups.set(key, created);
  return created;
}

async function main() {
  const days = numberArg("days", 14);
  const limit = numberArg("limit", 1000);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const rows = await all<GenerationEventSummaryRow>(
    `SELECT
      flow_type, generation_type, status, flow_status, model, duration_ms,
      input_tokens, cached_input_tokens, output_tokens, total_tokens,
      estimated_cost_usd, web_search_call_count, tasks_created_count, used_evaluator,
      evaluator_triggered_revision, safety_route_triggered, quota_tier,
      quota_usage_type, error_category, error_message_sanitized, started_at
    FROM generation_events
    WHERE started_at >= ?
    ORDER BY started_at DESC
    LIMIT ?`,
    [since, limit],
  );

  const groups = new Map<string, GroupSummary>();
  const models = new Map<string, ModelSummary>();
  for (const row of rows) {
    const group = ensureGroup(groups, groupKey(row));
    group.count += 1;
    if (row.status === "success") group.successes += 1;
    if (row.status === "error") group.errors += 1;
    if (row.flow_status === "quota_blocked") group.quotaBlocked += 1;
    if (row.flow_status === "safety_routed") group.safetyRouted += 1;
    if (typeof row.duration_ms === "number") group.durations.push(row.duration_ms);
    group.inputTokens += row.input_tokens ?? 0;
    group.cachedInputTokens += row.cached_input_tokens ?? 0;
    group.outputTokens += row.output_tokens ?? 0;
    group.totalTokens += row.total_tokens ?? 0;
    group.estimatedCostUsd += row.estimated_cost_usd ?? 0;
    group.webSearchCalls += row.web_search_call_count ?? 0;
    group.evaluatorUses += row.used_evaluator ? 1 : 0;
    group.evaluatorRevisions += row.evaluator_triggered_revision ? 1 : 0;
    group.tasksCreated += row.tasks_created_count ?? 0;

    const modelKey = `${row.flow_type || row.generation_type}:${row.model || "unknown_model"}`;
    const modelSummary =
      models.get(modelKey) ??
      {
        key: modelKey,
        count: 0,
        durations: [],
        outputTokens: 0,
      };
    modelSummary.count += 1;
    if (typeof row.duration_ms === "number") modelSummary.durations.push(row.duration_ms);
    modelSummary.outputTokens += row.output_tokens ?? 0;
    models.set(modelKey, modelSummary);
  }

  console.log(`# FlowPath Generation Report`);
  console.log("");
  console.log(`Window: last ${days} days`);
  console.log(`Rows scanned: ${rows.length}`);
  console.log("");
  console.log(
    "| Flow | Count | Success | Error | Quota blocked | Safety routed | p50 | p90 | p95 | Tokens | Cached input | Est. cost | Web calls | Tasks created | Evaluator revisions |",
  );
  console.log(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const group of [...groups.values()].sort((a, b) => b.count - a.count)) {
    const totalTokens = group.totalTokens || group.inputTokens + group.outputTokens;
    console.log(
      `| ${group.key} | ${group.count} | ${group.successes} | ${group.errors} | ${group.quotaBlocked} | ${group.safetyRouted} | ${fmtMs(percentile(group.durations, 50))} | ${fmtMs(percentile(group.durations, 90))} | ${fmtMs(percentile(group.durations, 95))} | ${totalTokens} | ${group.cachedInputTokens} | ${fmtMoney(group.estimatedCostUsd)} | ${group.webSearchCalls} | ${group.tasksCreated} | ${group.evaluatorRevisions}/${group.evaluatorUses} |`,
    );
  }

  if (models.size > 0) {
    console.log("");
    console.log("## Model Operational Summary");
    console.log("| Flow:model | Count | Avg duration | Avg output tokens |");
    console.log("| --- | ---: | ---: | ---: |");
    for (const model of [...models.values()].sort((a, b) => b.count - a.count)) {
      const avgDuration =
        model.durations.length > 0
          ? model.durations.reduce((total, value) => total + value, 0) /
            model.durations.length
          : null;
      const avgOutput = model.count > 0 ? Math.round(model.outputTokens / model.count) : 0;
      console.log(`| ${model.key} | ${model.count} | ${fmtMs(avgDuration)} | ${avgOutput} |`);
    }
  }

  const errorCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "error") continue;
    const key = `${row.error_category || "unknown"}: ${row.error_message_sanitized || "no sanitized message"}`;
    errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
  }

  if (errorCounts.size > 0) {
    console.log("");
    console.log("## Sanitized Errors");
    for (const [key, count] of [...errorCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- ${count}x ${key}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
