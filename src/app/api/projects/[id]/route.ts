import {
  ApiRequestError,
  dataResponse,
  emptyResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { deleteProject, updateProject } from "@/lib/repository";
import { projectInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const input = projectInputSchema.parse(await readJson(request));
    const updated = await updateProject(user.id, parseId(idParam), input);
    if (!updated) throw new ApiRequestError("Project not found.", 404, "not_found");
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not update project.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const deleted = await deleteProject(user.id, parseId(idParam));
    if (!deleted) throw new ApiRequestError("Project not found.", 404, "not_found");
    return emptyResponse();
  } catch (error) {
    return errorResponse(error, "Could not delete project.");
  }
}
