import type { BillingStatus, PlanTier, UsageType } from "@/lib/types";

export const BILLING_UPGRADE_MESSAGE =
  "Your free monthly FlowPath usage is used up. Upgrade to Core to keep generating Next Move plans and daily guidance.";
export const GUEST_UPGRADE_MESSAGE =
  "Create a free account to keep using FlowPath, or upgrade to Core for more monthly AI guidance.";

export const PAYWALL_DISABLED = true;
export const PAYWALL_DISABLED_MESSAGE =
  "FlowPath is currently unlocked while the next-move engine is being rebuilt.";

export const CORE_PRICE_CENTS = 1200;

export const usageTypeLabels: Record<UsageType, string> = {
  today_checkin: "Today check-ins",
  next_move_plan: "Next Move plans",
  lightweight_assist: "Lightweight assists",
};

export const planLabels: Record<PlanTier, string> = {
  free: "Free",
  core: "Core",
  internal_unlimited: "Internal unlimited",
  pro: "Pro",
  sponsored: "Sponsored",
};

export const billingStatusLabels: Record<BillingStatus, string> = {
  none: "None",
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
};

export const usageTypes = [
  "today_checkin",
  "next_move_plan",
  "lightweight_assist",
] as const satisfies readonly UsageType[];

export type PlanLimits = Record<UsageType, number | null>;

export const planLimits: Record<PlanTier, PlanLimits> = {
  free: {
    today_checkin: 3,
    next_move_plan: 1,
    lightweight_assist: 5,
  },
  core: {
    today_checkin: 31,
    next_move_plan: 20,
    lightweight_assist: 50,
  },
  internal_unlimited: {
    today_checkin: null,
    next_move_plan: null,
    lightweight_assist: null,
  },
  pro: {
    today_checkin: 31,
    next_move_plan: 20,
    lightweight_assist: 50,
  },
  sponsored: {
    today_checkin: 31,
    next_move_plan: 20,
    lightweight_assist: 50,
  },
};

export const guestPlanLimits: PlanLimits = {
  today_checkin: 1,
  next_move_plan: 1,
  lightweight_assist: 5,
};

export const unlockedPlanLimits: PlanLimits = {
  today_checkin: null,
  next_move_plan: null,
  lightweight_assist: null,
};

export type BillingUserPlanSnapshot = {
  email: string | null;
  plan_tier: PlanTier;
  internal_unlimited: boolean;
};

export function normalizeBillingEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export function getInternalUnlimitedEmails() {
  return new Set(
    (process.env.INTERNAL_UNLIMITED_EMAILS || "")
      .split(",")
      .map((email) => normalizeBillingEmail(email))
      .filter((email): email is string => Boolean(email)),
  );
}

export function isInternalUnlimitedEmail(email: string | null | undefined) {
  const normalized = normalizeBillingEmail(email);
  if (!normalized) return false;
  return getInternalUnlimitedEmails().has(normalized);
}

export function getEffectivePlanTier(user: BillingUserPlanSnapshot): PlanTier {
  if (
    user.plan_tier === "internal_unlimited" ||
    user.internal_unlimited ||
    isInternalUnlimitedEmail(user.email)
  ) {
    return "internal_unlimited";
  }
  return user.plan_tier;
}

export function canUseWebSearchForTier(planTier: PlanTier) {
  if (PAYWALL_DISABLED) return true;
  return planTier !== "free";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getAppUrl() {
  return trimTrailingSlash(process.env.APP_URL || "http://localhost:3000");
}

export function getStripeSuccessUrl() {
  return process.env.STRIPE_SUCCESS_URL || `${getAppUrl()}/billing?checkout=success`;
}

export function getStripeCancelUrl() {
  return process.env.STRIPE_CANCEL_URL || `${getAppUrl()}/billing?checkout=cancelled`;
}

export function getStripePortalReturnUrl() {
  return `${getAppUrl()}/billing`;
}
