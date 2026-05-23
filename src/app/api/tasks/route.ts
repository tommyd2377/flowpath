import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { isQaRequest } from "@/lib/qa-mode";
import { createTask, listTasks } from "@/lib/repository";
import { taskInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    return dataResponse(await listTasks(user.id, { isQa: isQaRequest(request) }));
  } catch (error) {
    return errorResponse(error, "Could not load tasks.");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = taskInputSchema.parse(await readJson(request));
    return dataResponse(await createTask(user.id, input, { isQa: isQaRequest(request) }), 201);
  } catch (error) {
    return errorResponse(error, "Could not create task.");
  }
}
