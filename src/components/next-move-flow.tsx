"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CheckSquare,
  Info,
  MessageSquare,
  Plus,
  Sparkles,
} from "lucide-react";

import { ApiClientError, apiFetch } from "@/lib/client-api";
import { recordFounderEvent } from "@/lib/founder-events";
import {
  founderCategoryLabel,
  founderIntakeCategories,
  founderWedgeCopy,
} from "@/lib/founder-wedge";
import type { FounderIntakeCategoryValue } from "@/lib/founder-wedge";
import { readClientQaMode } from "@/lib/qa-mode";
import {
  INTAKE_ANSWER_MAX,
  SITUATION_DESCRIPTION_MAX,
  SITUATION_TITLE_MAX,
} from "@/lib/schemas";
import type { FirstIntakePlan } from "@/lib/situation-routing";
import type {
  ContextConstraints,
  BillingSummary,
  IntakeMessage,
  IntakeSession,
  PlanGenerationResponse,
  Situation,
  SituationUrgency,
  StoredNextMovePlan,
  Task,
  TaskConversionResponse,
} from "@/lib/types";
import { ContextConstraintsEditor } from "./context-constraints-editor";
import { FlowPathMarkdown } from "./flowpath-markdown";
import {
  GenerationStatus,
  intakeGenerationStages,
  nextMoveGenerationStages,
  taskGenerationStages,
} from "./generation-status";
import { NextMovePlanCard } from "./next-move-plan-card";
import {
  Button,
  Card,
  CharacterCount,
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
  firstIntakePlanner?: FirstIntakePlan;
};

type ActiveGeneration = {
  id: string;
  type: "intake" | "plan" | "tasks";
  startedAt: number;
  retryCount: number;
};

const templates = founderIntakeCategories;

const primaryTaskStatuses = new Set<Task["status"]>([
  "in_progress",
  "open",
  "blocked",
]);

function isPrimaryTask(task: Task) {
  return primaryTaskStatuses.has(task.status);
}

function planGenerationMessage(result?: TaskConversionResponse | null) {
  if (!result) return "Founder Next Move Plan generated.";
  if (result.alreadyExisted) {
    return "Founder Next Move Plan generated. Ranked startup tasks were already added.";
  }
  const label = result.items.length === 1 ? "task" : "tasks";
  return `Founder Next Move Plan generated and ${result.items.length} ranked startup ${label} added.`;
}

