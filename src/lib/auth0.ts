import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { SessionData } from "@auth0/nextjs-auth0/types";

/**
 * Auth0 client singleton. Configuration comes from environment variables:
 * AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, AUTH0_SECRET,
 * APP_BASE_URL. Auth routes (/auth/login, /auth/logout, /auth/callback,
 * /auth/profile) are mounted by the middleware.
 */
export const auth0 = new Auth0Client();

export function isAuth0Configured(): boolean {
  return Boolean(
    process.env.AUTH0_DOMAIN &&
    process.env.AUTH0_CLIENT_ID &&
    process.env.AUTH0_CLIENT_SECRET &&
    process.env.AUTH0_SECRET,
  );
}

/**
 * Session lookup that treats a missing/unreadable session — including an
 * unconfigured Auth0 environment — as "logged out" instead of a 500.
 */
export async function getSession(): Promise<SessionData | null> {
  if (!isAuth0Configured()) return null;
  try {
    return await auth0.getSession();
  } catch {
    return null;
  }
}
