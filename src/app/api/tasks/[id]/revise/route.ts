import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  assertCanUseFeature,
  canUseFeature,
  incrementUsage,
} from "@/lib/billing/usage";
import { generateTaskRevision } from "@/lib/flowpath-ai";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import {
  completeGenerationEvent,
  getTask,
  startGenerationEvent,
  updateTask,
} from "@/lib/repository";
import { taskRevisionInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const clientGenerationId = `server-task-revision-${crypto.randomUUID()}`;
  let userId: number | null = null;
  let generationEventCompleted = false;

  try {
    const user = await requireUser();
    userId = user.id;
    const { id: idParam } = await context.params;
    const taskId = parseId(idParam);
    const input = taskRevisionInputSchema.parse(await readJson(request));
    const task = await getTask(user.id, taskId);
    if (!task) throw new ApiRequestError("Task not found.", 404, "not_found");
    const usageDecision = await canUseFeature(user.id, "lightweight_assist");

    await startGenerationEvent(user.id, {
      client_generation_id: clientGenerationId,
      generation_type: "task_generation",
      task_id: task.id,
      situation_id: task.situation_id ?? null,
      plan_id: task.source_next_move_plan_id ?? null,
      flow_type: "task_revision",
      flow_status: "running",
      model_role: "revision_standard",
      quota_tier: usageDecision.planTier,
      quota_usage_type: "lightweight_assist",
      structural_counts: {
        instruction_chars: input.instructions.length,
        task_title_chars: task.title.length,
        task_notes_chars: task.notes.length,
        intent_couldnt_complete: input.intent === "couldnt_complete",
      },
      is_qa: Boolean(task.is_qa),
    });
    if (!usageDecision.allowed) {
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        flowStatus: "quota_blocked",
        taskId: task.id,
        quotaTier: usageDecision.planTier,
        quotaUsageType: "lightweight_assist",
        errorCategory: "quota_exceeded",
        errorMessageSanitized: "The user reached the lightweight assist quota.",
      });
      generationEventCompleted = true;
      await assertCanUseFeature(user.id, "lightweight_assist");
    }

    let generated;
    try {
      generated = await generateTaskRevision({
        task,
        instructions: input.instructions,
        intent: input.intent,
      });
    } catch (error) {
      const sanitized = sanitizeGenerationError(error);
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        flowStatus: "error",
        taskId: task.id,
        errorCategory: sanitized.errorCategory,
        errorMessageSanitized: sanitized.errorMessageSanitized,
      });
      generationEventCompleted = true;
      throw error;
    }
    await incrementUsage(user.id, "lightweight_assist", generated.usage ?? {});

    const updated = await updateTask(user.id, task.id, {
      title: generated.revision.title,
      life_area_id: task.life_area_id,
      project_id: task.project_id,
      status: task.status,
      importance: generated.revision.importance,
      effort: generated.revision.effort,
      friction_type: generated.revision.friction_type,
      friction_note: generated.revision.friction_note,
      estimated_minutes: generated.revision.estimated_minutes,
      due_date: generated.revision.due_date,
      notes: generated.revision.notes,
    });
    if (!updated) throw new ApiRequestError("Task not found.", 404, "not_found");

    await completeGenerationEvent(user.id, clientGenerationId, {
      status: "success",
      flowStatus: "success",
      taskId: updated.id,
      planId: updated.source_next_move_plan_id ?? null,
      model: generated.model,
      modelRole: generated.modelRole,
      inputTokens: generated.usage?.inputTokens,
      cachedInputTokens: generated.usage?.cachedInputTokens,
      outputTokens: generated.usage?.outputTokens,
      totalTokens: generated.usage?.totalTokens,
      estimatedCostUsd: generated.usage?.estimatedCostUsd,
      responseRewritten: true,
      structuralCounts: {
        instruction_chars: input.instructions.length,
        revised_title_chars: updated.title.length,
        revised_notes_chars: updated.notes.length,
        intent_couldnt_complete: input.intent === "couldnt_complete",
      },
    });
    generationEventCompleted = true;

    return dataResponse(updated);
  } catch (error) {
    if (userId && !generationEventCompleted) {
      const sanitized = sanitizeGenerationError(error);
      await completeGenerationEvent(userId, clientGenerationId, {
        status: "error",
        flowStatus: "error",
        errorCategory: sanitized.errorCategory,
        errorMessageSanitized: sanitized.errorMessageSanitized,
      }).catch(() => {});
    }
    return errorResponse(error, "Could not revise task.");
  }
}
