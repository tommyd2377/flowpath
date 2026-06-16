"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  CheckSquare,
  Compass,
  MapPinned,
  Play,
  Plus,
  RefreshCw,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { recordFounderEvent } from "@/lib/founder-events";
import {
  founderCategoryLabel,
  founderExampleTiles,
  founderWedgeCopy,
} from "@/lib/founder-wedge";
import type { Situation, StoredNextMovePlan, Task } from "@/lib/types";
import { FlowPathMarkdown } from "./flowpath-markdown";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SelectInput,
  TextArea,
} from "./ui";

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

type FounderOutcomeStatus = "done" | "partial" | "blocked" | "skipped";

const taskOutcomeByStatus: Partial<
  Record<FounderOutcomeStatus, "completed" | "couldnt_complete" | "no_longer_relevant">
> = {
  done: "completed",
  blocked: "couldnt_complete",
  skipped: "no_longer_relevant",
};

const planOutcomeByStatus = {
  done: "acted",
  partial: "needs_followup",
  blocked: "deferred",
  skipped: "rejected",
} as const;

const blockerReasons = [
  ["unclear_next_step", "unclear next step"],
  ["no_time", "no time"],
  ["fear_avoidance", "fear / avoidance"],
  ["no_user_access", "no access to users"],
  ["waiting_on_someone", "waiting on someone"],
  ["wrong_recommendation", "wrong recommendation"],
  ["other", "other"],
] as const;

