import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import { ApiRequestError } from "./api-response";
import { isInternalUnlimitedEmail } from "./billing/plans";
import { first, insert, run } from "./db";
import { nowIso } from "./time";
import type { BillingStatus, PlanTier } from "./types";

export type LocalUserRole = "owner" | "user";

export type LocalUser = {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  role: LocalUserRole;
  plan_tier: PlanTier;
  billing_status: BillingStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  internal_unlimited: number;
  created_at: string;
  updated_at: string;
};

export type CurrentFlowPathUser = {
  id: number;
  clerkUserId: string;
  email: string | null;
  role: LocalUserRole;
};

function normalizeEmail(email: string | null | undefined) {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

function primaryEmailFromClerkUser(
  user: Awaited<ReturnType<typeof currentUser>>,
) {
  return normalizeEmail(
    user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses.find((email) => email.id === user.primaryEmailAddressId)
        ?.emailAddress ??
      user?.emailAddresses[0]?.emailAddress,
  );
}

async function getOwnerUser() {
  return first<LocalUser>("SELECT * FROM users WHERE id = 1");
}

async function applyInternalUnlimitedConfig(user: LocalUser) {
  const shouldBeInternal =
    user.plan_tier === "internal_unlimited" ||
    user.internal_unlimited === 1 ||
    isInternalUnlimitedEmail(user.email);
  if (!shouldBeInternal) return user;
  if (user.plan_tier === "internal_unlimited" && user.internal_unlimited === 1) {
    return user;
  }

  await run(
    `UPDATE users SET plan_tier = 'internal_unlimited',
      internal_unlimited = 1,
      billing_status = 'none',
      updated_at = ?
    WHERE id = ?`,
    [nowIso(), user.id],
  );
  return (await first<LocalUser>("SELECT * FROM users WHERE id = ?", [user.id])) ?? user;
}

function toCurrentUser(user: LocalUser, clerkUserId: string): CurrentFlowPathUser {
  return {
    id: user.id,
    clerkUserId,
    email: user.email,
    role: user.role,
  };
}

export async function requireUser(): Promise<CurrentFlowPathUser> {
  const clerkAuth = await auth();
  if (!clerkAuth.isAuthenticated || !clerkAuth.userId) {
    throw new ApiRequestError("Sign in to use FlowPath.", 401, "unauthenticated");
  }

  const existing = await first<LocalUser>(
    "SELECT * FROM users WHERE clerk_user_id = ?",
    [clerkAuth.userId],
  );
  if (existing) {
    return toCurrentUser(await applyInternalUnlimitedConfig(existing), clerkAuth.userId);
  }

  const clerkUser = await currentUser();
  const email = primaryEmailFromClerkUser(clerkUser);
  if (!email) {
    throw new ApiRequestError(
      "Your account needs a verified email address before using FlowPath.",
      403,
      "email_required",
    );
  }

  const existingByEmail = await first<LocalUser>(
    "SELECT * FROM users WHERE email = ?",
    [email],
  );
  if (existingByEmail) {
    if (existingByEmail.clerk_user_id !== clerkAuth.userId) {
      await run("UPDATE users SET clerk_user_id = ?, updated_at = ? WHERE id = ?", [
        clerkAuth.userId,
        nowIso(),
        existingByEmail.id,
      ]);
      const claimedByEmail =
        (await first<LocalUser>("SELECT * FROM users WHERE id = ?", [
          existingByEmail.id,
        ])) ?? existingByEmail;
      return toCurrentUser(
        await applyInternalUnlimitedConfig(claimedByEmail),
        clerkAuth.userId,
      );
    }

    return toCurrentUser(
      await applyInternalUnlimitedConfig(existingByEmail),
      clerkAuth.userId,
    );
  }

  const ownerEmail = normalizeEmail(process.env.FLOWPATH_OWNER_EMAIL);
  const owner = await getOwnerUser();
  if (!owner) {
    throw new ApiRequestError(
      "FlowPath owner user is missing. Run npm run db:init.",
      500,
      "owner_missing",
    );
  }

  if (!owner.clerk_user_id) {
    if (!ownerEmail || email !== ownerEmail) {
      throw new ApiRequestError(
        "The FlowPath owner account must sign in before other users can use this instance.",
        403,
        "owner_unclaimed",
      );
    }

    const isInternal = isInternalUnlimitedEmail(email);
    await run(
      `UPDATE users SET clerk_user_id = ?, email = ?, plan_tier = ?,
        internal_unlimited = ?, billing_status = 'none', updated_at = ?
      WHERE id = 1 AND clerk_user_id IS NULL`,
      [
        clerkAuth.userId,
        email,
        isInternal ? "internal_unlimited" : "free",
        isInternal ? 1 : 0,
        nowIso(),
      ],
    );
    const claimedOwner = await getOwnerUser();
    if (!claimedOwner?.clerk_user_id) {
      throw new ApiRequestError(
        "Could not claim the FlowPath owner account.",
        500,
        "owner_claim_failed",
      );
    }
    return toCurrentUser(
      await applyInternalUnlimitedConfig(claimedOwner),
      clerkAuth.userId,
    );
  }

  const now = nowIso();
  const isInternal = isInternalUnlimitedEmail(email);
  const id = await insert(
    `INSERT INTO users (
      clerk_user_id, email, role, plan_tier, billing_status,
      internal_unlimited, created_at, updated_at
    ) VALUES (?, ?, 'user', ?, 'none', ?, ?, ?)`,
    [
      clerkAuth.userId,
      email,
      isInternal ? "internal_unlimited" : "free",
      isInternal ? 1 : 0,
      now,
      now,
    ],
  );
  const created = await first<LocalUser>("SELECT * FROM users WHERE id = ?", [id]);
  if (!created) {
    throw new ApiRequestError(
      "Could not create local FlowPath user.",
      500,
      "local_user_create_failed",
    );
  }
  return toCurrentUser(await applyInternalUnlimitedConfig(created), clerkAuth.userId);
}
