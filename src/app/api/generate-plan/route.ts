import { ApiRequestError, dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { listPlans } from "@/lib/repository";

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
    await requireUser();
    throw new ApiRequestError(
      "Daily FlowPath generation is deprecated. Start with a board to generate a best move.",
      410,
      "daily_plan_deprecated",
    );
  } catch (error) {
    return errorResponse(error, "Could not generate today's FlowPath.");
  }
}
