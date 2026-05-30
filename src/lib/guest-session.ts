export const GUEST_SESSION_COOKIE = "flowpath_guest_session";
export const GUEST_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const GUEST_SESSION_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function createGuestSessionId() {
  return crypto.randomUUID().replaceAll("-", "");
}

export function normalizeGuestSessionId(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !GUEST_SESSION_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function guestSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: GUEST_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
