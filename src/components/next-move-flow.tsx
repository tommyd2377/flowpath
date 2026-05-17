"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, CheckSquare, MessageSquare, Plus, Sparkles } from "lucide-react";

import { apiFetch } from "@/lib/client-api";
import type {
  ContextConstraints,
  BillingSummary,
  IntakeMessage,
  IntakeSession,
  Situation,
  SituationUrgency,
  StoredNextMovePlan,
  Task,
} from "@/lib/types";
import { ContextConstraintsEditor } from "./context-constraints-editor";
import {
  GenerationStatus,
  nextMoveGenerationStages,
} from "./generation-status";
import { NextMovePlanCard } from "./next-move-plan-card";
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

type SituationDetail = {
  situation: Situation;
  session: IntakeSession;
  messages: IntakeMessage[];
  latestPlan: StoredNextMovePlan | null;
  plans: StoredNextMovePlan[];
  tasks: Task[];
};

const templates = [
  ["work_career", "Work / Career"],
  ["money_stability", "Money / Stability"],
  ["relationships_connection", "Relationships / Connection"],
  ["health_recovery", "Health / Recovery"],
  ["creative_project", "Creative / Personal Project"],
  ["overwhelm", "Overwhelm / Too Many Open Loops"],
  ["something_else", "Something Else"],
] as const;

