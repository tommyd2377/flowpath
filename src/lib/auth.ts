import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";

import { ApiRequestError } from "./api-response";
import { isInternalUnlimitedEmail } from "./billing/plans";
import { first, insert, run } from "./db";
import {
  GUEST_SESSION_COOKIE,
  createGuestSessionId,
  guestSessionCookieOptions,
  normalizeGuestSessionId,
} from "./guest-session";
import { nowIso } from "./time";
import type { BillingStatus, PlanTier } from "./types";
import {
  transferDuplicateUserDataToUser,
  transferGuestUserDataToUser,
} from "./user-transfer";

export type LocalUserRole = "owner" | "user";

export type LocalUser = {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  guest_session_id: string | null;
  is_guest: number;
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
  clerkUserId: string | null;
  email: string | null;
  isGuest: boolean;
  role: LocalUserRole;
};

type CookieStore = Awaited<ReturnType<typeof cookies>>;

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

function toCurrentUser(
  user: LocalUser,
  clerkUserId: string | null,
): CurrentFlowPathUser {
  return {
    id: user.id,
    clerkUserId,
    email: user.email,
    isGuest: Boolean(user.is_guest) && !clerkUserId,
    role: user.role,
  };
}

function setGuestSessionCookie(cookieStore: CookieStore, guestSessionId: string) {
  cookieStore.set(GUEST_SESSION_COOKIE, guestSessionId, guestSessionCookieOptions());
}

function clearGuestSessionCookie(cookieStore: CookieStore) {
  cookieStore.delete(GUEST_SESSION_COOKIE);
}

async function getGuestUserBySession(guestSessionId: string) {
  return first<LocalUser>("SELECT * FROM users WHERE guest_session_id = ?", [
    guestSessionId,
  ]);
}

async function getOrCreateGuestUser(
  cookieStore: CookieStore,
  existingGuestSessionId: string | null,
) {
  if (existingGuestSessionId) {
    const existingGuest = await getGuestUserBySession(existingGuestSessionId);
    if (existingGuest?.is_guest) return toCurrentUser(existingGuest, null);
  }

  const guestSessionId = existingGuestSessionId ?? createGuestSessionId();
  const now = nowIso();
  let id: number;
  try {
    id = await insert(
      `INSERT INTO users (
        guest_session_id, is_guest, role, plan_tier, billing_status,
        internal_unlimited, created_at, updated_at
      ) VALUES (?, 1, 'user', 'free', 'none', 0, ?, ?)`,
      [guestSessionId, now, now],
    );
  } catch (error) {
    const existingGuest = await getGuestUserBySession(guestSessionId);
    if (existingGuest?.is_guest) return toCurrentUser(existingGuest, null);
    throw error;
  }
  setGuestSessionCookie(cookieStore, guestSessionId);

  const created = await first<LocalUser>("SELECT * FROM users WHERE id = ?", [id]);
  if (!created) {
    throw new ApiRequestError(
      "Could not create local FlowPath guest.",
      500,
      "guest_user_create_failed",
    );
  }
  return toCurrentUser(created, null);
}

async function claimGuestUser(
  guest: LocalUser,
  clerkUserId: string,
  email: string,
) {
  const now = nowIso();
  const isInternal = isInternalUnlimitedEmail(email);
  await run(
    `UPDATE users SET clerk_user_id = ?, email = ?, guest_session_id = NULL,
      is_guest = 0, plan_tier = ?, internal_unlimited = ?,
      billing_status = 'none', updated_at = ?
    WHERE id = ? AND is_guest = 1 AND clerk_user_id IS NULL`,
    [
      clerkUserId,
      email,
      isInternal ? "internal_unlimited" : "free",
      isInternal ? 1 : 0,
      now,
      guest.id,
    ],
  );
  const claimed = await first<LocalUser>("SELECT * FROM users WHERE id = ?", [
    guest.id,
  ]);
  if (!claimed?.clerk_user_id) {
    throw new ApiRequestError(
      "Could not attach your guest FlowPath session.",
      500,
      "guest_claim_failed",
    );
  }
  return toCurrentUser(await applyInternalUnlimitedConfig(claimed), clerkUserId);
}

async function attachSignedInAccountToUser(
  userId: number,
  clerkUserId: string,
  email: string,
) {
  const now = nowIso();
  const isInternal = isInternalUnlimitedEmail(email);
  await run(
    `UPDATE users SET clerk_user_id = ?, email = ?,
      plan_tier = CASE WHEN ? = 1 THEN 'internal_unlimited' ELSE plan_tier END,
      internal_unlimited = CASE WHEN ? = 1 THEN 1 ELSE internal_unlimited END,
      billing_status = CASE WHEN ? = 1 THEN 'none' ELSE billing_status END,
      updated_at = ?
    WHERE id = ?`,
    [
      clerkUserId,
      email,
      isInternal ? 1 : 0,
      isInternal ? 1 : 0,
      isInternal ? 1 : 0,
      now,
      userId,
    ],
  );
  return first<LocalUser>("SELECT * FROM users WHERE id = ?", [userId]);
}

