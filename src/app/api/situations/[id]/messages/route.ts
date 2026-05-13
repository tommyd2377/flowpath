import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { generateInterviewQuestion } from "@/lib/needle-ai";
import {
  addIntakeMessage,
  getOrCreateIntakeSession,
  getProfile,
  getSituation,
  listIntakeMessages,
  updateIntakeSession,
  updateSituation,
} from "@/lib/repository";
import { intakeAnswerInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }

    const { id: idParam } = await context.params;
    const situationId = parseId(idParam);
    const input = intakeAnswerInputSchema.parse(await readJson(request));
    const situation = await getSituation(situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");

    const session = await getOrCreateIntakeSession(situationId);
    await addIntakeMessage(session.id, "user", input.content);
    const messagesAfterUser = await listIntakeMessages(session.id);
    const profile = await getProfile();
    const { output } = await generateInterviewQuestion({
      profile,
      situation,
      session,
      messages: messagesAfterUser,
    });

    const updatedSession = await updateIntakeSession(session.id, output);
    const assistantMessage = await addIntakeMessage(session.id, "assistant", output.question);

    if (output.recommended_urgency && output.recommended_urgency !== situation.urgency) {
      await updateSituation(situation.id, {
        title: situation.title,
        category: situation.category,
        status: situation.status,
        urgency: output.recommended_urgency,
      });
    }

    return dataResponse({
      session: updatedSession,
      message: assistantMessage,
      messages: await listIntakeMessages(session.id),
    });
  } catch (error) {
    return errorResponse(error, "Could not continue intake.");
  }
}
