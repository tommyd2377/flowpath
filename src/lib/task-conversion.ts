import { sanitizeGenerationError } from "./generation-observability";
import {
  completeGenerationEvent,
  createTasksFromNextMovePlan,
  getNextMovePlan,
  startGenerationEvent,
  type TaskConversionResult,
} from "./repository";

export async function createTasksFromNextMovePlanWithTelemetry(
  userId: number,
  planId: number,
  {
    clientGenerationId = `server-task-conversion-${crypto.randomUUID()}`,
  }: { clientGenerationId?: string } = {},
): Promise<TaskConversionResult> {
  const plan = await getNextMovePlan(userId, planId);
  const baseStructuralCounts = {
    plan_found: Boolean(plan),
    task_candidate_count: plan?.task_candidates.length ?? 0,
  };

  await startGenerationEvent(userId, {
    client_generation_id: clientGenerationId,
    generation_type: "task_generation",
    plan_id: planId,
    situation_id: plan?.situation_id ?? null,
    flow_type: "task_generation",
    flow_status: "running",
    model_role: "deterministic",
    structural_counts: baseStructuralCounts,
    is_qa: Boolean(plan?.is_qa),
  });

  try {
    const result = await createTasksFromNextMovePlan(userId, planId);
    const generatedTaskCount = result.created ? result.items.length : 0;
    await completeGenerationEvent(userId, clientGenerationId, {
      status: "success",
      flowStatus: "success",
      planId,
      model: "deterministic-task-converter",
      modelRole: "deterministic",
      tasksCreatedCount: generatedTaskCount,
      structuralCounts: {
        ...baseStructuralCounts,
        already_existed: result.alreadyExisted,
        returned_task_count: result.items.length,
        generated_task_count: generatedTaskCount,
      },
    });
    return result;
  } catch (error) {
    const sanitized = sanitizeGenerationError(error);
    await completeGenerationEvent(userId, clientGenerationId, {
      status: "error",
      flowStatus: "error",
      planId,
      model: "deterministic-task-converter",
      modelRole: "deterministic",
      errorCategory: sanitized.errorCategory,
      errorMessageSanitized: sanitized.errorMessageSanitized,
      structuralCounts: {
        ...baseStructuralCounts,
        generated_task_count: 0,
      },
    });
    throw error;
  }
}
