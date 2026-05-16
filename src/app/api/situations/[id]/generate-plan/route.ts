import {
  ApiRequestError,
  dataResponse,
  errorResponse,
  parseId,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { canUseWebSearchForTier } from "@/lib/billing/plans";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";
import { generateNextMovePlan } from "@/lib/flowpath-ai";
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
    const situation = await getSituation(user.id, situationId);
    if (!situation) throw new ApiRequestError("Situation not found.", 404, "not_found");
    const usageDecision = await assertCanUseFeature(user.id, "next_move_plan");

    const session = await getLatestIntakeSession(user.id, situationId);
    const [profile, messages, openTasks, recentCheckIns, recentPlans] =
      await Promise.all([
        getProfile(user.id),
        session ? listIntakeMessages(user.id, session.id) : Promise.resolve([]),
        listTasks(user.id).then((tasks) => tasks.filter((task) => task.status === "open")),
        listCheckIns(user.id, 5),
        listNextMovePlans(user.id, 5, situationId),
      ]);

    const { plan, model, usage } = await generateNextMovePlan(
      {
        profile,
        situation,
        session,
        messages,
        openTasks,
        recentCheckIns,
        recentPlans,
      },
      { allowWebSearch: canUseWebSearchForTier(usageDecision.planTier) },
    );
    await incrementUsage(user.id, "next_move_plan", usage);

    if (session) {
      await updateIntakeSession(user.id, session.id, {
        current_stage: "ready_to_generate",
        is_complete: true,
        summary_so_far: plan.situation_summary,
      });
    }

    return dataResponse(
      await createNextMovePlan(user.id, situationId, session?.id ?? null, plan, model),
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not generate next move plan.");
  }
}
