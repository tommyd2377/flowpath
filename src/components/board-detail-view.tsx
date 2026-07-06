"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  CheckSquare,
  ClipboardList,
  History,
  Info,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import {
  decisionBranchSourceSection,
  decisionTreeTrace,
  findDecisionOption,
  selectedPathForChoice,
} from "@/lib/decision-tree";
import {
  entryDomainFallbackTitle,
  entryDomainTitle,
  inferBoardTitle,
  inferSecondaryDomainIds,
  isEntryDomainId,
} from "@/lib/entry-domains";
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
import { DecisionTreeMap } from "./decision-tree-map";
import {
  GenerationStatus,
  nextMoveGenerationStages,
} from "./generation-status";
import { BoardSnapshot, modeLabel } from "./next-move-plan-card";
import { Button, Card, CharacterCount, EmptyState, Notice, TextArea } from "./ui";

type BoardDetail = {
  situation: Situation;
  session: IntakeSession;
  messages: IntakeMessage[];
  latestPlan: StoredNextMovePlan | null;
  plans: StoredNextMovePlan[];
  tasks: Task[];
};

export function BoardDetailView({ boardId }: { boardId: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<BoardDetail | null>(null);
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
  const [updateFocused, setUpdateFocused] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedPathOverride, setSelectedPathOverride] = useState<{
    planId: number;
    path: string[];
  } | null>(null);
  const [actioningBranch, setActioningBranch] = useState<
    "accept" | "complete" | null
  >(null);
  const [exploringNodeId, setExploringNodeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiFetch<BoardDetail>(`/api/boards/${boardId}`));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load board.",
      );
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function updateStatus(nextStatus: Situation["status"]) {
    if (!detail) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await apiFetch<BoardDetail>(
        `/api/boards/${detail.situation.id}`,
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

  async function saveSelectedBranchAction(action: "accept" | "complete") {
    if (!detail?.latestPlan) return;
    const tree = detail.latestPlan.decision_tree;
    const path =
      selectedPathOverride?.planId === detail.latestPlan.id &&
      selectedPathOverride.path.length
        ? selectedPathOverride.path
        : tree.selected_path;
    const trace = decisionTreeTrace(tree, path);
    const actionNode = trace.at(-1)?.node.kind === "action" ? trace.at(-1)?.node : null;
    const option =
      (actionNode?.selected_from_option_id
        ? findDecisionOption(tree, actionNode.selected_from_option_id)
        : trace
            .slice()
            .reverse()
            .find((item) => item.selectedOption)?.selectedOption) ??
      findDecisionOption(tree, path.at(-1));
    if (!option) return;
    const selectedAction = actionNode?.action ?? option.first_action;
    setActioningBranch(action);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/next-move-plans/${detail.latestPlan.id}/suggested-action`, {
        method: "POST",
        body: JSON.stringify({
          action,
          branch_option_id: option.id,
          title: selectedAction.title,
          description: selectedAction.details,
          estimatedMinutes: selectedAction.estimated_minutes,
        }),
      });
      await load();
      setMessage(
        action === "complete"
          ? "Branch action marked complete."
          : "Branch action added to your task queue.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save this branch action.",
      );
    } finally {
      setActioningBranch(null);
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
      await apiFetch<void>(`/api/boards/${detail.situation.id}`, {
        method: "DELETE",
      });
      setConfirmingDelete(false);
      router.replace("/boards");
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
  const decisionTree = detail.latestPlan?.decision_tree ?? null;
  const localSelectedPath =
    detail.latestPlan && selectedPathOverride?.planId === detail.latestPlan.id
      ? selectedPathOverride.path
      : null;
  const effectiveSelectedPath = decisionTree
    ? localSelectedPath?.length
      ? localSelectedPath
      : decisionTree.selected_path
    : [];
  const treeTrace = decisionTree
    ? decisionTreeTrace(decisionTree, effectiveSelectedPath)
    : [];
  const activeActionNode =
    treeTrace.at(-1)?.node.kind === "action" ? treeTrace.at(-1)?.node : null;
  const selectedOption = decisionTree
    ? activeActionNode?.selected_from_option_id
      ? findDecisionOption(decisionTree, activeActionNode.selected_from_option_id)
      : treeTrace
          .slice()
          .reverse()
          .find((item) => item.selectedOption)?.selectedOption ??
        findDecisionOption(decisionTree, effectiveSelectedPath.at(-1))
    : null;
  const selectedBranchTask =
    detail.latestPlan && selectedOption
      ? detail.tasks.find(
          (task) =>
            task.source_next_move_plan_id === detail.latestPlan?.id &&
            task.source_plan_section ===
              decisionBranchSourceSection(selectedOption.id),
        ) ?? null
      : null;
  const relatedTaskCount = latestPlanTasks.length;
  const displayTitle = boardDisplayTitle(detail.situation, detail.latestPlan);
  const domainSummary = boardDomainSummary(detail.situation, detail.latestPlan);
  const boardMeta = `${domainSummary} / ${statusLabel(detail.situation.status)} / ${capitalize(detail.situation.urgency)} urgency${
    detail.latestPlan ? ` / ${capitalize(modeLabel(detail.latestPlan.mode))} mode` : ""
  }`;

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
      const updateResult = await apiFetch<{ reconciliation_message?: string }>(
        `/api/boards/${detail.situation.id}/board-update`,
        {
          method: "POST",
          body: JSON.stringify({
            content: trimmed,
            client_message_id: `board-update-${Date.now()}`,
          }),
        },
      );
      setBoardUpdate("");
      const generated = await apiFetch<PlanGenerationResponse>(
        `/api/boards/${detail.situation.id}/generate-plan`,
        { method: "POST", body: JSON.stringify({}) },
      );
      setTaskConfirmation(generated.taskConversion ?? null);
      await load();
      setMessage(
        updateResult.reconciliation_message ?? "Board updated and recalculated.",
      );
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

  function selectTreeOption(nodeId: string, optionId: string) {
    const plan = detail?.latestPlan ?? null;
    if (!decisionTree || !plan) return;
    setSelectedPathOverride({
      planId: plan.id,
      path: selectedPathForChoice(
        decisionTree,
        effectiveSelectedPath,
        nodeId,
        optionId,
      ),
    });
  }

  async function exploreTreeOption(nodeId: string, optionId: string) {
    if (!detail?.latestPlan) return;
    setExploringNodeId(nodeId);
    setError(null);
    setMessage(null);
    try {
      const expanded = await apiFetch<{ decision_tree: StoredNextMovePlan["decision_tree"] }>(
        `/api/boards/${detail.situation.id}/move-map/expand`,
        {
          method: "POST",
          body: JSON.stringify({
            plan_id: detail.latestPlan.id,
            current_node_id: nodeId,
            selected_option_id: optionId,
            selected_path: effectiveSelectedPath,
          }),
        },
      );
      setSelectedPathOverride({
        planId: detail.latestPlan.id,
        path: expanded.decision_tree.selected_path,
      });
      await load();
      setMessage("Path continued.");
    } catch (exploreError) {
      setError(
        exploreError instanceof Error
          ? exploreError.message
          : "Could not continue this path.",
      );
    } finally {
      setExploringNodeId(null);
    }
  }

  function promptBoardUpdate(prefix: string) {
    setBoardUpdate((current) => current || prefix);
    setUpdateFocused(true);
    setMessage("Tell FlowPath what changed, then update the board.");
  }

  return (
    <div className="relative left-1/2 grid w-[calc(100vw-2rem)] max-w-[96rem] -translate-x-1/2 gap-3 sm:w-[calc(100vw-3rem)] lg:w-[calc(100vw-4rem)]">
      <section className="border-b border-slate-800 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-normal text-white sm:text-2xl">
              {displayTitle}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDetailsOpen(true)}
              className="min-h-8"
            >
              <MoreHorizontal className="h-4 w-4" />
              More
            </Button>
          </div>
        </div>
      </section>

      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {generating ? <GenerationStatus stages={nextMoveGenerationStages} /> : null}

      <section className="rounded-lg border border-slate-800 bg-slate-950/55 p-2.5">
        <form className="grid gap-2 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start" onSubmit={submitBoardUpdate}>
          <div className="flex min-h-9 items-center gap-2 text-sm font-medium text-slate-200">
            <MessageSquare className="h-4 w-4 text-[var(--azure-light)]" />
            Tell FlowPath what changed
          </div>
          <TextArea
            value={boardUpdate}
            maxLength={INTAKE_ANSWER_MAX}
            onChange={(event) => setBoardUpdate(event.target.value)}
            onFocus={() => setUpdateFocused(true)}
            onBlur={() => setUpdateFocused(false)}
            placeholder="Tell FlowPath what changed..."
            className={`resize-y text-sm transition-all ${
              updateFocused || boardUpdate.trim()
                ? "!min-h-24"
                : "!min-h-9 max-h-9 overflow-hidden py-1.5 leading-5"
            }`}
          />
          <div className="flex min-h-9 flex-wrap items-center justify-between gap-2 lg:justify-end">
            {(updateFocused || boardUpdate.trim()) ? (
              <CharacterCount value={boardUpdate} max={INTAKE_ANSWER_MAX} />
            ) : (
              <span className="hidden text-xs text-slate-500 lg:hidden">
                Examples: weekends only, priorities changed, tried it already.
              </span>
            )}
            {updateFocused || boardUpdate.trim() ? (
              <Button
                type="submit"
                aria-label="Update and recalculate"
                disabled={saving || generating || !boardUpdate.trim()}
                className="min-h-9"
              >
                <Sparkles className="h-4 w-4" />
                {saving || generating ? "Updating..." : "Update"}
              </Button>
            ) : null}
          </div>
        </form>
      </section>

      {decisionTree ? (
        <DecisionTreeMap
          boardTitle={displayTitle}
          boardMeta={boardMeta}
          tree={decisionTree}
          selectedPath={effectiveSelectedPath}
          onSelect={selectTreeOption}
          branchTask={selectedBranchTask}
          relatedTaskCount={relatedTaskCount}
          actioning={actioningBranch}
          exploringNodeId={exploringNodeId}
          onChoosePath={() => saveSelectedBranchAction("accept")}
          onComplete={() => saveSelectedBranchAction("complete")}
          onExplore={exploreTreeOption}
          onBlocked={() => promptBoardUpdate("I'm blocked because ")}
          onChangeAction={() => promptBoardUpdate("Change this next action: ")}
        />
      ) : (
        <Card>
          <EmptyState>No move map yet. Open More to continue intake or generate moves.</EmptyState>
        </Card>
      )}

      {converting ? <GenerationStatus stages={nextMoveGenerationStages} /> : null}
      {taskConfirmation ? <TaskConfirmation result={taskConfirmation} /> : null}

      {detailsOpen ? (
        <BoardDetailsDrawer
          situation={detail.situation}
          plan={detail.latestPlan}
          messages={detail.messages}
          plans={detail.plans}
          tasksAdded={latestPlanHasTasks}
          boardId={detail.situation.id}
          converting={converting}
          saving={saving}
          deleting={deleting}
          confirmingDelete={confirmingDelete}
          onClose={() => setDetailsOpen(false)}
          onConvert={detail.latestPlan ? convertPlan : undefined}
          onResolve={() => updateStatus("resolved")}
          onArchive={() => updateStatus("archived")}
          onDelete={deletePermanently}
          onCancelDelete={() => setConfirmingDelete(false)}
        />
      ) : null}
    </div>
  );
}

const boardStatusLabels: Record<Situation["status"], string> = {
  active: "Active",
  resolved: "Resolved",
  archived: "Archived",
};

function statusLabel(status: Situation["status"]) {
  return boardStatusLabels[status];
}

function boardDisplayTitle(
  situation: Situation,
  plan: StoredNextMovePlan | null,
) {
  const context = [
    situation.title,
    situation.description,
    plan?.situation_read,
    plan?.situation_summary,
    plan?.highest_leverage_move_today.title,
    plan?.highest_leverage_move_today.description,
    plan?.task_candidates.map((task) => `${task.title} ${task.details}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  const inferred = inferBoardTitle(situation.category, context);
  const rawish = isRawBoardTitle(situation.title);
  if (!rawish && situation.title.trim().length <= 64) return situation.title.trim();
  if (!isRawBoardTitle(inferred) && inferred.length <= 64) return inferred;
  if (plan?.highest_leverage_move_today.title) {
    return clipTitle(plan.highest_leverage_move_today.title);
  }
  return entryDomainFallbackTitle(situation.category);
}

function boardDomainSummary(
  situation: Situation,
  plan: StoredNextMovePlan | null,
) {
  const text = [
    situation.description,
    plan?.situation_read,
    plan?.situation_summary,
    plan?.context_used.map((item) => `${item.label} ${item.value}`).join(" "),
    plan?.task_candidates.map((task) => `${task.title} ${task.details}`).join(" "),
  ]
    .filter(Boolean)
    .join(" ");
  const primary = isEntryDomainId(situation.category)
    ? entryDomainTitle(situation.category)
    : entryDomainTitle(situation.category);
  const secondary = inferSecondaryDomainIds(situation.category, text)
    .map(entryDomainTitle)
    .filter((domain) => domain !== primary);
  return [primary, ...secondary].join(" + ");
}

function isRawBoardTitle(value: string) {
  const text = value.trim();
  return (
    text.length > 64 ||
    /^(i('| a)?m|i am|i want|i need|i'm trying|trying|help me|what should|how do i)\b/i.test(text)
  );
}

function clipTitle(value: string) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= 64 ? clean : `${clean.slice(0, 61).trimEnd()}...`;
}

function capitalize(value: string) {
  const clean = value.replaceAll("_", " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const primaryTaskStatuses = new Set<Task["status"]>([
  "in_progress",
  "open",
  "blocked",
]);

function isPrimaryTask(task: Task) {
  return primaryTaskStatuses.has(task.status);
}

function BoardDetailsDrawer({
  situation,
  plan,
  messages,
  plans,
  tasksAdded,
  boardId,
  converting,
  saving,
  deleting,
  confirmingDelete,
  onClose,
  onConvert,
  onResolve,
  onArchive,
  onDelete,
  onCancelDelete,
}: {
  situation: Situation;
  plan: StoredNextMovePlan | null;
  messages: IntakeMessage[];
  plans: StoredNextMovePlan[];
  tasksAdded: boolean;
  boardId: number;
  converting: boolean;
  saving: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  onClose: () => void;
  onConvert?: () => void;
  onResolve: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close details"
        className="absolute inset-0 cursor-default bg-black/55"
        onClick={onClose}
      />
      <aside
        aria-label="Board details"
        className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-4 shadow-[0_18px_70px_rgba(0,0,0,0.5)] sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase text-[var(--azure-light)]">
              More
            </div>
            <h2 className="mt-1 text-xl font-semibold text-white">
              Board details
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Background context, reasoning, and history for this board.
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>

        <div className="grid gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
            <div className="text-sm font-semibold text-white">
              Board actions
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {situation.status === "active" ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onResolve}
                    disabled={saving || deleting}
                  >
                    Mark resolved
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onArchive}
                    disabled={saving || deleting}
                  >
                    Archive
                  </Button>
                </>
              ) : null}
              <Link href={`/next-move?boardId=${boardId}`}>
                <Button type="button" variant="ghost">
                  Continue intake
                </Button>
              </Link>
            </div>
          </div>

          <DetailDisclosure
            title="Board Snapshot"
            icon={<Info className="h-4 w-4" />}
          >
            {plan ? (
              <BoardSnapshot plan={plan} situation={situation} />
            ) : (
              <EmptyState>No board snapshot yet.</EmptyState>
            )}
          </DetailDisclosure>

          <DetailDisclosure
            title="Plan Details"
            icon={<ClipboardList className="h-4 w-4" />}
          >
            <PlanSection
              plan={plan}
              tasksAdded={tasksAdded}
              converting={converting}
              onConvert={plan ? onConvert : undefined}
            />
          </DetailDisclosure>

          <DetailDisclosure
            title="Reasoning Details"
            icon={<Info className="h-4 w-4" />}
          >
            <OperatorAnalysisSection plan={plan} />
          </DetailDisclosure>

          <DetailDisclosure
            title="Context Used"
            icon={<Info className="h-4 w-4" />}
          >
            <ContextUsedSection plan={plan} />
          </DetailDisclosure>

          <DetailDisclosure
            title="Move History"
            icon={<History className="h-4 w-4" />}
          >
            <HistorySection messages={messages} plans={plans} />
          </DetailDisclosure>

          <div className="rounded-lg border border-red-950/60 bg-red-950/15 p-3">
            <div className="text-sm font-medium text-red-100">Danger zone</div>
            {confirmingDelete ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  onClick={onDelete}
                  disabled={deleting}
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting..." : "Confirm delete"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancelDelete}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={onDelete}
                disabled={deleting}
                className="mt-2 text-red-200 hover:bg-red-950/35"
              >
                <Trash2 className="h-4 w-4" />
                Delete permanently
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function DetailDisclosure({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/55 p-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-white">
        {icon}
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
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
                  {modeLabel(plan.mode)} / {formatDate(plan.created_at)}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
