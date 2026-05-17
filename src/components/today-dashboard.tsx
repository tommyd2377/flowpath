"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckSquare, Compass, MapPinned, Sparkles } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { Situation, StoredNextMovePlan, Task } from "@/lib/types";
import { Card, EmptyState, Notice, PageHeader } from "./ui";
import { modeLabel } from "./next-move-plan-card";

export function TodayDashboard() {
  const [latestPlan, setLatestPlan] = useState<StoredNextMovePlan | null>(null);
  const [activeSituations, setActiveSituations] = useState<Situation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [planData, situationData, taskData] = await Promise.all([
        apiFetch<StoredNextMovePlan[]>("/api/next-move-plans?limit=1"),
        apiFetch<Situation[]>("/api/situations?status=active"),
        apiFetch<Task[]>("/api/tasks"),
      ]);
      setLatestPlan(planData[0] ?? null);
      setActiveSituations(situationData);
      setTasks(taskData);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load FlowPath.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);

  const openTasks = tasks.filter((task) => task.status === "open");
  const topTask = openTasks[0] ?? null;
  const topSituation = activeSituations.find((situation) => situation.latest_plan_move);
  const isEmpty = !loading && !latestPlan && activeSituations.length === 0 && openTasks.length === 0;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Today" title="Your next move">
          <p>
            FlowPath uses your situations, tasks, and saved context to recommend what
            matters now.
          </p>
        </PageHeader>
        <Image
          src="/brand/flowpath-logo-full.png"
          alt="FlowPath"
          width={144}
          height={144}
          priority
          unoptimized
          className="hidden h-36 w-36 shrink-0 rounded-lg object-contain sm:block"
          sizes="144px"
        />
      </div>

      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      {isEmpty ? (
        <Card className="mb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium uppercase text-[var(--azure-light)]">
                <Compass className="h-4 w-4" />
                Start here
              </div>
              <h2 className="text-2xl font-semibold text-white">
                Bring one messy situation.
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-slate-300">
                Answer a few focused questions. FlowPath will turn the signal into a
                practical plan and ranked next actions.
              </p>
            </div>
            <PrimaryNextMoveLink />
          </div>
        </Card>
      ) : null}

      <div className="mb-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <div className="mb-2 text-sm font-medium uppercase text-[var(--azure-light)]">
            Top recommended action
          </div>
          {loading ? (
            <EmptyState>Loading recommendation...</EmptyState>
          ) : topTask ? (
            <div>
              <h2 className="text-2xl font-semibold">{topTask.title}</h2>
              <p className="mt-2 text-sm text-slate-400">
                {topTask.rank_reason}
                {topTask.situation_title ? ` From ${topTask.situation_title}.` : ""}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-md bg-slate-800 px-2 py-1">
                  importance {topTask.importance}/5
                </span>
                <span className="rounded-md bg-slate-800 px-2 py-1">
                  effort {topTask.effort}/5
                </span>
                {topTask.due_date ? (
                  <span className="rounded-md bg-slate-800 px-2 py-1">
                    due {topTask.due_date}
                  </span>
                ) : null}
              </div>
            </div>
          ) : latestPlan ? (
            <div>
              <h2 className="text-2xl font-semibold">
                {latestPlan.highest_leverage_move_today.title}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {latestPlan.why_this_move}
              </p>
            </div>
          ) : topSituation ? (
            <div>
              <h2 className="text-2xl font-semibold">
                {topSituation.latest_plan_move}
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                From {topSituation.title}.
              </p>
            </div>
          ) : (
            <EmptyState>
              Not enough context yet. Start with one situation and FlowPath will
              recommend a practical next move.
            </EmptyState>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <PrimaryNextMoveLink />
            <Link
              href="/tasks"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:border-[var(--azure)]"
            >
              View ranked tasks
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Card>

        <ActiveSituationsCard situations={activeSituations} loading={loading} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <RankedTasksCard tasks={openTasks} loading={loading} />
        <RecentPlanCard plan={latestPlan} loading={loading} />
      </div>
    </div>
  );
}

function PrimaryNextMoveLink() {
  return (
    <Link
      href="/next-move"
      className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[var(--azure)] px-3 text-sm font-medium text-white"
    >
      Find My Next Move
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function ActiveSituationsCard({
  situations,
  loading,
}: {
  situations: Situation[];
  loading: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPinned className="h-4 w-4 text-[var(--azure-light)]" />
          <h2 className="text-xl font-semibold">Active situations</h2>
        </div>
        <Link href="/situations" className="text-sm font-medium text-[var(--azure-light)]">
          View all
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading situations...</div>
      ) : situations.length === 0 ? (
        <EmptyState>No active situations yet.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {situations.slice(0, 4).map((situation) => (
            <Link
              key={situation.id}
              href={`/situations/${situation.id}`}
              className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm transition hover:border-[var(--azure)]"
            >
              <div className="font-medium text-white">{situation.title}</div>
              <div className="text-slate-400">
                {situation.category} · {situation.urgency}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function RankedTasksCard({
  tasks,
  loading,
}: {
  tasks: Task[];
  loading: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-[var(--azure-light)]" />
          <h2 className="text-xl font-semibold">Ranked next tasks</h2>
        </div>
        <Link href="/tasks" className="text-sm font-medium text-[var(--azure-light)]">
          View queue
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <EmptyState>
          No tasks yet. Start with a situation and FlowPath will turn the plan into
          ranked next actions.
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {tasks.slice(0, 5).map((task, index) => (
            <div
              key={task.id}
              className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--azure)] text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <div>
                  <div className="font-medium text-white">{task.title}</div>
                  <div className="text-slate-400">
                    {task.rank_reason}
                    {task.situation_title ? ` · ${task.situation_title}` : ""}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentPlanCard({
  plan,
  loading,
}: {
  plan: StoredNextMovePlan | null;
  loading: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--azure-light)]" />
        <h2 className="text-xl font-semibold">Recent Next Move plan</h2>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading plan...</div>
      ) : !plan ? (
        <EmptyState>No Next Move plan yet.</EmptyState>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
              {modeLabel(plan.mode)}
            </span>
            <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
              {plan.confidence_level} confidence
            </span>
          </div>
          <h3 className="text-lg font-semibold">
            {plan.highest_leverage_move_today.title}
          </h3>
          <p className="mt-2 text-sm text-slate-300">
            {plan.highest_leverage_move_today.description}
          </p>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
            <Brief title="Naive path" value={plan.operator_insight.naive_path} />
            <Brief title="Operator path" value={plan.operator_insight.operator_path} />
            <Brief
              title="Avoid"
              value={plan.operator_insight.wasted_motion_to_avoid}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function Brief({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
      <div className="font-medium text-white">{title}</div>
      <p className="mt-1 text-slate-300">{value}</p>
    </div>
  );
}
