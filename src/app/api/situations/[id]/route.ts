import {
  ApiRequestError,
  dataResponse,
  emptyResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { buildFirstIntakePlan } from "@/lib/intake";
import { isQaRequest } from "@/lib/qa-mode";
import {
  createOutcomeHarnessEvent,
  deleteSituation,
  getLatestIntakeSession,
  getLatestNextMovePlan,
  getOrCreateIntakeSession,
  getSituation,
  listIntakeMessages,
  listNextMovePlans,
  listTasksForSituation,
  recordIgnoredSuggestedActions,
  updateSituation,
} from "@/lib/repository";
import { situationUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function situationDetail(userId: number, id: number, isQa = false) {
  const situation = await getSituation(userId, id);
  if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
  const session =
    (await getLatestIntakeSession(userId, id)) ??
    (await getOrCreateIntakeSession(userId, id));
  const [messages, latestPlan, plans, tasks] = await Promise.all([
    listIntakeMessages(userId, session.id),
    getLatestNextMovePlan(userId, id, { isQa }),
    listNextMovePlans(userId, 10, id, { isQa }),
    listTasksForSituation(userId, id, { isQa }),
  ]);
  return {
    situation,
    session,
    messages,
    latestPlan,
    plans,
    tasks,
    firstIntakePlanner: buildFirstIntakePlan(situation),
  };
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    await recordIgnoredSuggestedActions(user.id, { isQa: isQaRequest(request) });
    return dataResponse(
      await situationDetail(user.id, parseId(idParam), isQaRequest(request)),
    );
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
    const existingSession = await getLatestIntakeSession(user.id, id);
    const existingMessages = existingSession
      ? await listIntakeMessages(user.id, existingSession.id)
      : [];
    const hasUserAnswer = existingMessages.some((message) => message.role === "user");
    const existingSituation = await getSituation(user.id, id);
    const situation = await updateSituation(user.id, id, input);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    if (existingSituation && !hasUserAnswer) {
      const planner = buildFirstIntakePlan(situation);
      await createOutcomeHarnessEvent(user.id, {
        situationId: id,
        conversationId: String(id),
        eventType: "situation_edited_before_answering",
        source: "first_intake",
        domain: planner.domain,
        subtype: planner.subtype,
        questionPurpose: planner.questionPurpose,
        metadata: {
          originalTitle: existingSituation.title,
          newTitle: situation.title,
          originalDescription: existingSituation.description,
          newDescription: situation.description,
        },
        dedupeKey: `situation-edited-before-answering:${id}:${situation.updated_at}`,
        isQa: isQaRequest(request),
      });
    }
    return dataResponse(await situationDetail(user.id, id, isQaRequest(request)));
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
