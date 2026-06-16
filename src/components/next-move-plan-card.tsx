"use client";

import Link from "next/link";
import { ArrowRight, Check, CheckCircle2, CheckSquare, Clock, Info, Pencil, ShieldAlert, Target, ThumbsDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { apiFetch } from "@/lib/client-api";
import { readClientQaMode } from "@/lib/qa-mode";
import type { StoredNextMovePlan, Task, TaskConversionResponse } from "@/lib/types";
import { FlowPathMarkdown } from "./flowpath-markdown";
import { Button, Card, EmptyState } from "./ui";

export function modeLabel(mode: string) {
  return mode.replace("_", "/");
}

export function NextMovePlanCard({
  plan,
  fallbackTask,
  primaryTask,
  onConvert,
  converting,
  tasksAdded,
  taskConfirmation,
}: {
  plan: StoredNextMovePlan | null;
  fallbackTask?: Task | null;
  primaryTask?: Task | null;
  onConvert?: () => void;
  converting?: boolean;
  tasksAdded?: boolean;
  taskConfirmation?: TaskConversionResponse | null;
}) {
  const showCognitiveDebug = useCognitiveDebugVisible();
  const displayedTask = primaryTask ?? fallbackTask ?? null;

  if (!plan) {
    if (fallbackTask) {
      return (
        <Card className="grid gap-4">
          <div>
            <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
              Current move
            </div>
            <h2 className="mt-1 text-2xl font-semibold text-white">
              {fallbackTask.title}
            </h2>
            {fallbackTask.notes ? (
              <FlowPathMarkdown
                content={fallbackTask.notes}
                mode="static"
                variant="compact"
                className="mt-2"
              />
            ) : null}
          </div>
          <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
            <Brief title="Status" value={fallbackTask.status} />
            <Brief title="Importance" value={`${fallbackTask.importance}/5`} />
            <Brief title="Effort" value={`${fallbackTask.effort}/5`} />
          </div>
          <p className="text-sm text-slate-400">
            This is the top related task for this situation. Generate a next move
            plan when you want the fuller reasoning and step breakdown.
          </p>
        </Card>
      );
    }

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
            Do this next
          </div>
          <h2 className="mt-1 text-2xl font-semibold text-white">
            {displayedTask?.title ?? plan.highest_leverage_move_today.title}
          </h2>
          <FlowPathMarkdown
            content={
              displayedTask?.rank_reason ||
              displayedTask?.notes ||
              plan.highest_leverage_move_today.description
            }
            mode="static"
            variant="compact"
            className="mt-2"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {displayedTask ? (
            <>
              <Badge>importance {displayedTask.importance}/5</Badge>
              <Badge>effort {displayedTask.effort}/5</Badge>
              {displayedTask.estimated_minutes ? (
                <Badge>{displayedTask.estimated_minutes} min</Badge>
              ) : null}
            </>
          ) : null}
          <span className="rounded-md bg-[rgba(0,120,212,0.18)] px-2 py-1 text-xs font-medium text-blue-100">
            {modeLabel(plan.mode)}
          </span>
          <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
            {plan.confidence_level} confidence
          </span>
        </div>
      </div>

      <TaskAction
        onConvert={onConvert}
        converting={converting}
        tasksAdded={tasksAdded}
      />

      <div className="flex flex-wrap gap-2">
        <Link href="/">
          <Button type="button">
            <ArrowRight className="h-4 w-4" />
            Go to Today&apos;s Next Move
          </Button>
        </Link>
        <Link href="/">
          <Button type="button" variant="secondary">
            <CheckSquare className="h-4 w-4" />
            Report outcome after you do it
          </Button>
        </Link>
      </div>

      {taskConfirmation ? <TaskConfirmation result={taskConfirmation} /> : null}

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Brief title="Bottleneck" value={plan.core_bottleneck} />
        <Brief
          title="First 10 minutes"
          value={`${plan.first_10_minute_action.title}: ${plan.first_10_minute_action.details}`}
        />
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Brief title="Why this move" value={plan.why_this_move} />
        <ListBlock title="What not to waste time on" items={plan.what_not_to_do} />
      </div>

      <SafetyBoundaryBlock plan={plan} elevatedOnly />

      <details className="rounded-lg border border-slate-800 bg-slate-900/65 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          Full plan details
        </summary>
        <div className="mt-4 grid gap-5">
          {!displayedTask ? <SuggestedNextAction plan={plan} /> : null}

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Brief title="Current reality" value={plan.situation_summary} />
            <Brief title="Likely trap" value={plan.likely_trap} />
            <Brief
              title={plan.restraint_guidance.should_push ? "Push signal" : "Restraint signal"}
              value={plan.restraint_guidance.reason}
            />
            <Brief title="Friction pattern" value={plan.friction_pattern} />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Mentor insight</h3>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Brief title="Naive path" value={plan.operator_insight.naive_path} />
              <Brief
                title="Higher-leverage path"
                value={plan.operator_insight.operator_path}
              />
              <Brief
                title="Wasted motion to avoid"
                value={plan.operator_insight.wasted_motion_to_avoid}
              />
            </div>
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

          <ContextUsedBlock plan={plan} />

          {showCognitiveDebug ? <WhyThisResponseBlock plan={plan} /> : null}

          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <ListBlock
              title="Why this plan"
              items={plan.recommendation_basis.map(
                (basis) => `${basis.signal} (${basis.source}): ${basis.implication}`,
              )}
            />
            <ListBlock
              title="Restraint rails"
              items={[
                plan.restraint_guidance.minimum_viable_move,
                plan.restraint_guidance.scope_boundary,
                plan.restraint_guidance.recovery_move,
              ]}
            />
            <ListBlock title="Assumptions" items={plan.assumptions} />
          </div>

          <LocalScoutBlock plan={plan} />

          <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4 w-4" />
              When to get human help
            </div>
            <p>{plan.when_to_get_human_help}</p>
          </div>

          <SafetyBoundaryBlock plan={plan} />

          {plan.resources_to_seek.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Resources to seek</h3>
              <div className="grid gap-2">
                {plan.resources_to_seek.map((resource) => (
                  <div
                    key={`${resource.name}-${resource.contact_or_url ?? ""}`}
                    className="rounded-md bg-slate-950 p-3 text-sm"
                  >
                    <div className="font-medium text-white">{resource.name}</div>
                    <FlowPathMarkdown
                      content={resource.why}
                      mode="static"
                      variant="compact"
                      className="text-slate-300"
                    />
                    {resource.contact_or_url ? (
                      isWebUrl(resource.contact_or_url) ? (
                        <a
                          href={resource.contact_or_url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex break-all text-[var(--azure-light)] hover:text-white"
                        >
                          {resource.contact_or_url}
                        </a>
                      ) : (
                        <div className="mt-2 break-words text-slate-400">
                          {resource.contact_or_url}
                        </div>
                      )
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </Card>
  );
}

function useCognitiveDebugVisible() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    function refresh() {
      setEnabled(
        process.env.NODE_ENV !== "production" ||
          process.env.NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG === "true" ||
          readClientQaMode(),
      );
    }

    refresh();
    window.addEventListener("flowpath-qa-mode-change", refresh);
    return () => window.removeEventListener("flowpath-qa-mode-change", refresh);
  }, []);

  return enabled;
}

type SuggestedActionState = {
  state: "available" | "accepted" | "dismissed" | "not_useful" | "ignored" | "completed";
  task: Task | null;
  original: {
    title: string;
    description: string;
    estimatedMinutes: number | null;
  };
};

function SuggestedNextAction({ plan }: { plan: StoredNextMovePlan }) {
  const firstTask = plan.task_candidates[0];
  const defaultOriginal: SuggestedActionState["original"] = {
    title: firstTask?.title ?? plan.first_10_minute_action.title,
    description: firstTask?.description || firstTask?.details || plan.first_10_minute_action.details,
    estimatedMinutes:
      firstTask?.estimated_minutes ??
      plan.highest_leverage_move_today.estimated_minutes ??
      null,
  };
  const [state, setState] = useState<SuggestedActionState>({
    state: "available",
    task: null,
    original: defaultOriginal,
  });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(defaultOriginal);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiFetch<SuggestedActionState>(`/api/next-move-plans/${plan.id}/suggested-action`)
      .then((result) => {
        if (!active) return;
        setState(result);
        setForm(result.task
          ? {
              title: result.task.title,
              description: result.task.notes,
              estimatedMinutes: result.task.estimated_minutes ?? result.original.estimatedMinutes,
            }
          : result.original);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [plan.id]);

  async function submit(action: "accept" | "edit" | "dismiss" | "complete" | "not_useful") {
    setSaving(true);
    setMessage(null);
    try {
      const result = await apiFetch<SuggestedActionState>(
        `/api/next-move-plans/${plan.id}/suggested-action`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "edit"
              ? {
                  action,
                  title: form.title,
                  description: form.description,
                  estimatedMinutes: form.estimatedMinutes,
                }
              : { action },
          ),
        },
      );
      setState(result);
      setEditing(false);
      setMessage(
        action === "accept"
          ? "Accepted."
          : action === "edit"
            ? "Saved."
            : action === "complete"
              ? "Marked done."
              : "Feedback saved.",
      );
    } catch {
      setMessage("Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (["dismissed", "not_useful", "ignored"].includes(state.state)) {
    return null;
  }

  return (
    <div className="rounded-lg border border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.1)] p-3 text-sm text-blue-50">
      <div className="mb-1 flex items-center gap-2 font-medium text-white">
        <Target className="h-4 w-4" />
        Suggested next action
      </div>
      {editing ? (
        <div className="grid gap-2">
          <input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            className="min-h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
          />
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((current) => ({ ...current, description: event.target.value }))
            }
            className="min-h-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
          />
          <input
            type="number"
            min={1}
            max={480}
            value={form.estimatedMinutes ?? ""}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                estimatedMinutes: event.target.value ? Number(event.target.value) : null,
              }))
            }
            className="min-h-9 w-32 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-white"
          />
        </div>
      ) : (
        <>
          <div className="font-medium">
            {state.task?.title ?? firstTask?.title ?? plan.first_10_minute_action.title}
          </div>
          <p className="mt-1 text-blue-100">
            {firstTask?.success_condition
              ? `${firstTask.description || firstTask.details} Success: ${firstTask.success_condition}`
              : plan.first_10_minute_action.details}
          </p>
        </>
      )}
      {firstTask ? (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-blue-100">
          <Badge>{firstTask.estimated_minutes} min</Badge>
          <Badge>{firstTask.leverage} leverage</Badge>
          <Badge>{firstTask.friction_level} friction</Badge>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {editing ? (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit("edit")}
              className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--azure)] px-3 text-white"
            >
              <Check className="h-4 w-4" />
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </>
        ) : (
          <>
            {state.state !== "accepted" && state.state !== "completed" ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => submit("accept")}
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--azure)] px-3 text-white"
              >
                <Check className="h-4 w-4" />
                Accept
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(true)}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200 hover:border-[var(--azure)]"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
            {state.state !== "completed" ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => submit("complete")}
                className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200 hover:border-[var(--azure)]"
              >
                <CheckCircle2 className="h-4 w-4" />
                Mark done
              </button>
            ) : null}
            <button
              type="button"
              disabled={saving}
              onClick={() => submit("dismiss")}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200 hover:border-[var(--azure)]"
            >
              <X className="h-4 w-4" />
              Dismiss
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit("not_useful")}
              className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-700 px-3 text-slate-200 hover:border-[var(--azure)]"
            >
              <ThumbsDown className="h-4 w-4" />
              Not useful
            </button>
          </>
        )}
      </div>
      {message ? <div className="mt-2 text-xs text-blue-100">{message}</div> : null}
    </div>
  );
}

