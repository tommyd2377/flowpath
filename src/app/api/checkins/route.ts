import { dataResponse, errorResponse, readJson } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createCheckIn, listCheckIns } from "@/lib/repository";
import { checkInInputSchema } from "@/lib/schemas";

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
    const user = await requireUser();
    const input = checkInInputSchema.parse(await readJson(request));
    return dataResponse(await createCheckIn(user.id, input), 201);
  } catch (error) {
    return errorResponse(error, "Could not save check-in.");
  }
}
