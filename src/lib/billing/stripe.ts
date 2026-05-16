import Stripe from "stripe";

import { ApiRequestError } from "@/lib/api-response";
import { first, run } from "@/lib/db";
import { nowIso } from "@/lib/time";
import type { BillingStatus, PlanTier } from "@/lib/types";

import {
  getEffectivePlanTier,
  getStripeCancelUrl,
  getStripePortalReturnUrl,
  getStripeSuccessUrl,
  isInternalUnlimitedEmail,
} from "./plans";
import { getBillingUser, type BillingUser } from "./usage";

type AuthenticatedBillingUser = {
  id: number;
  email: string | null;
};

type StripeIdObject = { id: string };

type StripeSubscriptionLike = {
  id: string;
  customer: string | StripeIdObject | null;
  status: string;
  metadata?: Record<string, string> | null;
  items?: {
    data?: Array<{
      current_period_start?: number | null;
      current_period_end?: number | null;
      price?: { id?: string | null } | null;
    }>;
  };
};

function getStripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new ApiRequestError(
      "STRIPE_SECRET_KEY is missing. Add it to your environment before starting billing.",
      400,
      "missing_stripe_secret_key",
    );
  }
  return secretKey;
}

function getStripeCoreMonthlyPriceId() {
  const priceId = process.env.STRIPE_CORE_MONTHLY_PRICE_ID;
  if (!priceId) {
    throw new ApiRequestError(
      "STRIPE_CORE_MONTHLY_PRICE_ID is missing. Add the Stripe Core monthly price id.",
      400,
      "missing_stripe_price_id",
    );
  }
  return priceId;
}

export function getStripe() {
  return new Stripe(getStripeSecretKey());
}

function stringId(value: string | StripeIdObject | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function unixToIso(value: number | null | undefined) {
  return value ? new Date(value * 1000).toISOString() : null;
}

function normalizeStripeStatus(status: string): BillingStatus {
  if (status === "active" || status === "trialing" || status === "past_due") {
    return status;
  }
  if (status === "incomplete" || status === "incomplete_expired") {
    return "incomplete";
  }
  if (status === "canceled" || status === "unpaid" || status === "paused") {
    return "canceled";
  }
  return "canceled";
}

function planTierForSubscriptionStatus(status: BillingStatus): PlanTier {
  return status === "active" || status === "trialing" ? "core" : "free";
}

async function findUserForStripeSubscription(subscription: StripeSubscriptionLike) {
  const metadataUserId = Number(subscription.metadata?.flowpathUserId);
  if (Number.isInteger(metadataUserId) && metadataUserId > 0) {
    const user = await getBillingUser(metadataUserId);
    if (user) return user;
  }

  const customerId = stringId(subscription.customer);
  if (customerId) {
    const byCustomer = await first<{ id: number }>(
      "SELECT id FROM users WHERE stripe_customer_id = ?",
      [customerId],
    );
    if (byCustomer) return getBillingUser(byCustomer.id);
  }

  const bySubscription = await first<{ id: number }>(
    "SELECT id FROM users WHERE stripe_subscription_id = ?",
    [subscription.id],
  );
  return bySubscription ? getBillingUser(bySubscription.id) : null;
}

export async function syncStripeSubscriptionState(
  subscription: StripeSubscriptionLike,
) {
  const user = await findUserForStripeSubscription(subscription);
  if (!user) return null;

  const stripeStatus = normalizeStripeStatus(subscription.status);
  const existingTier = getEffectivePlanTier(user);
  const nextTier =
    existingTier === "internal_unlimited"
      ? "internal_unlimited"
      : planTierForSubscriptionStatus(stripeStatus);
  const firstItem = subscription.items?.data?.[0];
  const now = nowIso();

  await run(
    `UPDATE users SET
      plan_tier = ?,
      billing_status = ?,
      stripe_customer_id = COALESCE(?, stripe_customer_id),
      stripe_subscription_id = ?,
      stripe_price_id = ?,
      current_period_start = ?,
      current_period_end = ?,
      internal_unlimited = ?,
      updated_at = ?
    WHERE id = ?`,
    [
      nextTier,
      stripeStatus,
      stringId(subscription.customer),
      subscription.id,
      firstItem?.price?.id ?? null,
      unixToIso(firstItem?.current_period_start),
      unixToIso(firstItem?.current_period_end),
      existingTier === "internal_unlimited" ? 1 : user.internal_unlimited ? 1 : 0,
      now,
      user.id,
    ],
  );

  return getBillingUser(user.id);
}

async function updateStripeCustomerId(userId: number, customerId: string) {
  await run(
    "UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?",
    [customerId, nowIso(), userId],
  );
}

async function ensureStripeCustomer(user: AuthenticatedBillingUser) {
  const billingUser = await getBillingUser(user.id);
  if (billingUser?.stripe_customer_id) return billingUser.stripe_customer_id;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: {
      flowpathUserId: String(user.id),
    },
  });
  await updateStripeCustomerId(user.id, customer.id);
  return customer.id;
}

