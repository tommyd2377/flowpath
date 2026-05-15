import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import { ApiRequestError } from "./api-response";
import { first, insert, run } from "./db";
import { nowIso } from "./time";

export type LocalUserRole = "owner" | "user";

export type LocalUser = {
  id: number;
  clerk_user_id: string | null;
  email: string | null;
  role: LocalUserRole;
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
  if (existing) return toCurrentUser(existing, clerkAuth.userId);

  const clerkUser = await currentUser();
  const email = primaryEmailFromClerkUser(clerkUser);
  if (!email) {
    throw new ApiRequestError(
      "Your account needs a verified email address before using FlowPath.",
      403,
      "email_required",
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

    await run(
      `UPDATE users SET clerk_user_id = ?, email = ?, updated_at = ?
      WHERE id = 1 AND clerk_user_id IS NULL`,
      [clerkAuth.userId, email, nowIso()],
    );
    const claimedOwner = await getOwnerUser();
    if (!claimedOwner?.clerk_user_id) {
      throw new ApiRequestError(
        "Could not claim the FlowPath owner account.",
        500,
        "owner_claim_failed",
      );
    }
    return toCurrentUser(claimedOwner, clerkAuth.userId);
  }

  const now = nowIso();
  const id = await insert(
    `INSERT INTO users (clerk_user_id, email, role, created_at, updated_at)
    VALUES (?, ?, 'user', ?, ?)`,
    [clerkAuth.userId, email, now, now],
  );
  const created = await first<LocalUser>("SELECT * FROM users WHERE id = ?", [id]);
  if (!created) {
    throw new ApiRequestError(
      "Could not create local FlowPath user.",
      500,
      "local_user_create_failed",
    );
  }
  return toCurrentUser(created, clerkAuth.userId);
}
