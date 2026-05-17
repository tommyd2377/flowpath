import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
  readJson,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";
import { generateInterviewQuestion } from "@/lib/flowpath-ai";
import {
  addIntakeMessage,
  createInferredContextItems,
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
    const user = await requireUser();
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
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    await assertCanUseFeature(user.id, "lightweight_assist");

    const session = await getOrCreateIntakeSession(user.id, situationId);
    await addIntakeMessage(user.id, session.id, "user", input.content);
    const messagesAfterUser = await listIntakeMessages(user.id, session.id);
    const profile = await getProfile(user.id);
    const { output, usage } = await generateInterviewQuestion({
      profile,
      situation,
      session,
      messages: messagesAfterUser,
    });
    await incrementUsage(user.id, "lightweight_assist", usage);

    const updatedSession = await updateIntakeSession(user.id, session.id, output);
    const assistantMessage = await addIntakeMessage(
      user.id,
      session.id,
      "assistant",
      output.question,
    );
    await createInferredContextItems(user.id, output.inferred_context_items, {
      situation_id: situation.id,
      intake_session_id: session.id,
      source: "intake",
    });

    if (output.recommended_urgency && output.recommended_urgency !== situation.urgency) {
      await updateSituation(user.id, situation.id, {
        title: situation.title,
        category: situation.category,
        status: situation.status,
        urgency: output.recommended_urgency,
      });
    }

    return dataResponse({
      session: updatedSession,
      message: assistantMessage,
      messages: await listIntakeMessages(user.id, session.id),
    });
  } catch (error) {
    return errorResponse(error, "Could not continue intake.");
  }
}
