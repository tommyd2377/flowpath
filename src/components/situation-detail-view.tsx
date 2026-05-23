"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, CheckSquare, Sparkles, Trash2 } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type {
  IntakeMessage,
  IntakeSession,
  Situation,
  StoredNextMovePlan,
  Task,
  TaskConversionResponse,
} from "@/lib/types";
import {
  GenerationStatus,
  nextMoveGenerationStages,
} from "./generation-status";
import { NextMovePlanCard, modeLabel } from "./next-move-plan-card";
import { Button, Card, EmptyState, Notice, PageHeader } from "./ui";

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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await apiFetch<SituationDetail>(`/api/situations/${situationId}`));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load situation.",
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
      setMessage(`Situation marked ${nextStatus}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not update situation.",
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
    try {
      await apiFetch<StoredNextMovePlan>(
        `/api/situations/${detail.situation.id}/generate-plan`,
        { method: "POST", body: JSON.stringify({}) },
      );
      await load();
      setMessage("Updated plan generated.");
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate updated plan.",
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
    const confirmed = window.confirm(
      `Permanently delete "${detail.situation.title}" and all related intake, plans, and generated tasks? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<void>(`/api/situations/${detail.situation.id}`, {
        method: "DELETE",
      });
      router.replace("/situations");
      router.refresh();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete situation.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !detail) {
    return (
      <Card>
        <div className="text-sm text-slate-400">Loading situation...</div>
      </Card>
    );
  }

  if (!detail) {
    return <Notice tone="error">{error || "Situation not found."}</Notice>;
  }

  const latestPlanHasTasks = Boolean(
    detail.latestPlan &&
      detail.tasks.some(
        (task) => task.source_next_move_plan_id === detail.latestPlan?.id,
      ),
  );

  return (
    <div>
      <PageHeader eyebrow="Situation" title={detail.situation.title}>
        <p>
          {detail.situation.category} · {detail.situation.urgency} urgency ·{" "}
          {detail.situation.status}
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
          {generating ? "Generating plan..." : "Generate updated plan"}
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
        <Link href="/next-move">
          <Button type="button" variant="ghost">Continue intake</Button>
        </Link>
        <Button
          type="button"
          variant="danger"
          onClick={deletePermanently}
          disabled={deleting}
        >
          <Trash2 className="h-4 w-4" />
          {deleting ? "Deleting..." : "Delete permanently"}
        </Button>
      </div>
      {generating ? (
        <div className="mb-5">
          <GenerationStatus stages={nextMoveGenerationStages} />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid gap-5">
          <Card>
            <h2 className="mb-3 text-xl font-semibold">Intake transcript</h2>
            {detail.messages.length === 0 ? (
              <EmptyState>No intake messages yet.</EmptyState>
            ) : (
              <div className="grid gap-3">
                {detail.messages.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border p-3 text-sm ${
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
          </Card>

          <Card>
            <h2 className="mb-3 text-xl font-semibold">Related tasks</h2>
            {detail.tasks.length === 0 ? (
              <EmptyState>No related tasks yet.</EmptyState>
            ) : (
              <div className="grid gap-2">
                {detail.tasks.map((task) => (
                  <div key={task.id} className="rounded-md bg-slate-900 p-3 text-sm">
                    <div className="font-medium text-white">{task.title}</div>
                    <div className="text-slate-400">
                      {task.status} · importance {task.importance}/5 · effort{" "}
                      {task.effort}/5
                      {(task.friction_type ?? "none") !== "none"
                        ? ` · friction ${task.friction_type.replace("_", " ")}`
                        : ""}
                    </div>
                    {task.notes ? <p className="mt-1 text-slate-300">{task.notes}</p> : null}
                    {task.friction_note ? (
                      <p className="mt-1 text-amber-100/90">
                        Friction: {task.friction_note}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <NextMovePlanCard
          plan={detail.latestPlan}
          fallbackTask={detail.tasks[0] ?? null}
          onConvert={detail.latestPlan ? convertPlan : undefined}
          converting={converting}
          tasksAdded={latestPlanHasTasks}
          taskConfirmation={taskConfirmation}
        />
      </div>
    </div>
  );
}
