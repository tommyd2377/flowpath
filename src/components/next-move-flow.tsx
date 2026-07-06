"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
  CheckSquare,
  Info,
  MessageSquare,
  Palette,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";

import { ApiClientError, apiFetch } from "@/lib/client-api";
import {
  ENTRY_DOMAINS,
  domainFirstAnswerPlaceholders,
  domainFirstQuestions,
  entryDomainTitle,
  isEntryDomainId,
  type EntryDomainId,
} from "@/lib/entry-domains";
import { readClientQaMode } from "@/lib/qa-mode";
import {
  INTAKE_ANSWER_MAX,
  SITUATION_DESCRIPTION_MAX,
} from "@/lib/schemas";
import type { FirstIntakePlan } from "@/lib/situation-routing";
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
  TextArea,
} from "./ui";

type BoardDetail = {
  board?: Situation;
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

const entryDomainIcons: Record<EntryDomainId, typeof Briefcase> = {
  work_money_career: Briefcase,
  people_community_belonging: Users,
  craft_creativity_mastery: Palette,
};

const primaryTaskStatuses = new Set<Task["status"]>([
  "in_progress",
  "open",
  "blocked",
]);

function isPrimaryTask(task: Task) {
  return primaryTaskStatuses.has(task.status);
}

function planGenerationMessage(result?: TaskConversionResponse | null) {
  if (!result) return "Best move generated.";
  if (result.alreadyExisted) {
    return "Best move generated. Ranked tasks were already added.";
  }
  const label = result.items.length === 1 ? "task" : "tasks";
  return `Best move generated and ${result.items.length} ranked ${label} added.`;
}

type NextMoveFlowProps = {
  initialDomain?: EntryDomainId | null;
};

export function NextMoveFlow({ initialDomain = null }: NextMoveFlowProps) {
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<EntryDomainId | "">(
    initialDomain ?? "",
  );
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
    const nextDetail = await apiFetch<BoardDetail>(`/api/boards/${id}`);
    if (detailRequestRef.current === requestId) {
      setDetail(nextDetail);
      setAnswer("");
      setLastAnswerAttempt(null);
    }
    return nextDetail;
  }, []);

  const initialLoad = useCallback(async () => {
    setError(null);
    try {
      const searchParams =
        typeof window === "undefined"
          ? new URLSearchParams()
          : new URLSearchParams(window.location.search);
      const requestedBoardId = Number(searchParams.get("boardId"));
      const requestedDomain = searchParams.get("domain");
      if (isEntryDomainId(requestedDomain)) {
        setCategory(requestedDomain);
      }
      if (Number.isInteger(requestedBoardId) && requestedBoardId > 0) {
        await loadDetail(requestedBoardId);
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

  async function createBoard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!category) {
      setError("Choose one board before starting intake.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiFetch<{ board: Situation; situation?: Situation }>("/api/boards", {
        method: "POST",
        body: JSON.stringify({ description, category }),
      });
      setDescription("");
      setCategory("");
      setTaskConfirmation(null);
      await loadDetail(created.board.id);
      setMessage("Board started. Answer one question at a time.");
    } catch (createError) {
      setError(
        formatError(createError, "Could not start board."),
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
      await apiFetch(`/api/boards/${detail.situation.id}/messages`, {
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
    const situationId = detail.situation.id;
    const previousPlanId = detail.latestPlan?.id ?? null;
    const { id, controller } = startGeneration("plan", retryCount);
    setGenerating(true);
    setError(null);
    setMessage(null);
    setTaskConfirmation(null);
    try {
      const generated = await apiFetch<PlanGenerationResponse>(
        `/api/boards/${situationId}/generate-plan`,
        {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ client_generation_id: id, retry_count: retryCount }),
        },
      );
      if (latestGenerationIdRef.current !== id) return;
      setTaskConfirmation(generated.taskConversion ?? null);
      await loadDetail(situationId);
      setMessage(planGenerationMessage(generated.taskConversion));
    } catch (generateError) {
      if (controller.signal.aborted) return;
      if (latestGenerationIdRef.current !== id) return;
      try {
        const reconciledDetail = await loadDetail(situationId);
        if (
          reconciledDetail.latestPlan &&
          reconciledDetail.latestPlan.id !== previousPlanId
        ) {
          setMessage("Best move generated. It finished after the connection took a while.");
          return;
        }
      } catch {
        // Keep the original generation error visible if reconciliation also fails.
      }
      setError(formatError(generateError, "Could not generate the best move."));
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

  const lastAssistant = detail?.messages
    .filter((item) => item.role === "assistant")
    .at(-1);
  const isReadyToGenerate = Boolean(
    detail?.session.is_complete || detail?.session.current_stage === "ready_to_generate",
  );
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
    ? category
      ? "position"
      : "category"
    : detail.latestPlan || isReadyToGenerate
      ? "move"
      : "intake";

  return (
    <div>
      <PageHeader eyebrow="New board" title="What are you trying to figure out?">
        <p>
          Pick one domain, describe the current position, answer FlowPath one
          question at a time, then review the board and best next move.
        </p>
      </PageHeader>

      <IntakeStepper current={workflowStep} />

      {message ? <div className="mb-4"><Notice tone="success">{message}</Notice></div> : null}
      {error ? <div className="mb-4"><Notice tone="error">{error}</Notice></div> : null}

      <div className="grid gap-5">
        {!detail ? (
          <Card>
            {category ? (
              <SelectedDomainForm
                category={category}
                description={description}
                setDescription={setDescription}
                working={working}
                onSubmit={createBoard}
              />
            ) : (
              <DomainPicker onSelect={setCategory} />
            )}
          </Card>
        ) : null}

        <div className="grid gap-5">
          {detail ? (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
                      Board: {entryDomainTitle(detail.situation.category)}
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
                    href={`/boards/${detail.situation.id}`}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 text-sm font-medium text-slate-200 hover:border-[var(--azure)]"
                  >
                    Board detail
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
                        {detail.latestPlan ? "Best move generated" : "Ready for a best move"}
                      </div>
                      <p>
                        {detail.latestPlan
                          ? latestPlanHasTasks
                            ? "Your best move is saved and ranked tasks are ready below."
                            : "Your best move is saved. You can add ranked tasks below."
                          : "FlowPath has enough context to read the board and recommend a best move."}
                      </p>
                    </div>
                    {!detail.latestPlan ? (
                      <>
                        <Button
                          type="button"
                          onClick={() => generatePlan()}
                          disabled={generating}
                        >
                          <Sparkles className="h-4 w-4" />
                          {generating
                              ? "Generating plan..."
                              : "Generate best move"}
                        </Button>
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
                        disabled={generating}
                      >
                        <Sparkles className="h-4 w-4" />
                        {generating
                            ? "Generating plan..."
                            : "I’ve given enough context / Recalculate"}
                      </Button>
                    </div>
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
                situation={detail.situation}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type IntakeStep = "category" | "position" | "intake" | "move";

function IntakeStepper({ current }: { current: IntakeStep }) {
  const steps: Array<{ id: IntakeStep; label: string }> = [
    { id: "category", label: "Domain" },
    { id: "position", label: "Current position" },
    { id: "intake", label: "Interview" },
    { id: "move", label: "Best move" },
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
          href={`/boards/${tasks[0].situation_id ?? ""}`}
          className="mt-3 inline-flex text-sm font-medium text-[var(--azure-light)]"
        >
          View all related tasks
        </Link>
      ) : null}
    </Card>
  );
}

function DomainPicker({ onSelect }: { onSelect: (domain: EntryDomainId) => void }) {
  return (
    <>
      <h2 className="mb-3 text-xl font-semibold">Start a board</h2>
      <p className="mb-4 text-sm text-slate-400">
        Choose one entry point. It sets the starting board, not a rigid box.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {ENTRY_DOMAINS.map((domain) => {
          const Icon = entryDomainIcons[domain.id];
          return (
            <button
              key={domain.id}
              type="button"
              onClick={() => onSelect(domain.id)}
              className="rounded-lg border border-slate-800 bg-slate-900 p-4 text-left text-slate-200 transition hover:border-[var(--azure)]"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-[var(--azure-light)]">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-semibold text-white">{domain.title}</div>
              <p className="mt-2 text-sm text-slate-300">{domain.subtitle}</p>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SelectedDomainForm({
  category,
  description,
  setDescription,
  working,
  onSubmit,
}: {
  category: EntryDomainId;
  description: string;
  setDescription: (value: string) => void;
  working: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const Icon = entryDomainIcons[category];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.1)] p-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-[var(--azure-light)]">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-xs font-medium uppercase text-[var(--azure-light)]">
              Board
            </div>
            <div className="font-semibold text-white">{entryDomainTitle(category)}</div>
          </div>
        </div>
        <Link href="/" className="text-sm font-medium text-[var(--azure-light)] hover:text-white">
          Change domain
        </Link>
      </div>
      <form className="grid gap-4" onSubmit={onSubmit}>
        <Field label={domainFirstQuestions[category]}>
          <TextArea
            value={description}
            maxLength={SITUATION_DESCRIPTION_MAX}
            onChange={(event) => setDescription(event.target.value)}
            required
            placeholder={domainFirstAnswerPlaceholders[category]}
          />
          <CharacterCount value={description} max={SITUATION_DESCRIPTION_MAX} />
        </Field>
        <Button type="submit" disabled={working}>
          <Plus className="h-4 w-4" />
          {working ? "Starting..." : "Start intake"}
        </Button>
      </form>
    </div>
  );
}

function stageLabel(stage: string) {
  return stage.replaceAll("_", " ");
}
