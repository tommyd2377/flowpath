import { dataResponse, errorResponse, parseId } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createTasksFromNextMovePlanWithTelemetry } from "@/lib/task-conversion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const planId = parseId(idParam);
    const result = await createTasksFromNextMovePlanWithTelemetry(user.id, planId);
    return dataResponse(result, 201);
  } catch (error) {
    return errorResponse(error, "Could not turn this plan into tasks.");
  }
}
