import { z } from "zod";

import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { buildIntakeRoutingMetadata } from "@/lib/intake";
import {
  createOutcomeHarnessEvent,
  getNextMovePlan,
  getSituation,
  getSuggestedActionTaskForPlan,
  listOutcomeHarnessEventsForPlan,
  saveSuggestedActionTask,
  updateOutcomeForNextMovePlan,
} from "@/lib/repository";
import { taskEditDiffSchema } from "@/lib/outcome-harness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const suggestedActionSchema = z.object({
  action: z.enum(["accept", "edit", "dismiss", "complete", "not_useful"]),
  title: z.string().trim().max(220).optional(),
  description: z.string().trim().max(5000).optional(),
  estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
});

async function planContext(userId: number, planId: number) {
  const plan = await getNextMovePlan(userId, planId);
  if (!plan) throw new ApiRequestError("Plan not found.", 404, "not_found");
  const situation = await getSituation(userId, plan.situation_id);
  const intakeRouting = situation ? buildIntakeRoutingMetadata(situation) : null;
  return { plan, situation, intakeRouting };
}

function originalSuggestedAction(plan: Awaited<ReturnType<typeof getNextMovePlan>>) {
  if (!plan) {
    return {
      title: "",
      description: "",
      estimatedMinutes: null as number | null,
    };
  }
  const firstTask = plan.task_candidates[0];
  return {
    title: firstTask?.title || plan.first_10_minute_action.title,
    description:
      firstTask?.description ||
      firstTask?.details ||
      plan.first_10_minute_action.details,
    estimatedMinutes:
      firstTask?.estimated_minutes ??
      plan.highest_leverage_move_today.estimated_minutes ??
      null,
  };
}

async function writeSuggestedEvent(
  userId: number,
  planId: number,
  eventType:
    | "suggested_action_accepted"
    | "suggested_action_edited"
    | "suggested_action_dismissed"
    | "suggested_action_completed"
    | "user_reported_not_helpful"
    | "task_completed"
    | "task_edited",
  metadata: Record<string, unknown>,
  taskId?: number | null,
  dedupeKey?: string,
) {
  const { plan, intakeRouting } = await planContext(userId, planId);
  return createOutcomeHarnessEvent(userId, {
    situationId: plan.situation_id,
    conversationId: String(plan.situation_id),
    taskId: taskId ?? null,
    planId,
    eventType,
    source: eventType.startsWith("task_") ? "task_deck" : "suggested_action",
    stateDetected: plan.cognitive_metadata?.state_detection.primary_state ?? null,
    interventionType: plan.cognitive_metadata?.intervention.intervention_type ?? null,
    domain: intakeRouting?.domain ?? null,
    subtype: intakeRouting?.subtype ?? null,
    questionPurpose: intakeRouting?.questionPurpose ?? null,
    modelUsed: plan.model,
    metadata,
    dedupeKey,
    isQa: Boolean(plan.is_qa),
  });
}

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const planId = parseId(idParam);
    const { plan } = await planContext(user.id, planId);
    const [events, task] = await Promise.all([
      listOutcomeHarnessEventsForPlan(user.id, planId),
      getSuggestedActionTaskForPlan(user.id, planId),
    ]);
    const terminal = events.find((event) =>
      [
        "suggested_action_dismissed",
        "user_reported_not_helpful",
        "suggested_action_ignored",
      ].includes(event.event_type),
    );
    const state = task?.status === "done"
      ? "completed"
      : terminal?.event_type === "suggested_action_dismissed"
        ? "dismissed"
        : terminal?.event_type === "user_reported_not_helpful"
          ? "not_useful"
          : terminal?.event_type === "suggested_action_ignored"
            ? "ignored"
            : task
              ? "accepted"
              : "available";
    return dataResponse({
      state,
      task,
      original: originalSuggestedAction(plan),
    });
  } catch (error) {
    return errorResponse(error, "Could not load suggested action state.");
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const planId = parseId(idParam);
    const { plan } = await planContext(user.id, planId);
    const input = suggestedActionSchema.parse(await readJson(request));
    const original = originalSuggestedAction(plan);

    if (input.action === "dismiss") {
      await writeSuggestedEvent(
        user.id,
        planId,
        "suggested_action_dismissed",
        {
          title: original.title,
          estimatedMinutes: original.estimatedMinutes,
        },
        null,
        `suggested-action-dismissed:${planId}`,
      );
      return dataResponse({ state: "dismissed", task: null });
    }

    if (input.action === "not_useful") {
      await updateOutcomeForNextMovePlan(user.id, planId, {
        user_outcome: "rejected",
        evidence: "Manual feedback: suggested action was not useful.",
        notes: "Manual lightweight feedback from the suggested action card.",
      }).catch(() => null);
      await writeSuggestedEvent(
        user.id,
        planId,
        "user_reported_not_helpful",
        {
          title: original.title,
          estimatedMinutes: original.estimatedMinutes,
        },
        null,
        `suggested-action-not-useful:${planId}`,
      );
      return dataResponse({ state: "not_useful", task: null });
    }

    const status = input.action === "complete" ? "done" : "open";
    const saved = await saveSuggestedActionTask(user.id, planId, {
      title: input.title,
      description: input.description,
      estimatedMinutes: input.estimatedMinutes,
      status,
    });
    const task = saved.task;

    if (input.action === "edit") {
      const diff = taskEditDiffSchema.parse({
        originalTitle: original.title,
        newTitle: task.title,
        originalDescription: original.description,
        newDescription: input.description ?? task.notes,
        changedFields: [
          original.title !== task.title ? "title" : "",
          original.description !== (input.description ?? task.notes)
            ? "description"
            : "",
          original.estimatedMinutes !== (task.estimated_minutes ?? null)
            ? "estimated_minutes"
            : "",
        ].filter(Boolean),
        estimatedMinutesBefore: original.estimatedMinutes,
        estimatedMinutesAfter: task.estimated_minutes ?? null,
      });
      await writeSuggestedEvent(
        user.id,
        planId,
        "suggested_action_edited",
        diff,
        task.id,
      );
      await writeSuggestedEvent(user.id, planId, "task_edited", diff, task.id);
      return dataResponse({ state: task.status === "done" ? "completed" : "accepted", task });
    }

    if (input.action === "complete") {
      await writeSuggestedEvent(
        user.id,
        planId,
        "suggested_action_completed",
        {
          title: task.title,
          estimatedMinutes: task.estimated_minutes ?? null,
        },
        task.id,
        `suggested-action-completed:${planId}`,
      );
      await writeSuggestedEvent(
        user.id,
        planId,
        "task_completed",
        {
          title: task.title,
          estimatedMinutes: task.estimated_minutes ?? null,
        },
        task.id,
        `suggested-action-task-completed:${task.id}`,
      );
      return dataResponse({ state: "completed", task });
    }

    await writeSuggestedEvent(
      user.id,
      planId,
      "suggested_action_accepted",
      {
        title: task.title,
        estimatedMinutes: task.estimated_minutes ?? null,
        createdTask: saved.created,
      },
      task.id,
      `suggested-action-accepted:${planId}`,
    );
    return dataResponse({ state: "accepted", task });
  } catch (error) {
    return errorResponse(error, "Could not update suggested action.");
  }
}
