"use client";

import { useEffect, useState } from "react";
import { Archive, Sparkles } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { StoredNextMovePlan } from "@/lib/types";
import { Card, EmptyState, Notice, PageHeader } from "./ui";
import { FlowPathMarkdown } from "./flowpath-markdown";
import { modeLabel } from "./next-move-plan-card";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function HistoryView() {
  const [plans, setPlans] = useState<StoredNextMovePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<StoredNextMovePlan[]>("/api/next-move-plans?limit=60")
      .then(setPlans)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Could not load history."),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader eyebrow="History" title="Previous Founder Next Move plans">
        <p>
          Review startup bottlenecks FlowPath has turned into ranked next moves.
        </p>
      </PageHeader>

      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {loading ? (
        <Card>
          <div className="text-sm text-slate-400">Loading history...</div>
        </Card>
      ) : plans.length === 0 ? (
        <EmptyState>No Founder Next Move plans yet.</EmptyState>
      ) : (
        <div className="grid gap-3">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      <Archive className="h-3.5 w-3.5" />
                      {formatDate(plan.created_at)}
                    </span>
                    <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
                      {modeLabel(plan.mode)}
                    </span>
                    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {plan.confidence_level} confidence
                    </span>
                  </div>
                  <h2 className="text-xl font-semibold text-white">
                    {plan.highest_leverage_move_today.title}
                  </h2>
                  <FlowPathMarkdown
                    content={plan.situation_summary}
                    mode="static"
                    variant="compact"
                    className="mt-2"
                  />
                </div>
                <Sparkles className="hidden h-5 w-5 shrink-0 text-[var(--azure-light)] sm:block" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
