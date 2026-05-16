import { dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getBillingSummary } from "@/lib/billing/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    return dataResponse(await getBillingSummary(user.id));
  } catch (error) {
    return errorResponse(error, "Could not load billing summary.");
  }
}
