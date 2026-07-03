import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { inferMemoryCategoryFromText } from "@/lib/entry-domains";
import {
  createInferredContextItem,
  getTask,
  recordTaskFeedback,
} from "@/lib/repository";
import { taskFeedbackInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const taskId = parseId(idParam);
    const input = taskFeedbackInputSchema.parse(await readJson(request));
    const updated = await recordTaskFeedback(user.id, taskId, input);
    if (!updated) throw new ApiRequestError("Task not found.", 404, "not_found");
    const task = await getTask(user.id, taskId);
    if (task?.situation_id && input.notes.trim()) {
      await createInferredContextItem(user.id, {
        label: "Task feedback",
        value: input.notes,
        category: inferMemoryCategoryFromText(input.notes),
        sensitivity: "low",
        persistence: "proposed_memory",
        source: "intake",
        situation_id: task.situation_id,
        intake_session_id: null,
        next_move_plan_id: task.source_next_move_plan_id ?? null,
      });
    }
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not save task feedback.");
  }
}
