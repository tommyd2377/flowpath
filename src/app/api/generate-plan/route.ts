import { ApiRequestError, dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { canUseWebSearchForTier } from "@/lib/billing/plans";
import { assertCanUseFeature, incrementUsage } from "@/lib/billing/usage";
import { generateFlowPathPlan } from "@/lib/flowpath-ai";
import {
  createPlan,
  getLatestCheckInForDate,
  getProfile,
  listCheckIns,
  listLifeAreas,
  listNextMovePlans,
  listPlans,
  listProjects,
  listSituations,
  listTasks,
} from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    return dataResponse(await listPlans(user.id, Number.isFinite(limit) ? limit : 20));
  } catch (error) {
    return errorResponse(error, "Could not load plans.");
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }
    const usageDecision = await assertCanUseFeature(user.id, "today_checkin");

    const [
      profile,
      lifeAreas,
      projects,
      tasks,
      recentCheckIns,
      recentPlans,
      activeSituations,
      recentNextMovePlans,
      todayCheckIn,
    ] = await Promise.all([
      getProfile(user.id),
      listLifeAreas(user.id),
      listProjects(user.id),
      listTasks(user.id),
      listCheckIns(user.id, 7),
      listPlans(user.id, 5),
      listSituations(user.id, "active"),
      listNextMovePlans(user.id, 5),
      getLatestCheckInForDate(user.id),
    ]);

    const { plan, model, usage } = await generateFlowPathPlan(
      {
        profile,
        lifeAreas,
        activeProjects: projects.filter((project) => project.status === "active"),
        unfinishedTasks: tasks.filter((task) => task.status === "open"),
        recentCheckIns,
        recentPlans,
        activeSituations,
        recentNextMovePlans,
        todayCheckIn,
      },
      { allowWebSearch: canUseWebSearchForTier(usageDecision.planTier) },
    );
    await incrementUsage(user.id, "today_checkin", usage);

    return dataResponse(
      await createPlan(user.id, plan, model, todayCheckIn?.id ?? null),
      201,
    );
  } catch (error) {
    return errorResponse(error, "Could not generate today's FlowPath.");
  }
}
