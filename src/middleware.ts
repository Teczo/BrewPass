import { NextResponse, type NextRequest } from "next/server";

import { auth0, isAuth0Configured } from "@/lib/auth0";

export async function middleware(request: NextRequest) {
  // Without Auth0 credentials (fresh clone, first deploy) the site still
  // boots; login is simply unavailable until the env vars are set.
  if (!isAuth0Configured()) {
    console.warn("Auth0 env vars not set — auth routes disabled.");
    return NextResponse.next();
  }
  return auth0.middleware(request);
}

export const config = {
  // Run on everything except static assets so sessions keep rolling.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
