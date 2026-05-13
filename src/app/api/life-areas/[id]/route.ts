import {
  ApiRequestError,
  dataResponse,
  emptyResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { deleteLifeArea, updateLifeArea } from "@/lib/repository";
import { lifeAreaInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const input = lifeAreaInputSchema.parse(await readJson(request));
    const updated = await updateLifeArea(id, input);
    if (!updated) throw new ApiRequestError("Life area not found.", 404, "not_found");
    return dataResponse(updated);
  } catch (error) {
    return errorResponse(error, "Could not update life area.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id: idParam } = await context.params;
    const deleted = await deleteLifeArea(parseId(idParam));
    if (!deleted) throw new ApiRequestError("Life area not found.", 404, "not_found");
    return emptyResponse();
  } catch (error) {
    return errorResponse(error, "Could not delete life area.");
  }
}
