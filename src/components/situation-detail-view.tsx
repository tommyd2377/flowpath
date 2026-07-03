"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  History,
  Info,
  MessageSquare,
  Sparkles,
  Trash2,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import { entryDomainTitle } from "@/lib/entry-domains";
import { INTAKE_ANSWER_MAX } from "@/lib/schemas";
import type {
  IntakeMessage,
  IntakeSession,
  PlanGenerationResponse,
  Situation,
  StoredNextMovePlan,
  Task,
  TaskConversionResponse,
} from "@/lib/types";
import {
  GenerationStatus,
  nextMoveGenerationStages,
} from "./generation-status";
import { BoardSnapshot, modeLabel } from "./next-move-plan-card";
import { Button, Card, CharacterCount, EmptyState, Notice, PageHeader, TextArea } from "./ui";

type SituationDetail = {
  situation: Situation;
  session: IntakeSession;
  messages: IntakeMessage[];
  latestPlan: StoredNextMovePlan | null;
  plans: StoredNextMovePlan[];
  tasks: Task[];
};

export function SituationDetailView({ situationId }: { situationId: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<SituationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [taskConfirmation, setTaskConfirmation] =
    useState<TaskConversionResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [boardUpdate, setBoardUpdate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiFetch<SituationDetail>(`/api/situations/${situationId}`));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load board.",
      );
    } finally {
      setLoading(false);
    }
  }, [situationId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function updateStatus(nextStatus: Situation["status"]) {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await apiFetch<SituationDetail>(
        `/api/situations/${detail.situation.id}`,
        {
          method: "PUT",
          body: JSON.stringify({ ...detail.situation, status: nextStatus }),
        },
      );
      setDetail(updated);
      setMessage(`Board marked ${statusLabel(nextStatus)}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not update board.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function generatePlan() {
    if (!detail) return;
    setGenerating(true);
    setError(null);
    setMessage(null);
    setTaskConfirmation(null);
    try {
      const generated = await apiFetch<PlanGenerationResponse>(
        `/api/situations/${detail.situation.id}/generate-plan`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setTaskConfirmation(generated.taskConversion ?? null);
      await load();
      setMessage(planGenerationMessage(generated.taskConversion));
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not recalculate board.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function convertPlan() {
    if (!detail?.latestPlan) return;
    setConverting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<TaskConversionResponse>(`/api/next-move-plans/${detail.latestPlan.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setTaskConfirmation(result);
      await load();
      setMessage(
        result.alreadyExisted
          ? "These tasks were already added. No duplicates created."
          : `Added ${result.items.length} ranked tasks.`,
      );
    } catch (convertError) {
      setError(
        convertError instanceof Error ? convertError.message : "Could not create tasks.",
      );
    } finally {
      setConverting(false);
    }
  }

  async function deletePermanently() {
    if (!detail) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setMessage(null);
      setError(null);
      return;
    }

    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/situations/${detail.situation.id}`, {
        method: "DELETE",
      });
      setConfirmingDelete(false);
      router.replace("/situations");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete board.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !detail) {
    return (
      <Card>
        <div className="text-sm text-slate-400">Loading board...</div>
      </Card>
    );
  }

  if (!detail) {
    return <Notice tone="error">{error || "Board not found."}</Notice>;
  }

  const latestPlanHasTasks = Boolean(
    detail.latestPlan &&
      detail.tasks.some(
        (task) => task.source_next_move_plan_id === detail.latestPlan?.id,
      ),
  );
  const latestPlanTasks = detail.latestPlan
    ? detail.tasks.filter(
        (task) =>
          task.source_next_move_plan_id === detail.latestPlan?.id &&
          isPrimaryTask(task),
      )
    : [];
  const primaryTask =
    latestPlanTasks[0] ??
    detail.tasks.find(isPrimaryTask) ??
    detail.tasks[0] ??
    null;

  async function submitBoardUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const trimmed = boardUpdate.trim();
    if (!trimmed) {
      setError("Tell FlowPath what changed on this board.");
      return;
    }
    setSaving(true);
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/situations/${detail.situation.id}/board-update`, {
        method: "POST",
        body: JSON.stringify({
          content: trimmed,
          client_message_id: `board-update-${Date.now()}`,
        }),
      });
      setBoardUpdate("");
      const generated = await apiFetch<PlanGenerationResponse>(
        `/api/situations/${detail.situation.id}/generate-plan`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setTaskConfirmation(generated.taskConversion ?? null);
      await load();
      setMessage("Board updated and recalculated.");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update this board.",
      );
    } finally {
      setSaving(false);
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Board" title={detail.situation.title}>
        <p>
          {entryDomainTitle(detail.situation.category)} ·{" "}
          {statusLabel(detail.situation.status)} · {detail.situation.urgency} urgency
          {detail.latestPlan ? ` · ${modeLabel(detail.latestPlan.mode)} mode` : ""}
        </p>
        {detail.situation.description &&
        detail.situation.description !== detail.situation.title ? (
          <p>{detail.situation.description}</p>
        ) : null}
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="mb-5 flex flex-wrap gap-2">
        <Button type="button" onClick={generatePlan} disabled={generating || deleting}>
          <Sparkles className="h-4 w-4" />
          {generating
            ? "Recalculating..."
            : detail.latestPlan
              ? "Recalculate board"
              : "Generate best move"}
        </Button>
        {detail.latestPlan && !latestPlanHasTasks ? (
          <Button
            type="button"
            variant="secondary"
            onClick={convertPlan}
            disabled={converting || deleting}
          >
            <CheckSquare className="h-4 w-4" />
            {converting ? "Creating tasks..." : "Turn this plan into tasks"}
          </Button>
        ) : null}
        {detail.situation.status === "active" ? (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => updateStatus("resolved")}
              disabled={saving || deleting}
            >
              <CheckCircle2 className="h-4 w-4" />
              Resolve
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => updateStatus("archived")}
              disabled={saving || deleting}
            >
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          </>
        ) : null}
        <Link href={`/next-move?situationId=${detail.situation.id}`}>
          <Button type="button" variant="ghost">Continue intake</Button>
        </Link>
        <Button
          type="button"
          variant="danger"
          onClick={deletePermanently}
          disabled={deleting}
        >
          <Trash2 className="h-4 w-4" />
          {deleting
            ? "Deleting..."
            : confirmingDelete
              ? "Confirm delete"
              : "Delete permanently"}
        </Button>
        {confirmingDelete ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirmingDelete(false)}
            disabled={deleting}
          >
            Cancel delete
          </Button>
        ) : null}
      </div>
      {generating ? (
        <div className="mb-5">
          <GenerationStatus stages={nextMoveGenerationStages} />
        </div>
      ) : null}

      <div className="grid gap-5">
        <Card>
          <form className="grid gap-3" onSubmit={submitBoardUpdate}>
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[var(--azure-light)]" />
              <h2 className="text-xl font-semibold">
                Tell FlowPath what changed
              </h2>
            </div>
            <TextArea
              value={boardUpdate}
              maxLength={INTAKE_ANSWER_MAX}
              onChange={(event) => setBoardUpdate(event.target.value)}
              placeholder="Actually, I care more about meeting people. I can only do weekends. I already tried this and it didn’t work. Cash is more urgent now."
              className="min-h-24"
            />
            <CharacterCount value={boardUpdate} max={INTAKE_ANSWER_MAX} />
            <div>
              <Button type="submit" disabled={saving || generating || !boardUpdate.trim()}>
                <Sparkles className="h-4 w-4" />
                {saving || generating ? "Updating..." : "Update board and recalculate"}
              </Button>
            </div>
          </form>
        </Card>

        {detail.latestPlan ? (
          <BoardSnapshot plan={detail.latestPlan} situation={detail.situation} />
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
          <RecommendedMoveCard
            plan={detail.latestPlan}
            primaryTask={primaryTask}
          />
          <SituationTaskQueue tasks={detail.tasks} />
        </div>

        {converting ? (
          <GenerationStatus stages={nextMoveGenerationStages} />
        ) : null}
        {taskConfirmation ? <TaskConfirmation result={taskConfirmation} /> : null}

        <CollapsibleSection title="Plan" icon={<ClipboardList className="h-4 w-4" />}>
          <PlanSection
            plan={detail.latestPlan}
            tasksAdded={latestPlanHasTasks}
            converting={converting}
            onConvert={detail.latestPlan ? convertPlan : undefined}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Operator Analysis" icon={<Info className="h-4 w-4" />}>
          <OperatorAnalysisSection plan={detail.latestPlan} />
        </CollapsibleSection>

        <CollapsibleSection title="Context Used" icon={<Info className="h-4 w-4" />}>
          <ContextUsedSection plan={detail.latestPlan} />
        </CollapsibleSection>

        <CollapsibleSection title="History" icon={<History className="h-4 w-4" />}>
          <HistorySection messages={detail.messages} plans={detail.plans} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

const taskStatusLabels: Record<Task["status"], string> = {
  open: "Not Started",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Completed",
  ignored: "No Longer Relevant",
};

const boardStatusLabels: Record<Situation["status"], string> = {
  active: "Active",
  resolved: "Resolved",
  archived: "Archived",
};

function statusLabel(status: Situation["status"]) {
  return boardStatusLabels[status];
}

const primaryTaskStatuses = new Set<Task["status"]>([
  "in_progress",
  "open",
  "blocked",
]);

function isPrimaryTask(task: Task) {
  return primaryTaskStatuses.has(task.status);
}

function planGenerationMessage(result?: TaskConversionResponse | null) {
  if (!result) return "Updated plan generated.";
  if (result.alreadyExisted) {
    return "Updated plan generated. Ranked tasks were already added.";
  }
  const label = result.items.length === 1 ? "task" : "tasks";
  return `Updated plan generated and ${result.items.length} ranked ${label} added.`;
}

function RecommendedMoveCard({
  plan,
  primaryTask,
}: {
  plan: StoredNextMovePlan | null;
  primaryTask: Task | null;
}) {
  return (
    <Card className="border-[rgba(0,120,212,0.48)] bg-[rgba(0,120,212,0.08)]">
      <div className="mb-2 text-sm font-medium uppercase text-[var(--azure-light)]">
        Do this next
      </div>
      {primaryTask ? (
        <div className="grid gap-3">
          <h2 className="text-2xl font-semibold text-white">
            {primaryTask.title}
          </h2>
          <p className="text-sm text-slate-300">
            {primaryTask.rank_reason || "Best balance of urgency, importance, and effort."}
            {plan ? ` ${plan.why_this_move}` : ""}
          </p>
          {plan ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/70 p-3 text-sm text-slate-300">
              <div className="font-medium text-white">First 10 minutes</div>
              <p className="mt-1">{plan.first_10_minute_action.details}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-slate-200">
            <Badge>importance {primaryTask.importance}/5</Badge>
            <Badge>effort {primaryTask.effort}/5</Badge>
            {primaryTask.estimated_minutes ? (
              <Badge>{primaryTask.estimated_minutes} min</Badge>
            ) : null}
            <Badge>{taskStatusLabels[primaryTask.status]}</Badge>
          </div>
        </div>
      ) : plan ? (
        <div className="grid gap-3">
          <h2 className="text-2xl font-semibold text-white">
            {plan.highest_leverage_move_today.title}
          </h2>
          <p className="text-sm text-slate-300">{plan.why_this_move}</p>
          <div className="flex flex-wrap gap-2 text-xs text-slate-200">
            <Badge>{plan.highest_leverage_move_today.estimated_minutes} min</Badge>
            <Badge>{plan.confidence_level} confidence</Badge>
            <Badge>{modeLabel(plan.mode)}</Badge>
          </div>
        </div>
      ) : (
        <EmptyState>No recommendation yet. Continue intake or generate a best move.</EmptyState>
      )}
    </Card>
  );
}

function SituationTaskQueue({ tasks }: { tasks: Task[] }) {
  const visibleTasks = tasks.filter(
    (task) => task.status !== "done" && task.status !== "ignored",
  );

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-4 w-4 text-[var(--azure-light)]" />
          <h2 className="text-xl font-semibold">Task Queue</h2>
        </div>
        <Link href="/tasks" className="text-sm font-medium text-[var(--azure-light)]">
          Open tasks
        </Link>
      </div>
      {visibleTasks.length === 0 ? (
        <EmptyState>No active tasks yet.</EmptyState>
      ) : (
        <div className="grid gap-2">
          {visibleTasks.map((task, index) => (
            <div key={task.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--azure)] text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <div>
                  <div className="font-medium text-white">{task.title}</div>
                  <div className="text-slate-400">
                    {taskStatusLabels[task.status]} · importance {task.importance}/5 ·
                    effort {task.effort}/5
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

function CollapsibleSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <details>
        <summary className="flex cursor-pointer items-center gap-2 text-xl font-semibold text-white">
          {icon}
          {title}
        </summary>
        <div className="mt-4">{children}</div>
      </details>
    </Card>
  );
}

function PlanSection({
  plan,
  tasksAdded,
  converting,
  onConvert,
}: {
  plan: StoredNextMovePlan | null;
  tasksAdded: boolean;
  converting: boolean;
  onConvert?: () => void;
}) {
  if (!plan) return <EmptyState>No best move generated yet.</EmptyState>;

  return (
    <div className="grid gap-4 text-sm">
      <Brief title="Current reality" value={plan.situation_summary} />
      <Brief title="First 10 minutes" value={plan.first_10_minute_action.details} />
      <StepList title="First 30 minutes" items={plan.first_30_minutes} />
      <StepList title="Next 24 hours" items={plan.next_24_hours} />
      <StepList title="Next 7 days" items={plan.next_7_days} />
      <div>
        {tasksAdded ? (
          <Link href="/tasks">
            <Button type="button" variant="secondary">
              <CheckSquare className="h-4 w-4" />
              View ranked tasks
            </Button>
          </Link>
        ) : onConvert ? (
          <Button type="button" onClick={onConvert} disabled={converting}>
            <CheckSquare className="h-4 w-4" />
            {converting ? "Creating tasks..." : "Turn this plan into tasks"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OperatorAnalysisSection({ plan }: { plan: StoredNextMovePlan | null }) {
  if (!plan) return <EmptyState>No operator analysis yet.</EmptyState>;

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2">
      <Brief title="Core bottleneck" value={plan.core_bottleneck} />
      <Brief title="Likely trap" value={plan.likely_trap} />
      <Brief title="Naive path" value={plan.operator_insight.naive_path} />
      <Brief title="Higher-leverage path" value={plan.operator_insight.operator_path} />
      <Brief title="Avoid" value={plan.operator_insight.wasted_motion_to_avoid} />
      <Brief title="Safety boundary" value={plan.safety_boundary.professional_help_signal} />
    </div>
  );
}

function ContextUsedSection({ plan }: { plan: StoredNextMovePlan | null }) {
  if (!plan) return <EmptyState>No context used yet.</EmptyState>;
  const items =
    plan.context_used.length > 0
      ? plan.context_used.map((item) => ({
          label: item.label,
          value: item.value,
          meta: item.category.replaceAll("_", " "),
        }))
      : plan.inferred_context_items.map((item) => ({
          label: item.label,
          value: item.value,
          meta: item.persistence.replaceAll("_", " "),
        }));

  if (items.length === 0) return <EmptyState>No context items were attached.</EmptyState>;

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div key={`${item.label}-${item.value}`} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
          <div className="text-xs uppercase text-slate-500">{item.meta}</div>
          <div className="mt-1 font-medium text-white">{item.label}</div>
          <p className="text-slate-300">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function HistorySection({
  messages,
  plans,
}: {
  messages: IntakeMessage[];
  plans: StoredNextMovePlan[];
}) {
  return (
    <div className="grid gap-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-white">Intake</h3>
        {messages.length === 0 ? (
          <EmptyState>No intake messages yet.</EmptyState>
        ) : (
          <div className="grid gap-3">
            {messages.map((item) => (
              <div
                key={item.id}
                className={`rounded-md border p-3 text-sm ${
                  item.role === "assistant"
                    ? "border-slate-800 bg-slate-900/70 text-slate-100"
                    : "border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.12)] text-blue-50"
                }`}
              >
                <div className="mb-1 text-xs font-medium uppercase text-slate-400">
                  {item.role === "assistant" ? "FlowPath" : "You"}
                </div>
                {item.content}
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-white">Plans</h3>
        {plans.length === 0 ? (
          <EmptyState>No plan history yet.</EmptyState>
        ) : (
          <div className="grid gap-2">
            {plans.map((plan) => (
              <div key={plan.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
                <div className="font-medium text-white">
                  {plan.highest_leverage_move_today.title}
                </div>
                <div className="text-slate-400">
                  {modeLabel(plan.mode)} · {formatDate(plan.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskConfirmation({ result }: { result: TaskConversionResponse }) {
  return (
    <Notice tone="success">
      {result.alreadyExisted
        ? "These tasks were already added. No duplicates created."
        : `Added ${result.items.length} ranked tasks.`}
    </Notice>
  );
}

function StepList({
  title,
  items,
}: {
  title: string;
  items: Array<{ title: string; details: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 font-semibold text-white">{title}</h3>
      <div className="grid gap-2">
        {items.map((item) => (
          <div key={`${title}-${item.title}`} className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <div className="font-medium text-white">{item.title}</div>
            <p className="mt-1 text-slate-300">{item.details}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Brief({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
      <div className="font-medium text-white">{title}</div>
      <p className="mt-1 text-slate-300">{value}</p>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-200">
      {children}
    </span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
