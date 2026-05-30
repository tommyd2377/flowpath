"use client";

import { useEffect, useState } from "react";
import { Activity, BarChart3, CheckCircle2, ThumbsDown } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { OutcomeHarnessDashboardSummary } from "@/lib/types";
import { Card, EmptyState, Notice, PageHeader } from "./ui";

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function score(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

export function OutcomeHarnessDashboard() {
  const [summary, setSummary] = useState<OutcomeHarnessDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<OutcomeHarnessDashboardSummary>("/api/debug/outcome-harness")
      .then(setSummary)
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load outcome harness.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="Debug" title="Outcome harness">
        <p>
          Product QA signals for suggested actions, task follow-through, intake
          usefulness, and intervention effectiveness.
        </p>
      </PageHeader>

      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading outcome signals...</div>
        </Card>
      ) : !summary ? (
        <EmptyState>No outcome harness data available.</EmptyState>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric title="Shown" value={summary.totals.suggestedActionsShown} />
            <Metric title="Accept" value={percent(summary.rates.acceptRate)} />
            <Metric title="Edit" value={percent(summary.rates.editRate)} />
            <Metric title="Complete" value={percent(summary.rates.completionRate)} />
            <Metric title="Dismiss" value={percent(summary.rates.dismissRate)} />
            <Metric title="Ignored" value={percent(summary.rates.ignoredRate)} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--azure-light)]" />
                <h2 className="text-xl font-semibold">Strongest interventions</h2>
              </div>
              <InterventionList items={summary.strongestInterventions} />
            </Card>
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <ThumbsDown className="h-4 w-4 text-amber-200" />
                <h2 className="text-xl font-semibold">Weakest interventions</h2>
              </div>
              <InterventionList items={summary.weakestInterventions} />
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <Activity className="h-4 w-4 text-[var(--azure-light)]" />
                <h2 className="text-xl font-semibold">First intake</h2>
              </div>
              <div className="grid gap-2 text-sm text-slate-300">
                <Line label="Shown" value={summary.firstIntake.shown} />
                <Line label="Answered" value={summary.firstIntake.answered} />
                <Line label="Skipped" value={summary.firstIntake.skipped} />
                <Line label="Abandoned" value={summary.firstIntake.abandoned} />
              </div>
            </Card>
            <Card>
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[var(--azure-light)]" />
                <h2 className="text-xl font-semibold">Generation QA</h2>
              </div>
              <div className="grid gap-2 text-sm text-slate-300">
                <Line label="Evaluator rewrite rate" value={percent(summary.evaluatorRewriteRate)} />
                <Line label="Escalation rate" value={percent(summary.escalationRate)} />
                <Line
                  label="Accepted avg minutes"
                  value={summary.averageEstimatedMinutes.accepted ?? "n/a"}
                />
                <Line
                  label="Dismissed avg minutes"
                  value={summary.averageEstimatedMinutes.dismissed ?? "n/a"}
                />
              </div>
            </Card>
            <Card>
              <h2 className="mb-3 text-xl font-semibold">Poor acceptance contexts</h2>
              <div className="grid gap-2 text-sm text-slate-300">
                {summary.poorAcceptanceContexts.length === 0 ? (
                  <div className="text-slate-400">No poor-acceptance clusters yet.</div>
                ) : (
                  summary.poorAcceptanceContexts.map((item) => (
                    <div key={`${item.domain}-${item.subtype}`} className="rounded-md bg-slate-900 p-2">
                      <div className="font-medium text-white">
                        {item.domain} / {item.subtype}
                      </div>
                      <div className="text-slate-400">
                        {item.accepted}/{item.shown} accepted ({percent(item.acceptRate)})
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-slate-400">{title}</div>
    </Card>
  );
}

function Line({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

function InterventionList({
  items,
}: {
  items: OutcomeHarnessDashboardSummary["strongestInterventions"];
}) {
  if (items.length === 0) {
    return <div className="text-sm text-slate-400">No intervention signals yet.</div>;
  }

  return (
    <div className="grid gap-2 text-sm">
      {items.map((item) => (
        <div
          key={`${item.domain}-${item.subtype}-${item.intervention_type}`}
          className="rounded-md bg-slate-900 p-3"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-white">
              {item.intervention_type.replaceAll("_", " ")}
            </div>
            <div className="text-[var(--azure-light)]">{score(item.effectiveness_score)}</div>
          </div>
          <div className="mt-1 text-slate-400">
            {item.domain} / {item.subtype} · shown {item.shown_count} · accepted{" "}
            {item.accepted_count} · completed {item.completed_count}
          </div>
        </div>
      ))}
    </div>
  );
}
