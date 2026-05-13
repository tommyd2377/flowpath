import { ApiRequestError, dataResponse, errorResponse } from "@/lib/api-response";
import { generateNeedlePlan } from "@/lib/needle-ai";
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
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    return dataResponse(await listPlans(Number.isFinite(limit) ? limit : 20));
  } catch (error) {
    return errorResponse(error, "Could not load plans.");
  }
}

export async function POST() {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new ApiRequestError(
        "OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.",
        400,
        "missing_api_key",
      );
    }

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
      getProfile(),
      listLifeAreas(),
      listProjects(),
      listTasks(),
      listCheckIns(7),
      listPlans(5),
      listSituations("active"),
      listNextMovePlans(5),
      getLatestCheckInForDate(),
    ]);

    const { plan, model } = await generateNeedlePlan({
      profile,
      lifeAreas,
      activeProjects: projects.filter((project) => project.status === "active"),
      unfinishedTasks: tasks.filter((task) => task.status === "open"),
      recentCheckIns,
      recentPlans,
      activeSituations,
      recentNextMovePlans,
      todayCheckIn,
    });

    return dataResponse(await createPlan(plan, model, todayCheckIn?.id ?? null), 201);
  } catch (error) {
    return errorResponse(error, "Could not generate today's Needle.");
  }
}
