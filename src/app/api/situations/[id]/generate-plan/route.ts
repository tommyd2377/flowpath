import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
} from "@/lib/api-response";
import { generateNextMovePlan } from "@/lib/needle-ai";
import {
  createNextMovePlan,
  getLatestIntakeSession,
  getProfile,
  getSituation,
  listCheckIns,
  listIntakeMessages,
  listNextMovePlans,
  listTasks,
  updateIntakeSession,
} from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
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
    const situation = await getSituation(situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");

    const session = await getLatestIntakeSession(situationId);
    const [profile, messages, openTasks, recentCheckIns, recentPlans] =
      await Promise.all([
        getProfile(),
        session ? listIntakeMessages(session.id) : Promise.resolve([]),
        listTasks().then((tasks) => tasks.filter((task) => task.status === "open")),
        listCheckIns(5),
        listNextMovePlans(5, situationId),
      ]);

    const { plan, model } = await generateNextMovePlan({
      profile,
      situation,
      session,
      messages,
      openTasks,
      recentCheckIns,
      recentPlans,
    });

    if (session) {
      await updateIntakeSession(session.id, {
        current_stage: "ready_to_generate",
        is_complete: true,
        summary_so_far: plan.situation_summary,
      });
    }

    return dataResponse(
      await createNextMovePlan(situationId, session?.id ?? null, plan, model),
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not generate next move plan.");
  }
}
