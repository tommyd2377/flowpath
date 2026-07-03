import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  entryDomainFallbackTitle,
  inferBoardTitle,
  inferMemoryCategoryFromText,
} from "@/lib/entry-domains";
import { isQaRequest } from "@/lib/qa-mode";
import {
  addIntakeMessage,
  createInferredContextItem,
  getLatestIntakeSession,
  getOrCreateIntakeSession,
  getSituation,
  listIntakeMessages,
  updateIntakeSession,
  updateSituation,
} from "@/lib/repository";
import { boardUpdateInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    const input = boardUpdateInputSchema.parse(await readJson(request));
    const isQa = isQaRequest(request);
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Board not found.", 404, "not_found");

    const session =
      (await getLatestIntakeSession(user.id, situationId)) ??
      (await getOrCreateIntakeSession(user.id, situationId));
    const message = await addIntakeMessage(
      user.id,
      session.id,
      "user",
      input.content,
      { clientMessageId: input.client_message_id, isQa },
    );
    await createInferredContextItem(
      user.id,
      {
        label: "Board update",
        value: input.content,
        category: inferMemoryCategoryFromText(input.content),
        sensitivity: "low",
        persistence: "proposed_memory",
        source: "intake",
        situation_id: situation.id,
        intake_session_id: session.id,
        next_move_plan_id: null,
      },
      { isQa },
    );

    const titleCandidate = inferBoardTitle(
      situation.category,
      `${situation.description} ${input.content}`,
    );
    const fallbackTitle = entryDomainFallbackTitle(situation.category);
    if (titleCandidate !== fallbackTitle && situation.title === fallbackTitle) {
      await updateSituation(user.id, situation.id, {
        ...situation,
        title: titleCandidate,
      });
    }

    const messages = await listIntakeMessages(user.id, session.id);
    await updateIntakeSession(user.id, session.id, {
      current_stage: "ready_to_generate",
      is_complete: true,
      summary_so_far: [
        session.summary_so_far,
        `Board update: ${input.content}`,
      ].filter(Boolean).join("\n"),
    });

    return dataResponse({
      message,
      messages,
      status: "saved",
    });
  } catch (error) {
    return errorResponse(error, "Could not update board.");
  }
}