export function TodayDashboard() {
  const [latestPlan, setLatestPlan] = useState<StoredNextMovePlan | null>(null);
  const [activeSituations, setActiveSituations] = useState<Situation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioningTaskId, setActioningTaskId] = useState<number | null>(null);
  const [outcomeStatus, setOutcomeStatus] = useState<FounderOutcomeStatus>("done");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [outcomeLearning, setOutcomeLearning] = useState("");
  const [outcomeChanged, setOutcomeChanged] = useState("");
  const [blockerReason, setBlockerReason] = useState("");
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeMessage, setOutcomeMessage] = useState<string | null>(null);
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
  const topTaskId = topTask?.id ?? null;
  const topTaskPlanId = topTask?.source_next_move_plan_id ?? null;
  const taskPlan =
    topTask?.source_next_move_plan_id === latestPlan?.id ? latestPlan : null;
  const topTaskCandidate =
    taskPlan?.task_candidates.find((candidate) => candidate.title === topTask?.title) ??
    null;
  const topTaskDefinitionOfDone =
    topTaskCandidate?.success_condition ||
    taskPlan?.highest_leverage_move_today.success_condition ||
    "Produce one observable outcome FlowPath can learn from.";
  const topTaskWhy =
    topTask?.rank_reason ||
    topTaskCandidate?.why_now ||
    taskPlan?.why_this_move ||
    "Best balance of leverage, urgency, effort, and current founder context.";
  const isEmpty =
    !loading &&
    !latestPlan &&
    activeSituations.length === 0 &&
    activeTasks.length === 0;

  useEffect(() => {
    if (!loading && topTaskId) {
      recordFounderEvent("founder_top_move_viewed", {
        taskId: topTaskId,
        planId: topTaskPlanId,
      });
    }
  }, [loading, topTaskId, topTaskPlanId]);

  function openOutcomeForm(status: FounderOutcomeStatus) {
    setOutcomeStatus(status);
    setOutcomeOpen(true);
    setOutcomeMessage(null);
    setError(null);
  }

  function resetOutcomeForm() {
    setOutcomeNotes("");
    setOutcomeLearning("");
    setOutcomeChanged("");
    setBlockerReason("");
    setOutcomeStatus("done");
    setOutcomeOpen(false);
  }

  function outcomeEvidence() {
    return [
      outcomeNotes.trim() ? `What happened: ${outcomeNotes.trim()}` : "",
      outcomeLearning.trim() ? `What I learned: ${outcomeLearning.trim()}` : "",
      outcomeChanged.trim() ? `What changed: ${outcomeChanged.trim()}` : "",
      blockerReason ? `Blocker reason: ${blockerReason.replaceAll("_", " ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function submitOutcome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const evidence = outcomeEvidence();
    if ((outcomeStatus === "blocked" || outcomeStatus === "partial") && !evidence) {
      setError("Add one line about what happened so FlowPath can replan from reality.");
      return;
    }

    const planId = topTask?.source_next_move_plan_id ?? latestPlan?.id ?? null;
    setActioningTaskId(topTask?.id ?? -1);
    setError(null);
    setOutcomeMessage(null);

    try {
      const taskOutcome = taskOutcomeByStatus[outcomeStatus];
      if (topTask && taskOutcome) {
        await apiFetch<Task>(`/api/tasks/${topTask.id}/feedback`, {
          method: "POST",
          body: JSON.stringify({ outcome: taskOutcome, notes: evidence }),
        });
      }

      if (planId) {
        await apiFetch(`/api/next-move-plans/${planId}/outcome`, {
          method: "POST",
          body: JSON.stringify({
            user_outcome: planOutcomeByStatus[outcomeStatus],
            evidence,
            notes: evidence || "Founder outcome reported from Today.",
          }),
        });
      }

      recordFounderEvent("founder_task_outcome_submitted", {
        taskId: topTask?.id ?? null,
        planId,
        status: outcomeStatus,
      });
      if (outcomeStatus === "done") {
        recordFounderEvent("founder_task_completed", {
          taskId: topTask?.id ?? null,
          planId,
        });
      }
      if (outcomeStatus === "blocked") {
        recordFounderEvent("founder_task_blocked", {
          taskId: topTask?.id ?? null,
          planId,
        });
      }
      if (outcomeStatus === "skipped") {
        recordFounderEvent("founder_task_skipped", {
          taskId: topTask?.id ?? null,
          planId,
        });
      }

      resetOutcomeForm();
      setOutcomeMessage("Outcome saved. Replan from this outcome when you are ready.");
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not save outcome.",
      );
    } finally {
      setActioningTaskId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader eyebrow="Today" title={founderWedgeCopy.todayTitle}>
          <p>{founderWedgeCopy.todaySubheader}</p>
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
      {outcomeMessage ? (
        <div className="mb-4">
          <Notice tone="success">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{outcomeMessage}</span>
              <ReplanLink task={topTask} plan={latestPlan} />
            </div>
          </Notice>
        </div>
      ) : null}

      {isEmpty ? (
        <Card className="mb-5">
          <div className="grid gap-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 text-sm font-medium uppercase text-[var(--azure-light)]">
                  <Compass className="h-4 w-4" />
                  Start here
                </div>
                <h2 className="text-2xl font-semibold text-white">
                  {founderWedgeCopy.todayTitle}
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-300">
                  {founderWedgeCopy.todaySubheader}
                </p>
                <p className="mt-2 text-sm font-medium text-blue-100">
                  {founderWedgeCopy.secondaryLine}
                </p>
              </div>
              <NewSituationLink />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {founderExampleTiles.map((example) => (
                <Link
                  key={example}
                  href="/next-move"
                  className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm text-slate-200 transition hover:border-[var(--azure)] hover:text-white"
                >
                  {example}
                </Link>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <Card className="mb-5 border-[rgba(0,120,212,0.48)] bg-[rgba(0,120,212,0.08)]">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-[var(--azure-light)]">
          <Play className="h-4 w-4" />
          Do this next
        </div>
        {loading ? (
          <EmptyState>Loading founder next move...</EmptyState>
        ) : topTask ? (
          <div className="grid gap-5">
            <div>
              <h2 className="text-3xl font-semibold text-white">{topTask.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-blue-100">
                Report what happened so FlowPath can choose the next move from reality.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-slate-200">
              <Badge>importance {topTask.importance}/5</Badge>
              <Badge>effort {topTask.effort}/5</Badge>
              {topTask.estimated_minutes ? (
                <Badge>{topTask.estimated_minutes} min</Badge>
              ) : null}
              {latestPlan ? <Badge>{latestPlan.confidence_level} confidence</Badge> : null}
              {topTaskCandidate?.category ? (
                <Badge>{topTaskCandidate.category.replaceAll("_", " ")}</Badge>
              ) : topTask.source_plan_section ? (
                <Badge>{topTask.source_plan_section.replaceAll("_", " ")}</Badge>
              ) : null}
              {topTask.situation_title ? <Badge>{topTask.situation_title}</Badge> : null}
              {topTask.status === "in_progress" ? <Badge>in progress</Badge> : null}
              {topTask.status === "blocked" ? <Badge>blocked</Badge> : null}
            </div>
            <div className="grid gap-3 text-sm lg:grid-cols-2">
              <Brief title="Definition of done" value={topTaskDefinitionOfDone} />
              <Brief
                title="First 10 minutes"
                value={
                  taskPlan
                    ? `${taskPlan.first_10_minute_action.title}: ${taskPlan.first_10_minute_action.details}`
                    : "Open the task, reduce it to the first visible action, and start there."
                }
              />
              <MarkdownBrief title="Why this is the highest-leverage move" value={topTaskWhy} />
              <ListBlock
                title="What not to waste time on"
                items={taskPlan?.what_not_to_do ?? ["Do not turn this into another broad plan."]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => startTask(topTask)}
                disabled={actioningTaskId === topTask.id}
                variant={topTask.status === "in_progress" ? "secondary" : "primary"}
              >
                <Play className="h-4 w-4" />
                {topTask.status === "in_progress"
                  ? "Keep Going"
                  : actioningTaskId === topTask.id
                    ? "Starting..."
                    : "Start Task"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => openOutcomeForm("done")}>
                <CheckCircle2 className="h-4 w-4" />
                I did it
              </Button>
              <Button type="button" variant="secondary" onClick={() => openOutcomeForm("blocked")}>
                <RefreshCw className="h-4 w-4" />
                I&apos;m blocked
              </Button>
              <Button type="button" variant="secondary" onClick={() => openOutcomeForm("skipped")}>
                <Ban className="h-4 w-4" />
                Skip / not relevant
              </Button>
              <ReplanLink task={topTask} plan={latestPlan} asButton />
            </div>
            {outcomeOpen ? (
              <OutcomeCaptureForm
                status={outcomeStatus}
                setStatus={setOutcomeStatus}
                notes={outcomeNotes}
                setNotes={setOutcomeNotes}
                learning={outcomeLearning}
                setLearning={setOutcomeLearning}
                changed={outcomeChanged}
                setChanged={setOutcomeChanged}
                blockerReason={blockerReason}
                setBlockerReason={setBlockerReason}
                saving={actioningTaskId !== null}
                onSubmit={submitOutcome}
                onCancel={resetOutcomeForm}
              />
            ) : null}
          </div>
        ) : latestPlan ? (
          <div className="grid gap-4">
            <div>
              <h2 className="text-3xl font-semibold text-white">
                {latestPlan.highest_leverage_move_today.title}
              </h2>
              <FlowPathMarkdown
                content={latestPlan.why_this_move}
                mode="static"
                variant="compact"
                className="mt-2 max-w-3xl"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/situations/${latestPlan.situation_id ?? ""}`}>
                <Button type="button">
                  <ArrowRight className="h-4 w-4" />
                  Open Founder Situation
                </Button>
              </Link>
              <Button type="button" variant="secondary" onClick={() => openOutcomeForm("partial")}>
                <RefreshCw className="h-4 w-4" />
                Report outcome
              </Button>
            </div>
            {outcomeOpen ? (
              <OutcomeCaptureForm
                status={outcomeStatus}
                setStatus={setOutcomeStatus}
                notes={outcomeNotes}
                setNotes={setOutcomeNotes}
                learning={outcomeLearning}
                setLearning={setOutcomeLearning}
                changed={outcomeChanged}
                setChanged={setOutcomeChanged}
                blockerReason={blockerReason}
                setBlockerReason={setBlockerReason}
                saving={actioningTaskId !== null}
                onSubmit={submitOutcome}
                onCancel={resetOutcomeForm}
              />
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4">
            <EmptyState>
              Start with one startup bottleneck and FlowPath will recommend a
              practical founder next move.
            </EmptyState>
            <NewSituationLink />
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <ActiveSituationsCard situations={activeSituations} loading={loading} />
        <TaskQueueCard tasks={activeTasks.slice(0, 5)} loading={loading} />
        <RecentOperatingLogCard plan={latestPlan} tasks={activeTasks} loading={loading} />
        <FounderContextCard plan={latestPlan} loading={loading} />
      </div>
    </div>
  );
}

function NewSituationLink() {
  return (
    <Link href="/next-move">
      <Button type="button">
        <Plus className="h-4 w-4" />
        {founderWedgeCopy.primaryCta}
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
          <h2 className="text-xl font-semibold">Active Startup Situations</h2>
        </div>
        <Link href="/situations" className="text-sm font-medium text-[var(--azure-light)]">
          View all
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading situations...</div>
      ) : situations.length === 0 ? (
        <EmptyState>No active startup situations yet.</EmptyState>
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
                {founderCategoryLabel(situation.category)} · {situation.status} ·{" "}
                {situation.urgency} urgency
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
          <h2 className="text-xl font-semibold">Ranked Startup Tasks</h2>
        </div>
        <Link href="/tasks" className="text-sm font-medium text-[var(--azure-light)]">
          View ranked startup tasks
        </Link>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <EmptyState>
          No active startup tasks yet. Generate a founder plan and FlowPath will
          turn it into ranked next moves.
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

function ReplanLink({
  task,
  plan,
  asButton = false,
}: {
  task: Task | null;
  plan: StoredNextMovePlan | null;
  asButton?: boolean;
}) {
  const situationId = task?.situation_id ?? plan?.situation_id ?? null;
  const href = situationId ? `/next-move?situationId=${situationId}` : "/next-move";
  const onClick = () =>
    recordFounderEvent("founder_replan_requested", {
      taskId: task?.id ?? null,
      planId: task?.source_next_move_plan_id ?? plan?.id ?? null,
    });

  if (asButton) {
    return (
      <Link href={href} onClick={onClick}>
        <Button type="button" variant="secondary">
          <RefreshCw className="h-4 w-4" />
          Replan
        </Button>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className="font-medium text-blue-100 underline underline-offset-4 hover:text-white"
    >
      Replan from this outcome
    </Link>
  );
}

function OutcomeCaptureForm({
  status,
  setStatus,
  notes,
  setNotes,
  learning,
  setLearning,
  changed,
  setChanged,
  blockerReason,
  setBlockerReason,
  saving,
  onSubmit,
  onCancel,
}: {
  status: FounderOutcomeStatus;
  setStatus: (status: FounderOutcomeStatus) => void;
  notes: string;
  setNotes: (value: string) => void;
  learning: string;
  setLearning: (value: string) => void;
  changed: string;
  setChanged: (value: string) => void;
  blockerReason: string;
  setBlockerReason: (value: string) => void;
  saving: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="grid gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4"
      onSubmit={onSubmit}
    >
      <div>
        <div className="text-sm font-semibold text-white">Report what happened</div>
        <p className="mt-1 text-sm text-slate-400">
          FlowPath uses this reality signal to choose the next founder move.
        </p>
      </div>
      <Field label="Status">
        <SelectInput
          value={status}
          onChange={(event) => setStatus(event.target.value as FounderOutcomeStatus)}
        >
          <option value="done">Done</option>
          <option value="partial">Partially done</option>
          <option value="blocked">Blocked</option>
          <option value="skipped">Skipped / not relevant</option>
        </SelectInput>
      </Field>
      <div className="grid gap-4 lg:grid-cols-3">
        <Field label="What happened?">
          <TextArea
            value={notes}
            maxLength={1200}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Example: I sent 8 messages and got 2 replies."
          />
        </Field>
        <Field label="What did you learn?">
          <TextArea
            value={learning}
            maxLength={1200}
            onChange={(event) => setLearning(event.target.value)}
            placeholder="Example: founders in my network are not the buyer."
          />
        </Field>
        <Field label="What changed?">
          <TextArea
            value={changed}
            maxLength={1200}
            onChange={(event) => setChanged(event.target.value)}
            placeholder="Example: I now need a narrower first-user wedge."
          />
        </Field>
      </div>
      {status === "blocked" ? (
        <Field label="Blocker reason">
          <SelectInput
            value={blockerReason}
            onChange={(event) => setBlockerReason(event.target.value)}
          >
            <option value="">Choose a blocker</option>
            {blockerReasons.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          <CheckCircle2 className="h-4 w-4" />
          {saving ? "Saving outcome..." : "Save outcome"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
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

function MarkdownBrief({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3">
      <div className="font-medium text-white">{title}</div>
      <FlowPathMarkdown
        content={value}
        mode="static"
        variant="compact"
        className="mt-1"
      />
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

function RecentOperatingLogCard({
  plan,
  tasks,
  loading,
}: {
  plan: StoredNextMovePlan | null;
  tasks: Task[];
  loading: boolean;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <RefreshCw className="h-4 w-4 text-[var(--azure-light)]" />
        <h2 className="text-xl font-semibold">Recent Operating Log</h2>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading operating log...</div>
      ) : plan ? (
        <div className="grid gap-3 text-sm text-slate-300">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="font-medium text-white">Latest plan</div>
            <p className="mt-1">
              {plan.highest_leverage_move_today.title} · {plan.confidence_level} confidence
            </p>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="font-medium text-white">Open loop</div>
            <p className="mt-1">
              {tasks.length > 0
                ? `${tasks.length} active founder move${tasks.length === 1 ? "" : "s"} waiting for reality feedback.`
                : "No active founder moves are waiting right now."}
            </p>
          </div>
        </div>
      ) : (
        <EmptyState>No outcome history yet.</EmptyState>
      )}
    </Card>
  );
}

function FounderContextCard({
  plan,
  loading,
}: {
  plan: StoredNextMovePlan | null;
  loading: boolean;
}) {
  const contextItems = plan?.context_used.slice(0, 4) ?? [];

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Compass className="h-4 w-4 text-[var(--azure-light)]" />
        <h2 className="text-xl font-semibold">Founder Context</h2>
      </div>
      {loading ? (
        <div className="text-sm text-slate-400">Loading founder context...</div>
      ) : contextItems.length > 0 ? (
        <div className="grid gap-2">
          {contextItems.map((item) => (
            <div
              key={`${item.label}-${item.value}`}
              className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm"
            >
              <div className="font-medium text-white">{item.label}</div>
              <p className="mt-1 text-slate-400">{item.value}</p>
            </div>
          ))}
          <Link href="/memory" className="text-sm font-medium text-[var(--azure-light)]">
            Review Founder Memory
          </Link>
        </div>
      ) : (
        <EmptyState>
          Founder context will appear after FlowPath has intake or memory signal to use.
        </EmptyState>
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
