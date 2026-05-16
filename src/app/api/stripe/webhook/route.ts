import { NextResponse } from "next/server";

import { errorResponse } from "@/lib/api-response";
import {
  constructStripeWebhookEvent,
  handleStripeEvent,
} from "@/lib/billing/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const event = constructStripeWebhookEvent(
      rawBody,
      request.headers.get("stripe-signature"),
    );
    await handleStripeEvent(event);
    return NextResponse.json({ received: true });
  } catch (error) {
    return errorResponse(error, "Could not process Stripe webhook.");
  }
}
