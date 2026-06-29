import Link from "next/link";

import { getSession } from "@/lib/auth0";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Phase O.6 (fallbacks.md §11.3): never let an Auth0/session hiccup break the
  // landing page — fall back to the signed-out view so the sign-in entry always
  // renders. Already-authenticated users keep working from their session cookie.
  let session: Awaited<ReturnType<typeof getSession>> = null;
  let authDegraded = false;
  try {
    session = await getSession();
  } catch {
    authDegraded = true;
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">BrewPass</h1>
      <p className="max-w-md text-lg text-neutral-500">
        Your daily coffee, delivered on schedule. Subscribe once — we handle the rest.
      </p>
      {authDegraded && (
        <p className="max-w-md text-sm text-amber-700">
          Sign-in is having a moment — if logging in doesn&apos;t work, please try again shortly.
        </p>
      )}
      {session ? (
        <Link
          href="/dashboard"
          className="rounded-md bg-amber-800 px-5 py-2.5 font-medium text-white hover:bg-amber-700"
        >
          Go to dashboard
        </Link>
      ) : (
        <a
          href="/auth/login?returnTo=/dashboard"
          className="rounded-md bg-amber-800 px-5 py-2.5 font-medium text-white hover:bg-amber-700"
        >
          Log in / Sign up
        </a>
      )}
    </main>
  );
}