function WhyThisResponseBlock({ plan }: { plan: StoredNextMovePlan }) {
  const metadata = plan.cognitive_metadata;
  if (!metadata) return null;

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/65 p-3 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-white">
        <Info className="h-4 w-4 text-[var(--azure-light)]" />
        Why this response?
      </summary>
      <div className="mt-3 grid gap-2 text-slate-300 sm:grid-cols-2">
        <Brief
          title="Detected mode"
          value={metadata.state_detection.primary_state.replaceAll("_", " ")}
        />
        <Brief
          title="Intervention"
          value={metadata.intervention.intervention_type.replaceAll("_", " ")}
        />
        <Brief
          title="Evaluator"
          value={
            metadata.evaluator
              ? `${Math.round(metadata.evaluator.score * 100)}%${metadata.response_rewritten ? " · rewritten once" : ""}`
              : "Not evaluated"
          }
        />
        <Brief
          title="Used context"
          value={`${metadata.memory_selection.selected_memories.length} selected item${
            metadata.memory_selection.selected_memories.length === 1 ? "" : "s"
          }`}
        />
        <Brief
          title="Web search"
          value={`${metadata.web_search_used ? "Used" : "Not used"}: ${metadata.web_search_reason}`}
        />
      </div>
    </details>
  );
}