export function NextMoveFlow() {
  const [situations, setSituations] = useState<Situation[]>([]);
  const [detail, setDetail] = useState<SituationDetail | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("custom");
  const [urgency, setUrgency] = useState<SituationUrgency>("medium");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [savingConstraints, setSavingConstraints] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSituations = useMemo(
    () => situations.filter((situation) => situation.status === "active"),
    [situations],
  );

  const loadSituations = useCallback(async () => {
    const data = await apiFetch<Situation[]>("/api/situations?status=active");
    setSituations(data);
    return data;
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setDetail(await apiFetch<SituationDetail>(`/api/situations/${id}`));
  }, []);

  const loadBillingSummary = useCallback(async () => {
    try {
      setBillingSummary(await apiFetch<BillingSummary>("/api/billing/summary"));
    } catch {
      setBillingSummary(null);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadSituations();
      if (data[0]) await loadDetail(data[0].id);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load next move.");
    } finally {
      setLoading(false);
    }
  }, [loadDetail, loadSituations]);

  useEffect(() => {
    void Promise.resolve().then(initialLoad);
  }, [initialLoad]);

  useEffect(() => {
    void Promise.resolve().then(loadBillingSummary);
  }, [loadBillingSummary]);

  async function createSituation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiFetch<{ situation: Situation }>("/api/situations", {
        method: "POST",
        body: JSON.stringify({ title, category, urgency }),
      });
      setTitle("");
      setCategory("custom");
      setUrgency("medium");
      await loadSituations();
      await loadDetail(created.situation.id);
      setMessage("Situation started. Answer one question at a time.");
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Could not start situation.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/situations/${detail.situation.id}/messages`, {
        method: "POST",
        body: JSON.stringify({ content: answer }),
      });
      setAnswer("");
      await loadDetail(detail.situation.id);
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not continue intake.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function generatePlan() {
    if (!detail) return;
    if (isNextMovePlanQuotaExhausted) {
      setError(nextMovePlanQuotaMessage);
      return;
    }
    setGenerating(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch<StoredNextMovePlan>(
        `/api/situations/${detail.situation.id}/generate-plan`,
        { method: "POST", body: JSON.stringify({}) },
      );
      await loadDetail(detail.situation.id);
      await loadSituations();
      await loadBillingSummary();
      setMessage("Next Move Plan generated.");
    } catch (generateError) {
      await loadBillingSummary();
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Could not generate next move plan.",
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
      await apiFetch<Task[]>(`/api/next-move-plans/${detail.latestPlan.id}/tasks`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadDetail(detail.situation.id);
      setMessage("Plan steps are now tasks.");
    } catch (convertError) {
      setError(
        convertError instanceof Error ? convertError.message : "Could not create tasks.",
      );
    } finally {
      setConverting(false);
    }
  }

  async function saveConstraintContext(context_constraints: ContextConstraints) {
    if (!detail) return;
    setSavingConstraints(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/situations/${detail.situation.id}/constraints`, {
        method: "PATCH",
        body: JSON.stringify({ context_constraints }),
      });
      await loadDetail(detail.situation.id);
      setMessage("Constraint context saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save constraint context.",
      );
    } finally {
      setSavingConstraints(false);
    }
  }

  const lastAssistant = detail?.messages
    .filter((item) => item.role === "assistant")
    .at(-1);
  const isReadyToGenerate = Boolean(
    detail?.session.is_complete || detail?.session.current_stage === "ready_to_generate",
  );
  const nextMovePlanUsage = billingSummary?.usage.find(
    (usage) => usage.usage_type === "next_move_plan",
  );
  const isNextMovePlanQuotaExhausted = nextMovePlanUsage?.remaining === 0;
  const nextMovePlanQuotaMessage =
    billingSummary?.upgrade_message ??
    "Your monthly Next Move plan usage is used up.";
  const latestPlanHasTasks = Boolean(
    detail?.latestPlan &&
      detail.tasks.some(
        (task) => task.source_next_move_plan_id === detail.latestPlan?.id,
      ),
  );

  return (
    <div>
      <PageHeader eyebrow="Find My Next Move" title="Start with the situation">
        <p>
          Answer a few focused questions. FlowPath will turn the signal into a
          practical plan, inferred context, and ranked next actions.
        </p>
      </PageHeader>

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="grid gap-5">
          <Card>
            <h2 className="mb-3 text-xl font-semibold">Start a situation</h2>
            <p className="mb-4 text-sm text-slate-400">
              Pick the broad lane. The intake will classify the specifics.
            </p>
            <div className="mb-4 grid gap-2">
              {templates.map(([templateCategory, label]) => (
                <button
                  key={templateCategory}
                  type="button"
                  onClick={() => {
                    setCategory(templateCategory);
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    category === templateCategory
                      ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                      : "border-slate-800 bg-slate-900 text-slate-200 hover:border-[var(--azure)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <form className="grid gap-4" onSubmit={createSituation}>
              <Field label="What is going on?">
                <TextArea
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  placeholder="Example: I have been applying to jobs for months and nothing is happening."
                />
              </Field>
              <details className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-200">
                  Optional urgency
                </summary>
                <div className="mt-3">
                  <Field label="Urgency">
                    <SelectInput
                      value={urgency}
                      onChange={(event) =>
                        setUrgency(event.target.value as SituationUrgency)
                      }
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="crisis">crisis</option>
                    </SelectInput>
                  </Field>
                </div>
              </details>
              <Button type="submit" disabled={working}>
                <Plus className="h-4 w-4" />
                {working ? "Starting..." : "Start intake"}
              </Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 text-xl font-semibold">Active situations</h2>
            {loading ? (
              <div className="text-sm text-slate-400">Loading situations...</div>
            ) : activeSituations.length === 0 ? (
              <EmptyState>No active situations yet.</EmptyState>
            ) : (
              <div className="grid gap-2">
                {activeSituations.map((situation) => (
                  <button
                    key={situation.id}
                    type="button"
                    onClick={() => loadDetail(situation.id)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                      detail?.situation.id === situation.id
                        ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                        : "border-slate-800 bg-slate-900 text-slate-300 hover:border-[var(--azure)]"
                    }`}
                  >
                    <div className="font-medium">{situation.title}</div>
                    <div className="text-xs text-slate-400">
                      {situation.category} · {situation.urgency}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="grid gap-5">
          {detail ? (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
                      {detail.situation.urgency} urgency · {detail.situation.category}
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold">
                      {detail.situation.title}
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                      Progress: {stageLabel(detail.session.current_stage)}
                    </p>
                  </div>
                  <Link
                    href={`/situations/${detail.situation.id}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:border-[var(--azure)]"
                  >
                    Detail
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </Card>

              <Card>
                <div className="mb-4 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[var(--azure-light)]" />
                  <h2 className="text-xl font-semibold">Focused intake</h2>
                </div>
                {lastAssistant ? (
                  <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                    <div className="mb-1 text-xs font-medium uppercase text-slate-400">
                      {isReadyToGenerate ? "FlowPath says" : "FlowPath asks"}
                    </div>
                    <p className="text-slate-100">{lastAssistant.content}</p>
                  </div>
                ) : null}
                {isReadyToGenerate ? (
                  <div className="grid gap-3">
                    <div className="rounded-lg border border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.12)] p-4 text-sm text-blue-100">
                      <div className="mb-1 flex items-center gap-2 font-medium text-white">
                        <CheckCircle2 className="h-4 w-4" />
                        Ready for a plan
                      </div>
                      <p>FlowPath has enough context to turn this into a Next Move Plan.</p>
                    </div>
                    <Button
                      type="button"
                      onClick={generatePlan}
                      disabled={generating || isNextMovePlanQuotaExhausted}
                    >
                      <Sparkles className="h-4 w-4" />
                      {isNextMovePlanQuotaExhausted
                        ? "Next Move limit reached"
                        : generating
                        ? "Generating plan..."
                        : detail.latestPlan
                          ? "Generate updated plan"
                          : "Generate plan"}
                    </Button>
                    {isNextMovePlanQuotaExhausted ? (
                      <QuotaNotice message={nextMovePlanQuotaMessage} />
                    ) : null}
                    {generating ? (
                      <GenerationStatus stages={nextMoveGenerationStages} />
                    ) : null}
                  </div>
                ) : (
                  <form className="grid gap-3" onSubmit={submitAnswer}>
                    <TextArea
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder="Answer in plain language. Bullet points are fine."
                      required
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="submit" disabled={working}>
                        {working ? "Thinking..." : "Send answer"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={generatePlan}
                        disabled={generating || isNextMovePlanQuotaExhausted}
                      >
                        <Sparkles className="h-4 w-4" />
                        {isNextMovePlanQuotaExhausted
                          ? "Next Move limit reached"
                          : generating
                            ? "Generating plan..."
                            : "Generate plan now"}
                      </Button>
                    </div>
                    {isNextMovePlanQuotaExhausted ? (
                      <QuotaNotice message={nextMovePlanQuotaMessage} />
                    ) : null}
                    {generating ? (
                      <GenerationStatus stages={nextMoveGenerationStages} />
                    ) : null}
                  </form>
                )}
              </Card>

              <Card className="bg-slate-950/70">
                <div className="mb-4">
                  <h2 className="text-xl font-semibold">Context FlowPath can use</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    This is optional. FlowPath will infer useful constraints through
                    the intake; use this only to correct or add something material.
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-[var(--azure-light)]">
                    Review or edit constraints
                  </summary>
                  <div className="mt-4">
                    <ContextConstraintsEditor
                      key={detail.session.updated_at}
                      value={detail.session.context_constraints ?? {}}
                      onSave={saveConstraintContext}
                      saving={savingConstraints}
                    />
                  </div>
                </details>
              </Card>

              <RelatedTasksCard tasks={detail.tasks} />

              <NextMovePlanCard
                plan={detail.latestPlan}
                fallbackTask={detail.tasks[0] ?? null}
                onConvert={
                  detail.latestPlan && !latestPlanHasTasks ? convertPlan : undefined
                }
                converting={converting}
              />
            </>
          ) : (
            <EmptyState>Start or select a situation to begin.</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}

function QuotaNotice({ message }: { message: string }) {
  return (
    <Notice tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{message}</span>
        <Link
          href="/billing"
          className="font-medium text-amber-50 underline underline-offset-4"
        >
          View billing
        </Link>
      </div>
    </Notice>
  );
}

function RelatedTasksCard({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-[var(--azure-light)]" />
        <h2 className="text-xl font-semibold">Related tasks</h2>
      </div>
      <div className="grid gap-2">
        {tasks.slice(0, 6).map((task) => (
          <div key={task.id} className="rounded-md border border-slate-800 bg-slate-900 p-3 text-sm">
            <div className="font-medium text-white">{task.title}</div>
            <div className="text-slate-400">
              {task.status} · importance {task.importance}/5 · effort {task.effort}/5
            </div>
          </div>
        ))}
      </div>
      {tasks.length > 6 ? (
        <Link
          href={`/situations/${tasks[0].situation_id ?? ""}`}
          className="mt-3 inline-flex text-sm font-medium text-[var(--azure-light)]"
        >
          View all related tasks
        </Link>
      ) : null}
    </Card>
  );
}

function stageLabel(stage: string) {
  return stage.replaceAll("_", " ");
}
