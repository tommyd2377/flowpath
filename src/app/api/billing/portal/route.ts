import { dataResponse, errorResponse } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { createCustomerPortalSession } from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await requireUser();
    const session = await createCustomerPortalSession(user);
    return dataResponse({ url: session.url });
  } catch (error) {
    return errorResponse(error, "Could not open Stripe billing portal.");
  }
}
