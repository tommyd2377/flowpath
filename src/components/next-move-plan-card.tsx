"use client";

import { CheckSquare, Clock, ShieldAlert, Target } from "lucide-react";
import type { ReactNode } from "react";

import type { StoredNextMovePlan } from "@/lib/types";
import { Button, Card, EmptyState } from "./ui";

export function modeLabel(mode: string) {
  return mode.replace("_", "/");
}

export function NextMovePlanCard({
  plan,
  onConvert,
  converting,
}: {
  plan: StoredNextMovePlan | null;
  onConvert?: () => void;
  converting?: boolean;
}) {
  if (!plan) {
    return (
      <Card>
        <EmptyState>
          No next move plan yet. Complete a few intake answers or generate a plan now.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
            Next best move
          </div>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {plan.highest_leverage_move_today.title}
          </h2>
          <p className="mt-2 text-slate-300">
            {plan.highest_leverage_move_today.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
            {modeLabel(plan.mode)}
          </span>
          <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
            {plan.confidence_level} confidence
          </span>
        </div>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Brief title="Current reality" value={plan.situation_summary} />
        <Brief title="Core bottleneck" value={plan.core_bottleneck} />
        <Brief title="Why this move" value={plan.why_this_move} />
        <Brief title="Likely trap" value={plan.likely_trap} />
      </div>

      <div className="grid gap-4">
        <StepGroup
          icon={<Clock className="h-4 w-4" />}
          title="First 30 minutes"
          steps={plan.first_30_minutes}
        />
        <StepGroup title="Progress in 24 hours" steps={plan.next_24_hours} />
        <StepGroup title="Progress in 7 days" steps={plan.next_7_days} />
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <ListBlock title="What not to do" items={plan.what_not_to_do} />
        <ListBlock title="Assumptions" items={plan.assumptions} />
      </div>

      <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-100">
        <div className="mb-1 flex items-center gap-2 font-medium">
          <ShieldAlert className="h-4 w-4" />
          When to get human help
        </div>
        <p>{plan.when_to_get_human_help}</p>
      </div>

      {plan.resources_to_seek.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Resources to seek</h3>
          <div className="grid gap-2">
            {plan.resources_to_seek.map((resource) => (
              <div key={resource.name} className="rounded-md bg-slate-900 p-3 text-sm">
                <div className="font-medium text-white">{resource.name}</div>
                <p className="text-slate-300">{resource.why}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {onConvert ? (
        <div>
          <Button type="button" onClick={onConvert} disabled={converting}>
            <CheckSquare className="h-4 w-4" />
            {converting ? "Creating tasks..." : "Turn this plan into tasks"}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function Brief({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3">
      <div className="font-medium text-white">{title}</div>
      <p className="mt-1 text-slate-300">{value}</p>
    </div>
  );
}

function StepGroup({
  title,
  steps,
  icon,
}: {
  title: string;
  steps: Array<{ title: string; details: string }>;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <h3 className="mb-3 flex items-center gap-2 font-semibold text-white">
        {icon ?? <Target className="h-4 w-4" />}
        {title}
      </h3>
      <div className="grid gap-2">
        {steps.map((step) => (
          <div key={`${title}-${step.title}`} className="text-sm">
            <div className="font-medium text-slate-100">{step.title}</div>
            <p className="text-slate-300">{step.details}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3">
      <div className="font-medium text-white">{title}</div>
      <ul className="mt-2 grid gap-1 text-slate-300">
        {items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>None listed.</li>}
      </ul>
    </div>
  );
}
