import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { recordTaskFeedback } from "@/lib/repository";
import { taskFeedbackInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const input = taskFeedbackInputSchema.parse(await readJson(request));
    const updated = await recordTaskFeedback(user.id, parseId(idParam), input);
    if (!updated) throw new ApiRequestError("Task not found.", 404, "not_found");
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not save task feedback.");
  }
}
