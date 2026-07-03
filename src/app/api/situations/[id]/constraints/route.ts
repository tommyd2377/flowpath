import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  getOrCreateIntakeSession,
  getSituation,
  mergeProfileContextConstraints,
  updateIntakeSessionConstraints,
} from "@/lib/repository";
import { contextConstraintsInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Board not found.", 404, "not_found");

    const input = contextConstraintsInputSchema.parse(await readJson(request));
    const profile = await mergeProfileContextConstraints(
      user.id,
      input.context_constraints,
    );

    const session = await getOrCreateIntakeSession(user.id, situationId);
    const updatedSession = await updateIntakeSessionConstraints(
      user.id,
      session.id,
      input.context_constraints,
    );
    if (!updatedSession) {
      throw new ApiRequestError("Intake session not found.", 404, "not_found");
    }

    return dataResponse({ session: updatedSession, profile });
  } catch (error) {
    return errorResponse(error, "Could not save constraint context.");
  }
}
