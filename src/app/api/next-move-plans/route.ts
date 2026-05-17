import { dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { listNextMovePlans } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    return dataResponse(
      await listNextMovePlans(user.id, Number.isFinite(limit) ? limit : 20),
    );
  } catch (error) {
    return errorResponse(error, "Could not load next move plans.");
  }
}