function TaskAction({
  onConvert,
  converting,
  tasksAdded,
}: {
  onConvert?: () => void;
  converting?: boolean;
  tasksAdded?: boolean;
}) {
  if (tasksAdded) {
    return (
      <div>
        <Link href="/tasks">
          <Button type="button" variant="secondary">
            <CheckSquare className="h-4 w-4" />
            View ranked startup tasks
          </Button>
        </Link>
      </div>
    );
  }

  if (!onConvert) return null;

  return (
    <div>
      <Button type="button" onClick={onConvert} disabled={converting}>
        <CheckSquare className="h-4 w-4" />
        {converting ? "Creating startup tasks..." : "Create ranked startup tasks from this plan"}
      </Button>
    </div>
  );
}

function TaskConfirmation({ result }: { result: TaskConversionResponse }) {
  return (
    <div className="rounded-lg border border-[rgba(0,120,212,0.45)] bg-[rgba(0,120,212,0.12)] p-3 text-sm text-blue-100">
      <div className="font-medium text-white">
        {result.alreadyExisted
          ? "These tasks were already added. No duplicates created."
          : `Added ${result.items.length} ranked startup tasks`}
      </div>
      <div className="mt-2 grid gap-1">
        {result.items.map((item) => (
          <div key={item.task.id} className="text-blue-50">
            #{item.globalRank} {item.task.title}
          </div>
        ))}
      </div>
      <Link
        href="/tasks"
        className="mt-3 inline-flex text-sm font-medium text-[var(--azure-light)] hover:text-white"
      >
        View ranked startup tasks
      </Link>
    </div>
  );
}

