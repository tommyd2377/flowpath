import { dataResponse, errorResponse, parseId } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { sanitizeGenerationError } from "@/lib/generation-observability";
import {
  completeGenerationEvent,
  createTasksFromNextMovePlan,
  getNextMovePlan,
  startGenerationEvent,
} from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const planId = parseId(idParam);
    const plan = await getNextMovePlan(user.id, planId);
    const clientGenerationId = `server-task-conversion-${crypto.randomUUID()}`;
    await startGenerationEvent(user.id, {
      client_generation_id: clientGenerationId,
      generation_type: "task_generation",
      plan_id: planId,
      situation_id: plan?.situation_id ?? null,
      flow_type: "task_generation",
      flow_status: "running",
      model_role: "deterministic",
      structural_counts: {
        plan_found: Boolean(plan),
        task_candidate_count: plan?.task_candidates.length ?? 0,
      },
      is_qa: Boolean(plan?.is_qa),
    });
    try {
      const result = await createTasksFromNextMovePlan(user.id, planId);
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "success",
        flowStatus: "success",
        planId,
        model: "deterministic-task-converter",
        modelRole: "deterministic",
        tasksCreatedCount: result.created ? result.items.length : 0,
        structuralCounts: {
          already_existed: result.alreadyExisted,
          returned_task_count: result.items.length,
        },
      });
      return dataResponse(result, 201);
    } catch (error) {
      const sanitized = sanitizeGenerationError(error);
      await completeGenerationEvent(user.id, clientGenerationId, {
        status: "error",
        flowStatus: "error",
        planId,
        model: "deterministic-task-converter",
        modelRole: "deterministic",
        errorCategory: sanitized.errorCategory,
        errorMessageSanitized: sanitized.errorMessageSanitized,
      });
      throw error;
    }
  } catch (error) {
    return errorResponse(error, "Could not turn this plan into tasks.");
  }
}
