import { ApiRequestError } from "@/lib/api-response";
import { all, first, run } from "@/lib/db";
import { DEFAULT_APP_TIMEZONE } from "@/lib/env";
import { nowIso } from "@/lib/time";
import type {
  BillingStatus,
  BillingSummary,
  PlanTier,
  UsageSummaryItem,
  UsageType,
} from "@/lib/types";

import {
  BILLING_UPGRADE_MESSAGE,
  CORE_PRICE_CENTS,
  GUEST_UPGRADE_MESSAGE,
  getEffectivePlanTier,
  guestPlanLimits,
  planLimits,
  usageTypes,
} from "./plans";

export type TokenUsageMetadata = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostCents?: number;
};

export type BillingUser = {
  id: number;
  email: string | null;
  plan_tier: PlanTier;
  billing_status: BillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  internal_unlimited: boolean;
  is_guest: boolean;
};

type BillingUserRow = Omit<BillingUser, "internal_unlimited" | "is_guest"> & {
  internal_unlimited: number;
  is_guest: number;
};

type MonthlyUsageRow = {
  usage_type: UsageType;
  count: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_cents: number;
};

export type UsageDecision = {
  allowed: boolean;
  userId: number;
  planTier: PlanTier;
  usageType: UsageType;
  used: number;
  limit: number | null;
  remaining: number | null;
  periodStart: string;
  periodEnd: string;
  upgradeMessage: string;
};

function toBillingUser(row: BillingUserRow): BillingUser {
  return {
    ...row,
    internal_unlimited: Boolean(row.internal_unlimited),
    is_guest: Boolean(row.is_guest),
  };
}

export async function getBillingUser(userId: number) {
  const row = await first<BillingUserRow>(
    `SELECT
      id, email, plan_tier, billing_status, stripe_customer_id,
      stripe_subscription_id, stripe_price_id, current_period_start,
      current_period_end, internal_unlimited, is_guest
    FROM users
    WHERE id = ?`,
    [userId],
  );
  return row ? toBillingUser(row) : null;
}

