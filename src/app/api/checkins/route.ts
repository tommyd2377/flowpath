import { ApiRequestError, dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { listCheckIns } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 30);
    return dataResponse(await listCheckIns(user.id, Number.isFinite(limit) ? limit : 30));
  } catch (error) {
    return errorResponse(error, "Could not load check-ins.");
  }
}

export async function POST(request: Request) {
  try {
    await request.text();
    throw new ApiRequestError(
      "Daily check-ins are deprecated. Start with a board to find your next move.",
      410,
      "daily_checkin_deprecated",
    );
  } catch (error) {
    return errorResponse(error, "Could not save check-in.");
  }
}
