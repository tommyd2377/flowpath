import {
  ApiRequestError,
  dataResponse,
  errorResponse,
} from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { isQaRequest } from "@/lib/qa-mode";
import { getOutcomeHarnessDashboardSummary } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function debugAllowed(request: Request) {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_FLOWPATH_COGNITIVE_DEBUG === "true" ||
    isQaRequest(request)
  );
}

export async function GET(request: Request) {
  try {
    if (!debugAllowed(request)) {
      throw new ApiRequestError("Outcome harness debug is not enabled.", 404, "not_found");
    }
    const user = await requireUser();
    return dataResponse(
      await getOutcomeHarnessDashboardSummary(user.id, {
        isQa: isQaRequest(request),
      }),
    );
  } catch (error) {
    return errorResponse(error, "Could not load outcome harness dashboard.");
  }
}
