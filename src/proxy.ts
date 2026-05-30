import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  GUEST_SESSION_COOKIE,
  createGuestSessionId,
  guestSessionCookieOptions,
  normalizeGuestSessionId,
} from "./lib/guest-session";

export default clerkMiddleware(
  (_auth, request) => {
    const response = NextResponse.next();
    const guestSessionId = normalizeGuestSessionId(
      request.cookies.get(GUEST_SESSION_COOKIE)?.value,
    );
    if (!guestSessionId) {
      response.cookies.set(
        GUEST_SESSION_COOKIE,
        createGuestSessionId(),
        guestSessionCookieOptions(),
      );
    }
    return response;
  },
  {
    frontendApiProxy: {
      enabled: () => Boolean(process.env.NEXT_PUBLIC_CLERK_PROXY_URL),
    },
  },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/(.*)",
  ],
};
