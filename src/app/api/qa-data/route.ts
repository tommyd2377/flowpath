import { dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { clearQaData } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  try {
    const user = await requireUser();
    await clearQaData(user.id);
    return dataResponse({ cleared: true });
  } catch (error) {
    return errorResponse(error, "Could not clear QA test data.");
  }
}