async function resolveOwnerAccountForSignedInEmail({
  clerkUserId,
  email,
  cookieStore,
  guestSessionId,
  guest,
  duplicateUser,
}: {
  clerkUserId: string;
  email: string;
  cookieStore: CookieStore;
  guestSessionId: string | null;
  guest: LocalUser | null;
  duplicateUser?: LocalUser | null;
}) {
  const ownerEmail = normalizeEmail(process.env.FLOWPATH_OWNER_EMAIL);
  if (!ownerEmail || email !== ownerEmail) return null;

  const owner = await getOwnerUser();
  if (!owner) {
    throw new ApiRequestError(
      "FlowPath owner user is missing. Run npm run db:init.",
      500,
      "owner_missing",
    );
  }

  if (guest?.is_guest && guest.id !== owner.id && guest.id !== duplicateUser?.id) {
    await transferGuestUserDataToUser(guest.id, owner.id);
  }

  if (duplicateUser && duplicateUser.id !== owner.id) {
    await transferDuplicateUserDataToUser(duplicateUser.id, owner.id);
  }

  const duplicateByEmail = await first<LocalUser>(
    "SELECT * FROM users WHERE email = ? AND id <> ?",
    [email, owner.id],
  );
  if (duplicateByEmail && duplicateByEmail.id !== duplicateUser?.id) {
    await transferDuplicateUserDataToUser(duplicateByEmail.id, owner.id);
  }

  const attached = await attachSignedInAccountToUser(owner.id, clerkUserId, email);
  if (!attached?.clerk_user_id) {
    throw new ApiRequestError(
      "Could not attach the FlowPath owner account.",
      500,
      "owner_claim_failed",
    );
  }
  if (guestSessionId) clearGuestSessionCookie(cookieStore);
  return toCurrentUser(await applyInternalUnlimitedConfig(attached), clerkUserId);
}

async function requireClerkUser(
  clerkUserId: string,
  cookieStore: CookieStore,
  guestSessionId: string | null,
): Promise<CurrentFlowPathUser> {
  const guest = guestSessionId ? await getGuestUserBySession(guestSessionId) : null;
  const existing = await first<LocalUser>(
    "SELECT * FROM users WHERE clerk_user_id = ?",
    [clerkUserId],
  );
  if (existing) {
    if (existing.id !== 1) {
      const clerkUser = await currentUser();
      const email = primaryEmailFromClerkUser(clerkUser);
      if (!email) {
        throw new ApiRequestError(
          "Your account needs a verified email address before using FlowPath.",
          403,
          "email_required",
        );
      }
      const ownerUser = await resolveOwnerAccountForSignedInEmail({
        clerkUserId,
        email,
        cookieStore,
        guestSessionId,
        guest,
        duplicateUser: existing,
      });
      if (ownerUser) return ownerUser;
    }

    if (guest?.is_guest && guest.id !== existing.id) {
      await transferGuestUserDataToUser(guest.id, existing.id);
    }
    if (guestSessionId) clearGuestSessionCookie(cookieStore);
    return toCurrentUser(await applyInternalUnlimitedConfig(existing), clerkUserId);
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

  const ownerUser = await resolveOwnerAccountForSignedInEmail({
    clerkUserId,
    email,
    cookieStore,
    guestSessionId,
    guest,
  });
  if (ownerUser) return ownerUser;

  const existingByEmail = await first<LocalUser>("SELECT * FROM users WHERE email = ?", [
    email,
  ]);
  if (existingByEmail) {
    if (existingByEmail.clerk_user_id !== clerkUserId) {
      await run("UPDATE users SET clerk_user_id = ?, updated_at = ? WHERE id = ?", [
        clerkUserId,
        nowIso(),
        existingByEmail.id,
      ]);
      const claimedByEmail =
        (await first<LocalUser>("SELECT * FROM users WHERE id = ?", [
          existingByEmail.id,
        ])) ?? existingByEmail;
      if (guest?.is_guest && guest.id !== claimedByEmail.id) {
        await transferGuestUserDataToUser(guest.id, claimedByEmail.id);
      }
      if (guestSessionId) clearGuestSessionCookie(cookieStore);
      return toCurrentUser(
        await applyInternalUnlimitedConfig(claimedByEmail),
        clerkUserId,
      );
    }

    if (guest?.is_guest && guest.id !== existingByEmail.id) {
      await transferGuestUserDataToUser(guest.id, existingByEmail.id);
    }
    if (guestSessionId) clearGuestSessionCookie(cookieStore);
    return toCurrentUser(
      await applyInternalUnlimitedConfig(existingByEmail),
      clerkUserId,
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
        clerkUserId,
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
    if (guest?.is_guest && guest.id !== claimedOwner.id) {
      await transferGuestUserDataToUser(guest.id, claimedOwner.id);
    }
    clearGuestSessionCookie(cookieStore);
    return toCurrentUser(
      await applyInternalUnlimitedConfig(claimedOwner),
      clerkUserId,
    );
  }

  if (guest?.is_guest && !guest.clerk_user_id && !guest.email) {
    const claimedGuest = await claimGuestUser(guest, clerkUserId, email);
    clearGuestSessionCookie(cookieStore);
    return claimedGuest;
  }

  const now = nowIso();
  const isInternal = isInternalUnlimitedEmail(email);
  const id = await insert(
    `INSERT INTO users (
      clerk_user_id, email, role, plan_tier, billing_status,
      internal_unlimited, created_at, updated_at
    ) VALUES (?, ?, 'user', ?, 'none', ?, ?, ?)`,
    [
      clerkUserId,
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
  if (guestSessionId) clearGuestSessionCookie(cookieStore);
  return toCurrentUser(await applyInternalUnlimitedConfig(created), clerkUserId);
}

export async function requireUser(): Promise<CurrentFlowPathUser> {
  const clerkAuth = await auth();
  const cookieStore = await cookies();
  const guestSessionId = normalizeGuestSessionId(
    cookieStore.get(GUEST_SESSION_COOKIE)?.value,
  );

  if (!clerkAuth.isAuthenticated || !clerkAuth.userId) {
    return getOrCreateGuestUser(cookieStore, guestSessionId);
  }

  return requireClerkUser(clerkAuth.userId, cookieStore, guestSessionId);
}