export async function createCheckoutSession(user: AuthenticatedBillingUser) {
  const customerId = await ensureStripeCustomer(user);
  const priceId = getStripeCoreMonthlyPriceId();
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(user.id),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: getStripeSuccessUrl(),
    cancel_url: getStripeCancelUrl(),
    metadata: {
      flowpathUserId: String(user.id),
      planTier: "core",
    },
    subscription_data: {
      metadata: {
        flowpathUserId: String(user.id),
        planTier: "core",
      },
    },
  });

  if (!session.url) {
    throw new ApiRequestError(
      "Stripe did not return a checkout URL.",
      500,
      "missing_checkout_url",
    );
  }
  return session;
}

export async function createCustomerPortalSession(user: AuthenticatedBillingUser) {
  const billingUser = await getBillingUser(user.id);
  if (!billingUser?.stripe_customer_id) {
    throw new ApiRequestError(
      "No Stripe customer exists for this FlowPath user yet.",
      400,
      "missing_stripe_customer",
    );
  }

  return getStripe().billingPortal.sessions.create({
    customer: billingUser.stripe_customer_id,
    return_url: getStripePortalReturnUrl(),
  });
}

function userIdFromCheckoutSession(session: Stripe.Checkout.Session) {
  const metadataUserId = Number(session.metadata?.flowpathUserId);
  if (Number.isInteger(metadataUserId) && metadataUserId > 0) return metadataUserId;
  const referenceUserId = Number(session.client_reference_id);
  return Number.isInteger(referenceUserId) && referenceUserId > 0
    ? referenceUserId
    : null;
}

async function attachCheckoutCustomer(session: Stripe.Checkout.Session) {
  const userId = userIdFromCheckoutSession(session);
  const customerId = stringId(session.customer);
  if (!userId || !customerId) return;
  await updateStripeCustomerId(userId, customerId);
}

async function fetchAndSyncSubscription(subscriptionId: string) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  return syncStripeSubscriptionState(subscription);
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  await attachCheckoutCustomer(session);
  const subscriptionId = stringId(session.subscription);
  if (subscriptionId) await fetchAndSyncSubscription(subscriptionId);
}

function subscriptionIdFromInvoice(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return stringId(subscription);
}

async function markStripeEventProcessed(event: Stripe.Event) {
  await run(
    `INSERT INTO stripe_events (id, type, created_at, processed_at)
    VALUES (?, ?, ?, ?)`,
    [event.id, event.type, unixToIso(event.created) ?? nowIso(), nowIso()],
  );
}

async function hasProcessedStripeEvent(eventId: string) {
  return Boolean(
    await first<{ id: string }>("SELECT id FROM stripe_events WHERE id = ?", [eventId]),
  );
}

export async function handleStripeEvent(event: Stripe.Event) {
  if (await hasProcessedStripeEvent(event.id)) return { processed: false };

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscriptionState(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscriptionId = subscriptionIdFromInvoice(event.data.object as Stripe.Invoice);
      if (subscriptionId) await fetchAndSyncSubscription(subscriptionId);
      break;
    }
  }

  await markStripeEventProcessed(event);
  return { processed: true };
}

export function constructStripeWebhookEvent(rawBody: string, signature: string | null) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new ApiRequestError(
      "STRIPE_WEBHOOK_SECRET is missing.",
      400,
      "missing_stripe_webhook_secret",
    );
  }
  if (!signature) {
    throw new ApiRequestError("Missing Stripe signature.", 400, "missing_signature");
  }

  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    throw new ApiRequestError("Invalid Stripe webhook signature.", 400, "invalid_signature");
  }
}

export async function ensureInternalUnlimitedIfConfigured(user: BillingUser) {
  if (
    user.plan_tier !== "internal_unlimited" &&
    !user.internal_unlimited &&
    isInternalUnlimitedEmail(user.email)
  ) {
    await run(
      `UPDATE users SET plan_tier = 'internal_unlimited', internal_unlimited = 1,
        billing_status = 'none', updated_at = ?
      WHERE id = ?`,
      [nowIso(), user.id],
    );
    return getBillingUser(user.id);
  }
  return user;
}
