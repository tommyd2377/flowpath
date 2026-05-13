import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { createTask, listTasks } from "@/lib/repository";
import { taskInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return dataResponse(await listTasks());
  } catch (error) {
    return errorResponse(error, "Could not load tasks.");
  }
}

export async function POST(request: Request) {
  try {
    const input = taskInputSchema.parse(await readJson(request));
    return dataResponse(await createTask(input), 201);
  } catch (error) {
    return errorResponse(error, "Could not create task.");
  }
}