function ContextUsedBlock({ plan }: { plan: StoredNextMovePlan }) {
  const items =
    plan.context_used.length > 0
      ? plan.context_used
      : plan.inferred_context_items.map((item) => ({
          id: null,
          label: item.label,
          value: item.value,
          category: "other" as const,
          sensitivity: item.sensitivity,
          source: "inferred" as const,
          persistence: item.persistence,
        }));

  if (items.length === 0) return null;

  return (
    <details className="rounded-lg border border-slate-800 bg-slate-900/65 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-white">
        Context FlowPath used
      </summary>
      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <div key={`${item.label}-${item.value}`} className="rounded-md bg-slate-950 p-3">
            <div className="flex flex-wrap gap-2">
              <Badge>{item.category.replaceAll("_", " ")}</Badge>
              <Badge>{item.sensitivity} sensitivity</Badge>
              <Badge>{item.source.replaceAll("_", " ")}</Badge>
              <Badge>{item.persistence.replaceAll("_", " ")}</Badge>
            </div>
            <div className="mt-2 font-medium text-white">{item.label}</div>
            <FlowPathMarkdown
              content={item.value}
              mode="static"
              variant="compact"
              className="text-slate-300"
            />
          </div>
        ))}
      </div>
      <Link
        href="/memory"
        className="mt-3 inline-flex text-sm font-medium text-[var(--azure-light)] hover:text-white"
      >
        Edit or delete context in Memory
      </Link>
    </details>
  );
}

function LocalScoutBlock({ plan }: { plan: StoredNextMovePlan }) {
  const scout = plan.local_reality_scout;

  if (scout.findings.length > 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3 text-sm">
        <div className="font-medium text-white">
          Local scout{scout.location_basis ? `: ${scout.location_basis}` : ""}
        </div>
        <div className="mt-2 grid gap-2">
          {scout.findings.map((finding) => (
            <div key={`${finding.title}-${finding.source}`}>
              <div className="font-medium text-slate-100">{finding.title}</div>
              <p className="text-slate-300">{finding.why_it_matters}</p>
              <p className="break-words text-slate-400">
                {finding.source}
                {finding.url_or_next_search ? ` - ${finding.url_or_next_search}` : ""}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Brief
      title="Local scout"
      value={
        scout.missing_location_question ||
        (scout.used_web_search
          ? "No useful local finding changed this plan."
          : "No current local lookup was needed for this plan.")
      }
    />
  );
}

function SafetyBoundaryBlock({
  plan,
  elevatedOnly = false,
}: {
  plan: StoredNextMovePlan;
  elevatedOnly?: boolean;
}) {
  const isElevatedRisk =
    plan.safety_boundary.risk_level === "high" ||
    plan.safety_boundary.risk_level === "crisis";
  if (elevatedOnly && !isElevatedRisk) return null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/65 p-3 text-sm">
      <div className="font-medium text-white">
        Safety boundary: {plan.safety_boundary.risk_level}
      </div>
      <div className="mt-2 grid gap-2 text-slate-300">
        <FlowPathMarkdown
          content={plan.safety_boundary.professional_help_signal}
          mode="static"
          variant="compact"
        />
        <FlowPathMarkdown
          content={plan.safety_boundary.do_not_rely_on_ai_for}
          mode="static"
          variant="compact"
        />
        {isElevatedRisk ? (
          <FlowPathMarkdown
            content={plan.safety_boundary.urgent_support_guidance}
            mode="static"
            variant="compact"
          />
        ) : null}
      </div>
    </div>
  );
}

function Brief({ title, value }: { title: string; value: string }) {
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
            <FlowPathMarkdown
              content={step.details}
              mode="static"
              variant="compact"
              className="text-slate-300"
            />
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
        {items.length ? (
          items.map((item) => (
            <li key={item}>
              <FlowPathMarkdown content={item} mode="static" variant="compact" />
            </li>
          ))
        ) : (
          <li>None listed.</li>
        )}
      </ul>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300">
      {children}
    </span>
  );
}

function isWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