export function NextMoveFlow() {
  const [detail, setDetail] = useState<SituationDetail | null>(null);
  const [description, setDescription] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<FounderIntakeCategoryValue>(
    templates[0].value,
  );
  const [urgency, setUrgency] = useState<SituationUrgency>("medium");
  const [answer, setAnswer] = useState("");
  const [lastAnswerAttempt, setLastAnswerAttempt] = useState<{
    content: string;
    clientMessageId: string;
  } | null>(null);
  const [working, setWorking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [converting, setConverting] = useState(false);
  const [activeGeneration, setActiveGeneration] = useState<ActiveGeneration | null>(null);
  const [taskConfirmation, setTaskConfirmation] =
    useState<TaskConversionResponse | null>(null);
  const [savingConstraints, setSavingConstraints] = useState(false);
  const [billingSummary, setBillingSummary] = useState<BillingSummary | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debugVisible, setDebugVisible] = useState(false);
  const detailRequestRef = useRef(0);
  const generationRef = useRef<{
    id: string;
    controller: AbortController;
    type: ActiveGeneration["type"];
  } | null>(null);
  const latestGenerationIdRef = useRef<string | null>(null);

  const loadDetail = useCallback(async (id: number) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setError(null);
    const nextDetail = await apiFetch<SituationDetail>(`/api/situations/${id}`);
    if (detailRequestRef.current === requestId) {
      setDetail(nextDetail);
      setAnswer("");
      setLastAnswerAttempt(null);
    }
    return nextDetail;
  }, []);

  const loadBillingSummary = useCallback(async () => {
    try {
      setBillingSummary(await apiFetch<BillingSummary>("/api/billing/summary"));
    } catch {
      setBillingSummary(null);
    }
  }, []);

  const initialLoad = useCallback(async () => {
    setError(null);
    try {
      const requestedSituationId =
        typeof window === "undefined"
          ? NaN
          : Number(new URLSearchParams(window.location.search).get("situationId"));
      if (Number.isInteger(requestedSituationId) && requestedSituationId > 0) {
        await loadDetail(requestedSituationId);
      } else {
        setDetail(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load next move.");
    }
  }, [loadDetail]);

  useEffect(() => {
    void Promise.resolve().then(initialLoad);
  }, [initialLoad]);

  useEffect(() => {
    void Promise.resolve().then(loadBillingSummary);
  }, [loadBillingSummary]);

  useEffect(() => {
    function refreshDebugVisible() {
      setDebugVisible(
        process.env.NODE_ENV !== "production" ||
          process.env.NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG === "true" ||
          readClientQaMode(),
      );
    }

    refreshDebugVisible();
    window.addEventListener("flowpath-qa-mode-change", refreshDebugVisible);
    return () =>
      window.removeEventListener("flowpath-qa-mode-change", refreshDebugVisible);
  }, []);

  function formatError(error: unknown, fallback: string) {
    if (error instanceof ApiClientError && typeof error.details === "string") {
      return error.details || error.message;
    }
    return error instanceof Error ? error.message : fallback;
  }

  function startGeneration(type: ActiveGeneration["type"], retryCount = 0) {
    const controller = new AbortController();
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const active = { id, type, startedAt: Date.now(), retryCount };
    generationRef.current = { id, controller, type };
    latestGenerationIdRef.current = id;
    setActiveGeneration(active);
    return { id, controller, active };
  }

  async function markGenerationCanceled(id: string) {
    await apiFetch(`/api/generations/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify({}),
    }).catch(() => {});
  }

  async function cancelActiveGeneration() {
    const active = generationRef.current;
    if (!active) return;
    active.controller.abort();
    await markGenerationCanceled(active.id);
    generationRef.current = null;
    setActiveGeneration(null);
    setWorking(false);
    setGenerating(false);
    setConverting(false);
    setMessage("Generation canceled. No completed result was added.");
  }

  function handleGenerationTimeout() {
    // Let the in-flight request continue; the status panel already exposes
    // explicit retry/cancel controls once a generation takes too long.
  }

  async function createSituation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiFetch<{ situation: Situation }>("/api/situations", {
        method: "POST",
        body: JSON.stringify({ title, description, category, urgency }),
      });
      setDescription("");
      setTitle("");
      setCategory(templates[0].value);
      setUrgency("medium");
      setTaskConfirmation(null);
      await loadDetail(created.situation.id);
      recordFounderEvent("founder_situation_started", {
        situationId: created.situation.id,
        category,
      });
      setMessage("Founder situation started. Answer one question at a time.");
    } catch (createError) {
      setError(
        formatError(createError, "Could not start situation."),
      );
    } finally {
      setWorking(false);
    }
  }

  async function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await submitAnswerAttempt(answer, undefined);
  }

  async function submitAnswerAttempt(
    content: string,
    retry?: { clientMessageId: string; retryCount: number },
  ) {
    if (!detail) return;
    const clientMessageId =
      retry?.clientMessageId ?? `answer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { id, controller } = startGeneration("intake", retry?.retryCount ?? 0);
    setLastAnswerAttempt({ content, clientMessageId });
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await apiFetch(`/api/situations/${detail.situation.id}/messages`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          content,
          client_message_id: clientMessageId,
          client_generation_id: id,
          retry_count: retry?.retryCount ?? 0,
        }),
      });
      if (latestGenerationIdRef.current !== id) return;
      setAnswer("");
      setLastAnswerAttempt(null);
      await loadDetail(detail.situation.id);
    } catch (submitError) {
      if (controller.signal.aborted) return;
      if (latestGenerationIdRef.current !== id) return;
      setError(formatError(submitError, "Could not continue intake."));
    } finally {
      if (generationRef.current?.id === id) {
        generationRef.current = null;
        setActiveGeneration(null);
      }
      setWorking(false);
    }
  }

  async function generatePlan(retryCount = 0) {
    if (!detail) return;
    if (isNextMovePlanQuotaExhausted) {
      setError(nextMovePlanQuotaMessage);
      return;
    }
    const situationId = detail.situation.id;
    const previousPlanId = detail.latestPlan?.id ?? null;
    const { id, controller } = startGeneration("plan", retryCount);
    setGenerating(true);
    setError(null);
    setMessage(null);
    setTaskConfirmation(null);
    try {
      const generated = await apiFetch<PlanGenerationResponse>(
        `/api/situations/${situationId}/generate-plan`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ client_generation_id: id, retry_count: retryCount }),
        },
      );
      if (latestGenerationIdRef.current !== id) return;
      setTaskConfirmation(generated.taskConversion ?? null);
      await loadDetail(situationId);
      await loadBillingSummary();
      recordFounderEvent("founder_intake_completed", {
        situationId,
        planId: generated.id,
      });
      recordFounderEvent("founder_plan_generated", {
        situationId,
        planId: generated.id,
      });
      setMessage(planGenerationMessage(generated.taskConversion));
    } catch (generateError) {
      await loadBillingSummary();
      if (controller.signal.aborted) return;
      if (latestGenerationIdRef.current !== id) return;
      try {
        const reconciledDetail = await loadDetail(situationId);
        if (
          reconciledDetail.latestPlan &&
          reconciledDetail.latestPlan.id !== previousPlanId
        ) {
          setMessage("Next Move Plan generated. It finished after the connection took a while.");
          return;
        }
      } catch {
        // Keep the original generation error visible if reconciliation also fails.
      }
      setError(formatError(generateError, "Could not generate next move plan."));
    } finally {
      if (generationRef.current?.id === id) {
        generationRef.current = null;
        setActiveGeneration(null);
      }
      setGenerating(false);
    }
  }

  async function convertPlan() {
    if (!detail?.latestPlan) return;
    const { id, controller } = startGeneration("tasks");
    setConverting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await apiFetch<TaskConversionResponse>(`/api/next-move-plans/${detail.latestPlan.id}/tasks`, {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({}),
      });
      if (latestGenerationIdRef.current !== id) return;
      setTaskConfirmation(result);
      await loadDetail(detail.situation.id);
      setMessage(
        result.alreadyExisted
          ? "These tasks were already added. No duplicates created."
          : `Added ${result.items.length} ranked tasks.`,
      );
    } catch (convertError) {
      if (controller.signal.aborted) return;
      if (latestGenerationIdRef.current !== id) return;
      setError(formatError(convertError, "Could not create tasks."));
    } finally {
      if (generationRef.current?.id === id) {
        generationRef.current = null;
        setActiveGeneration(null);
      }
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
  const latestPlanTasks =
    detail?.latestPlan
      ? detail.tasks.filter(
          (task) =>
            task.source_next_move_plan_id === detail.latestPlan?.id &&
            isPrimaryTask(task),
        )
      : [];
  const primaryTask =
    latestPlanTasks[0] ??
    detail?.tasks.find(isPrimaryTask) ??
    detail?.tasks[0] ??
    null;
  const workflowStep: IntakeStep = !detail
    ? description.trim()
      ? "description"
      : "category"
    : detail.latestPlan || isReadyToGenerate
      ? "plan"
      : "intake";

  return (
    <div>
      <PageHeader eyebrow="Founder intake" title="Founder intake to next move">
        <p>
          Move through one guided flow: bottleneck, context, focused intake, then
          next move.
        </p>
      </PageHeader>

      <IntakeStepper current={workflowStep} />

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="grid gap-5">
        {!detail ? (
          <Card>
            <h2 className="mb-3 text-xl font-semibold">Choose this week&apos;s bottleneck</h2>
            <p className="mb-4 text-sm text-slate-400">
              Pick the startup constraint FlowPath should move, then describe it in
              plain language.
            </p>
            <div className="mb-4 grid gap-2">
              {templates.map((template) => (
                <button
                  key={template.value}
                  type="button"
                  onClick={() => {
                    setCategory(template.value);
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    category === template.value
                      ? "border-[var(--azure)] bg-[rgba(0,120,212,0.16)] text-white"
                      : "border-slate-800 bg-slate-900 text-slate-200 hover:border-[var(--azure)]"
                  }`}
                >
                  <span className="font-medium">{template.label}</span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {template.description}
                  </span>
                </button>
              ))}
            </div>
            <form className="grid gap-4" onSubmit={createSituation}>
              <Field label="What startup bottleneck should FlowPath help you move this week?">
                <TextArea
                  value={description}
                  maxLength={SITUATION_DESCRIPTION_MAX}
                  onChange={(event) => setDescription(event.target.value)}
                  required
                  placeholder="Example: I have a working prototype but no users yet, and I do not know whether to focus on customer outreach, positioning, or finding a cofounder."
                />
                <CharacterCount value={description} max={SITUATION_DESCRIPTION_MAX} />
              </Field>
              <details className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                <summary className="cursor-pointer text-sm font-medium text-slate-200">
                  Optional short title
                </summary>
                <div className="mt-3">
                  <Field label="Short title">
                    <TextArea
                      value={title}
                      maxLength={SITUATION_TITLE_MAX}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Example: Prototype with no users"
                      className="min-h-20"
                    />
                    <CharacterCount value={title} max={SITUATION_TITLE_MAX} />
                  </Field>
                </div>
              </details>
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
                {working ? "Starting..." : founderWedgeCopy.primaryCta}
              </Button>
            </form>
          </Card>
        ) : null}

        <div className="grid gap-5">
          {detail ? (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
                      {detail.situation.urgency} urgency ·{" "}
                      {founderCategoryLabel(detail.situation.category)}
                    </div>
                    <h2 className="mt-1 text-2xl font-semibold">
                      {detail.situation.title}
                    </h2>
                    {detail.situation.description &&
                    detail.situation.description !== detail.situation.title ? (
                      <p className="mt-2 text-sm text-slate-300">
                        {detail.situation.description}
                      </p>
                    ) : null}
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
                  <h2 className="text-xl font-semibold">Founder-focused intake</h2>
                </div>
                {lastAssistant ? (
                  <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/70 p-4">
                    <div className="mb-1 text-xs font-medium uppercase text-slate-400">
                      {isReadyToGenerate ? "FlowPath says" : "FlowPath asks"}
                    </div>
                    <FlowPathMarkdown
                      content={lastAssistant.content}
                      isStreaming={working && activeGeneration?.type === "intake"}
                      mode={working && activeGeneration?.type === "intake" ? "streaming" : "static"}
                      variant="chat"
                    />
                  </div>
                ) : null}
                <SafetySupportNotice
                  plan={detail.firstIntakePlanner}
                  currentQuestion={lastAssistant?.content ?? ""}
                />
                {debugVisible && detail.firstIntakePlanner ? (
                  <FirstIntakePlannerDebug
                    plan={detail.firstIntakePlanner}
                    answered={detail.messages.some((item) => item.role === "user")}
                    skipped={Boolean(
                      detail.latestPlan &&
                        !detail.messages.some((item) => item.role === "user"),
                    )}
                  />
                ) : null}
                {isReadyToGenerate ? (
                  <div className="grid gap-3">
                    <div className="rounded-lg border border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.12)] p-4 text-sm text-blue-100">
                      <div className="mb-1 flex items-center gap-2 font-medium text-white">
                        <CheckCircle2 className="h-4 w-4" />
                        {detail.latestPlan ? "Plan generated" : "Ready for a plan"}
                      </div>
                      <p>
                        {detail.latestPlan
                          ? latestPlanHasTasks
                            ? "Your Founder Next Move Plan is saved and ranked startup tasks are ready below."
                            : "Your Founder Next Move Plan is saved. You can add ranked startup tasks below."
                          : "FlowPath has enough founder context to choose the next startup move."}
                      </p>
                    </div>
                    {!detail.latestPlan ? (
                      <>
                        <Button
                          type="button"
                          onClick={() => generatePlan()}
                          disabled={generating || isNextMovePlanQuotaExhausted}
                        >
                          <Sparkles className="h-4 w-4" />
                          {isNextMovePlanQuotaExhausted
                              ? "Next Move limit reached"
                              : generating
                                ? "Generating founder plan..."
                                : "Generate founder plan"}
                        </Button>
                        {isNextMovePlanQuotaExhausted ? (
                          <QuotaNotice message={nextMovePlanQuotaMessage} />
                        ) : null}
                      </>
                    ) : null}
                    {generating && activeGeneration?.type === "plan" ? (
                      <GenerationStatus
                        stages={nextMoveGenerationStages}
                        startedAt={activeGeneration.startedAt}
                        softWarningSeconds={45}
                        hardTimeoutSeconds={240}
                        onRetry={() => generatePlan(activeGeneration.retryCount + 1)}
                        onCancel={cancelActiveGeneration}
                        onEdit={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                        onTimeout={handleGenerationTimeout}
                      />
                    ) : null}
                  </div>
                ) : (
                  <form className="grid gap-3" onSubmit={submitAnswer}>
                    <TextArea
                      value={answer}
                      maxLength={INTAKE_ANSWER_MAX}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder="Answer in plain language. Bullet points are fine."
                      required
                    />
                    <CharacterCount value={answer} max={INTAKE_ANSWER_MAX} />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="submit" disabled={working}>
                        {working ? "Thinking..." : "Send answer"}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => generatePlan()}
                        disabled={generating || isNextMovePlanQuotaExhausted}
                      >
                        <Sparkles className="h-4 w-4" />
                        {isNextMovePlanQuotaExhausted
                          ? "Next Move limit reached"
                          : generating
                            ? "Generating founder plan..."
                            : "I've given enough context / Generate now"}
                      </Button>
                    </div>
                    {isNextMovePlanQuotaExhausted ? (
                      <QuotaNotice message={nextMovePlanQuotaMessage} />
                    ) : null}
                    {working && activeGeneration?.type === "intake" ? (
                      <GenerationStatus
                        stages={intakeGenerationStages}
                        startedAt={activeGeneration.startedAt}
                        onRetry={() =>
                          lastAnswerAttempt &&
                          submitAnswerAttempt(lastAnswerAttempt.content, {
                            clientMessageId: lastAnswerAttempt.clientMessageId,
                            retryCount: activeGeneration.retryCount + 1,
                          })
                        }
                        onCancel={cancelActiveGeneration}
                        onTimeout={handleGenerationTimeout}
                      />
                    ) : null}
                    {generating && activeGeneration?.type === "plan" ? (
                      <GenerationStatus
                        stages={nextMoveGenerationStages}
                        startedAt={activeGeneration.startedAt}
                        softWarningSeconds={45}
                        hardTimeoutSeconds={240}
                        onRetry={() => generatePlan(activeGeneration.retryCount + 1)}
                        onCancel={cancelActiveGeneration}
                        onEdit={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                        onTimeout={handleGenerationTimeout}
                      />
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

              {converting && activeGeneration?.type === "tasks" ? (
                <GenerationStatus
                  stages={taskGenerationStages}
                  startedAt={activeGeneration.startedAt}
                  softWarningSeconds={10}
                  hardTimeoutSeconds={45}
                  onCancel={cancelActiveGeneration}
                  onTimeout={handleGenerationTimeout}
                />
              ) : null}

              <NextMovePlanCard
                plan={detail.latestPlan}
                fallbackTask={detail.tasks[0] ?? null}
                primaryTask={primaryTask}
                onConvert={
                  detail.latestPlan && !latestPlanHasTasks ? convertPlan : undefined
                }
                converting={converting}
                tasksAdded={latestPlanHasTasks}
                taskConfirmation={taskConfirmation}
              />
            </>
          ) : null}
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

type IntakeStep = "category" | "description" | "intake" | "plan";

function IntakeStepper({ current }: { current: IntakeStep }) {
  const steps: Array<{ id: IntakeStep; label: string }> = [
    { id: "category", label: "Bottleneck" },
    { id: "description", label: "Context" },
    { id: "intake", label: "Intake" },
    { id: "plan", label: "Next move" },
  ];
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <div className="mb-5 rounded-lg border border-slate-800 bg-slate-950 p-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {steps.map((step, index) => {
          const active = index === currentIndex;
          const complete = index < currentIndex;
          return (
            <div
              key={step.id}
              className={`flex min-h-10 items-center justify-center rounded-md border px-3 text-sm font-medium ${
                active
                  ? "border-[var(--azure)] bg-[rgba(0,120,212,0.18)] text-white"
                  : complete
                    ? "border-slate-700 bg-slate-900 text-slate-200"
                    : "border-slate-800 bg-slate-950 text-slate-500"
              }`}
            >
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FirstIntakePlannerDebug({
  plan,
  answered,
  skipped,
}: {
  plan: FirstIntakePlan;
  answered: boolean;
  skipped: boolean;
}) {
  return (
    <details className="mb-4 rounded-lg border border-slate-800 bg-slate-900/65 p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-white">
        <Info className="h-4 w-4 text-[var(--azure-light)]" />
        First intake planner
      </summary>
      <div className="mt-3 grid gap-2 text-slate-300 sm:grid-cols-2">
        <DebugBrief title="Domain" value={plan.domain} />
        <DebugBrief title="Subtype" value={plan.subtype.replaceAll("_", " ")} />
        <DebugBrief
          title="Purpose"
          value={plan.questionPurpose.replaceAll("_", " ")}
        />
        <DebugBrief title="Missing info" value={plan.missingInfoTarget} />
        <DebugBrief title="Genericity" value={plan.genericityRisk} />
        <DebugBrief title="Answered" value={answered ? "yes" : "no"} />
        <DebugBrief title="Skipped" value={skipped ? "yes" : "no"} />
      </div>
    </details>
  );
}

function SafetySupportNotice({
  plan,
  currentQuestion,
}: {
  plan?: FirstIntakePlan;
  currentQuestion: string;
}) {
  if (!plan || plan.domain !== "safety") return null;
  const guidance = plan.question.trim();
  if (!guidance || guidance === currentQuestion.trim()) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 text-sm text-amber-50">
      <div className="mb-1 flex items-center gap-2 font-medium text-amber-100">
        <AlertTriangle className="h-4 w-4" />
        Human help may matter here
      </div>
      <p>{guidance}</p>
    </div>
  );
}

function DebugBrief({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/55 p-2">
      <div className="text-xs uppercase text-slate-500">{title}</div>
      <div className="mt-1 text-slate-200">{value}</div>
    </div>
  );
}

function RelatedTasksCard({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <CheckSquare className="h-4 w-4 text-[var(--azure-light)]" />
        <h2 className="text-xl font-semibold">Ranked next moves</h2>
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
          View all ranked next moves
        </Link>
      ) : null}
    </Card>
  );
}

function stageLabel(stage: string) {
  return stage.replaceAll("_", " ");
}
