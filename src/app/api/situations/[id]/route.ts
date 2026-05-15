import {
  ApiRequestError,
  dataResponse,
  emptyResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  deleteSituation,
  getLatestIntakeSession,
  getLatestNextMovePlan,
  getOrCreateIntakeSession,
  getSituation,
  listIntakeMessages,
  listNextMovePlans,
  listTasksForSituation,
  updateSituation,
} from "@/lib/repository";
import { situationUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function situationDetail(userId: number, id: number) {
  const situation = await getSituation(userId, id);
  if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
  const session =
    (await getLatestIntakeSession(userId, id)) ??
    (await getOrCreateIntakeSession(userId, id));
  const [messages, latestPlan, plans, tasks] = await Promise.all([
    listIntakeMessages(userId, session.id),
    getLatestNextMovePlan(userId, id),
    listNextMovePlans(userId, 10, id),
    listTasksForSituation(userId, id),
  ]);
  return { situation, session, messages, latestPlan, plans, tasks };
}

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    return dataResponse(await situationDetail(user.id, parseId(idParam)));
  } catch (error) {
    return errorResponse(error, "Could not load situation.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const input = situationUpdateSchema.parse(await readJson(request));
    const situation = await updateSituation(user.id, id, input);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    return dataResponse(await situationDetail(user.id, id));
  } catch (error) {
    return errorResponse(error, "Could not update situation.");
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const deleted = await deleteSituation(user.id, parseId(idParam));
    if (!deleted) throw new ApiRequestError("Situation not found.", 404, "not_found");
    return emptyResponse();
  } catch (error) {
    return errorResponse(error, "Could not delete situation.");
  }
}
