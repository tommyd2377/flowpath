import { dataResponse, errorResponse, parseId } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createTasksFromNextMovePlan } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    return dataResponse(
      await createTasksFromNextMovePlan(user.id, parseId(idParam)),
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not turn this plan into tasks.");
  }
}
