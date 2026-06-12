"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CheckSquare,
  Compass,
  HelpCircle,
  MapPinned,
  Play,
  Plus,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type { Situation, StoredNextMovePlan, Task } from "@/lib/types";
import { Button, Card, EmptyState, Notice, PageHeader } from "./ui";

const activeTaskStatuses = new Set<Task["status"]>([
  "in_progress",
  "open",
  "blocked",
]);

function isActiveTask(task: Task) {
  return activeTaskStatuses.has(task.status);
}

function isActionableTask(task: Task) {
  return task.status === "in_progress" || task.status === "open";
}

function taskUpdateInput(task: Task, status: Task["status"]) {
  return {
    title: task.title,
    life_area_id: task.life_area_id,
    project_id: task.project_id,
    status,
    importance: task.importance,
    effort: task.effort,
    friction_type: task.friction_type ?? "none",
    friction_note: task.friction_note ?? "",
    estimated_minutes: task.estimated_minutes ?? null,
    due_date: task.due_date,
    notes: task.notes,
  };
}

export function TodayDashboard() {
  const [latestPlan, setLatestPlan] = useState<StoredNextMovePlan | null>(null);
  const [activeSituations, setActiveSituations] = useState<Situation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningTaskId, setActioningTaskId] = useState<number | null>(null);
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

  async function startTask(task: Task) {
    setActioningTaskId(task.id);
    setError(null);
    try {
      await apiFetch<Task>(`/api/tasks/${task.id}`, {
        method: "PUT",
        body: JSON.stringify(taskUpdateInput(task, "in_progress")),
      });
      await load();
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "Could not start task.",
      );
    } finally {
      setActioningTaskId(null);
    }
  }

  const activeTasks = tasks.filter(isActiveTask);
  const actionableTasks = activeTasks.filter(isActionableTask);
  const topTask = actionableTasks[0] ?? activeTasks[0] ?? null;
  const isEmpty =
    !loading &&
    !latestPlan &&
    activeSituations.length === 0 &&
    activeTasks.length === 0;

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Today" title="Your next move">
          <p>One clear action, then the context only when you need it.</p>
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
                FlowPath will guide intake, generate a plan, and turn it into the
                next concrete task.
              </p>
            </div>
            <NewSituationLink />
          </div>
        </Card>
      ) : null}

      <Card className="mb-5 border-[rgba(0,120,212,0.48)] bg-[rgba(0,120,212,0.08)]">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-[var(--azure-light)]">
          <Play className="h-4 w-4" />
          Do this next
        </div>
        {loading ? (
          <EmptyState>Loading next move...</EmptyState>
        ) : topTask ? (
          <div className="grid gap-4">
            <div>
              <h2 className="text-3xl font-semibold text-white">{topTask.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                {topTask.rank_reason || "Best balance of urgency, importance, and effort."}
                {topTask.situation_title ? ` From ${topTask.situation_title}.` : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-200">
              <Badge>importance {topTask.importance}/5</Badge>
              <Badge>effort {topTask.effort}/5</Badge>
              {topTask.estimated_minutes ? (
                <Badge>{topTask.estimated_minutes} min</Badge>
              ) : null}
              {topTask.status === "in_progress" ? <Badge>in progress</Badge> : null}
              {topTask.status === "blocked" ? <Badge>blocked</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => startTask(topTask)}
                disabled={actioningTaskId === topTask.id}
              >
                <Play className="h-4 w-4" />
                {topTask.status === "in_progress"
                  ? "Keep Going"
                  : actioningTaskId === topTask.id
                    ? "Starting..."
                    : "Start Task"}
              </Button>
              <Link href="/tasks">
                <Button type="button" variant="secondary">
                  <CheckSquare className="h-4 w-4" />
                  Task Queue
                </Button>
              </Link>
              <details className="group">
                <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:border-[var(--azure)]">
                  <HelpCircle className="h-4 w-4" />
                  Why This?
                </summary>
                <div className="mt-3 max-w-3xl rounded-md border border-slate-800 bg-slate-950 p-3 text-sm text-slate-300">
                  {topTask.rank_reason || "This task is ranked from importance, urgency, effort, and current context."}
                </div>
              </details>
            </div>
          </div>
        ) : latestPlan ? (
          <div className="grid gap-4">
            <div>
              <h2 className="text-3xl font-semibold text-white">
                {latestPlan.highest_leverage_move_today.title}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-300">
                {latestPlan.why_this_move}
              </p>
            </div>
            <Link href={`/situations/${latestPlan.situation_id ?? ""}`}>
              <Button type="button">
                <ArrowRight className="h-4 w-4" />
                Open Situation
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            <EmptyState>
              Not enough context yet. Start with one situation and FlowPath will
              recommend a practical next move.
            </EmptyState>
            <NewSituationLink />
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <ActiveSituationsCard situations={activeSituations} loading={loading} />
        <TaskQueueCard tasks={activeTasks.slice(0, 5)} loading={loading} />
      </div>
    </div>
  );
}

function NewSituationLink() {
  return (
    <Link href="/next-move">
      <Button type="button">
        <Plus className="h-4 w-4" />
        New Situation
      </Button>
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
          <h2 className="text-xl font-semibold">Active Situations</h2>
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
          {situations.slice(0, 5).map((situation) => (
            <Link
              key={situation.id}
              href={`/situations/${situation.id}`}
              className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm transition hover:border-[var(--azure)]"
            >
              <div className="font-medium text-white">{situation.title}</div>
              <div className="text-slate-400">
                {situation.status} · {situation.urgency} urgency
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function TaskQueueCard({
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
          <h2 className="text-xl font-semibold">Task Queue</h2>
        </div>
        <Link href="/tasks" className="text-sm font-medium text-[var(--azure-light)]">
          View queue
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <EmptyState>
          No active tasks yet. Generate a plan and FlowPath will turn it into
          ranked next actions.
        </EmptyState>
      ) : (
        <div className="grid gap-2">
          {tasks.map((task, index) => (
            <Link
              key={task.id}
              href="/tasks"
              className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm transition hover:border-[var(--azure)]"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--azure)] text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-white">{task.title}</div>
                  <div className="text-slate-400">
                    importance {task.importance}/5 · effort {task.effort}/5
                    {task.situation_title ? ` · ${task.situation_title}` : ""}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200">
      {children}
    </span>
  );
}