export function getUsagePeriod(date = new Date()) {
  const timezone = process.env.APP_TIMEZONE || DEFAULT_APP_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  return {
    periodStart: `${year}-${String(month).padStart(2, "0")}-01`,
    periodEnd: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

function emptyUsageMap() {
  return new Map<UsageType, MonthlyUsageRow>(
    usageTypes.map((usageType) => [
      usageType,
      {
        usage_type: usageType,
        count: 0,
        estimated_input_tokens: 0,
        estimated_output_tokens: 0,
        estimated_cost_cents: 0,
      },
    ]),
  );
}

export async function listUsageRows(userId: number, periodStart: string) {
  const rows = await all<MonthlyUsageRow>(
    `SELECT usage_type, count, estimated_input_tokens, estimated_output_tokens,
      estimated_cost_cents
    FROM monthly_usage
    WHERE user_id = ? AND period_start = ?`,
    [userId, periodStart],
  );
  const byType = emptyUsageMap();
  for (const row of rows) byType.set(row.usage_type, row);
  return byType;
}

function usageSummaryForLimits(
  limits: Record<UsageType, number | null>,
  usageRows: Map<UsageType, MonthlyUsageRow>,
): UsageSummaryItem[] {
  return usageTypes.map((usageType) => {
    const used = usageRows.get(usageType)?.count ?? 0;
    const limit = limits[usageType];
    return {
      usage_type: usageType,
      used,
      limit,
      remaining: limit == null ? null : Math.max(limit - used, 0),
    };
  });
}

function limitsForUser(user: BillingUser, planTier: PlanTier) {
  return user.is_guest ? guestPlanLimits : planLimits[planTier];
}

function upgradeMessageForUser(user: BillingUser) {
  return user.is_guest ? GUEST_UPGRADE_MESSAGE : BILLING_UPGRADE_MESSAGE;
}

export async function canUseFeature(
  userId: number,
  usageType: UsageType,
): Promise<UsageDecision> {
  const user = await getBillingUser(userId);
  if (!user) throw new ApiRequestError("User not found.", 404, "not_found");

  const planTier = getEffectivePlanTier(user);
  const { periodStart, periodEnd } = getUsagePeriod();
  const usageRows = await listUsageRows(userId, periodStart);
  const used = usageRows.get(usageType)?.count ?? 0;
  const limit = limitsForUser(user, planTier)[usageType];
  const remaining = limit == null ? null : Math.max(limit - used, 0);

  return {
    allowed: limit == null || used < limit,
    userId,
    planTier,
    usageType,
    used,
    limit,
    remaining,
    periodStart,
    periodEnd,
    upgradeMessage: upgradeMessageForUser(user),
  };
}

export async function assertCanUseFeature(userId: number, usageType: UsageType) {
  const decision = await canUseFeature(userId, usageType);
  if (decision.allowed) return decision;

  throw new ApiRequestError(decision.upgradeMessage, 402, "quota_exceeded", {
    usage_type: decision.usageType,
    plan_tier: decision.planTier,
    used: decision.used,
    limit: decision.limit,
    remaining: decision.remaining,
    period_start: decision.periodStart,
    period_end: decision.periodEnd,
    upgrade_message: decision.upgradeMessage,
  });
}

export async function canUseGuestFirstSituationIntake(
  userId: number,
  situationId: number,
  { isQa = false }: { isQa?: boolean } = {},
) {
  return canUseFirstSituationFlow(userId, situationId, { isQa, guestsOnly: true });
}

export async function canUseFirstSituationFlow(
  userId: number,
  situationId: number,
  {
    isQa = false,
    guestsOnly = false,
  }: { isQa?: boolean; guestsOnly?: boolean } = {},
) {
  const user = await getBillingUser(userId);
  if (!user) return false;
  const planTier = getEffectivePlanTier(user);
  if (guestsOnly) {
    if (!user.is_guest) return false;
  } else if (!user.is_guest && planTier !== "free") {
    return false;
  }

  const planCount = await first<{ count: number }>(
    `SELECT COUNT(*) AS count
    FROM next_move_plans
    WHERE user_id = ? AND is_qa = ?`,
    [userId, isQa ? 1 : 0],
  );
  if ((planCount?.count ?? 0) > 0) return false;

  const firstSituation = await first<{ id: number }>(
    `SELECT id
    FROM situations
    WHERE user_id = ? AND is_qa = ?
    ORDER BY created_at ASC, id ASC
    LIMIT 1`,
    [userId, isQa ? 1 : 0],
  );

  return firstSituation?.id === situationId;
}

export async function incrementUsage(
  userId: number,
  usageType: UsageType,
  metadata: TokenUsageMetadata = {},
) {
  const { periodStart, periodEnd } = getUsagePeriod();
  const now = nowIso();
  await run(
    `INSERT INTO monthly_usage (
      user_id, period_start, period_end, usage_type, count,
      estimated_input_tokens, estimated_output_tokens, estimated_cost_cents,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, period_start, usage_type) DO UPDATE SET
      count = monthly_usage.count + 1,
      estimated_input_tokens = monthly_usage.estimated_input_tokens + excluded.estimated_input_tokens,
      estimated_output_tokens = monthly_usage.estimated_output_tokens + excluded.estimated_output_tokens,
      estimated_cost_cents = monthly_usage.estimated_cost_cents + excluded.estimated_cost_cents,
      period_end = excluded.period_end,
      updated_at = excluded.updated_at`,
    [
      userId,
      periodStart,
      periodEnd,
      usageType,
      metadata.inputTokens ?? 0,
      metadata.outputTokens ?? 0,
      metadata.estimatedCostCents ?? 0,
      now,
      now,
    ],
  );
}

export async function getBillingSummary(userId: number): Promise<BillingSummary> {
  const user = await getBillingUser(userId);
  if (!user) throw new ApiRequestError("User not found.", 404, "not_found");

  const planTier = getEffectivePlanTier(user);
  const { periodStart, periodEnd } = getUsagePeriod();
  const usageRows = await listUsageRows(userId, periodStart);
  const upgradeMessage = upgradeMessageForUser(user);

  return {
    plan_tier: planTier,
    billing_status: user.billing_status,
    internal_unlimited: planTier === "internal_unlimited",
    is_guest: user.is_guest,
    current_period_start: user.current_period_start,
    current_period_end: user.current_period_end,
    usage_period_start: periodStart,
    usage_period_end: periodEnd,
    stripe_customer_id: user.stripe_customer_id,
    usage: usageSummaryForLimits(limitsForUser(user, planTier), usageRows),
    upgrade_message: upgradeMessage,
    core_price_cents: CORE_PRICE_CENTS,
  };
}
