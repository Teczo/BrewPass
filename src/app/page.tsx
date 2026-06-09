import Link from "next/link";

import { getSession } from "@/lib/auth0";

export default async function Home() {
  const session = await getSession();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">BrewPass</h1>
      <p className="max-w-md text-lg text-neutral-500">
        Your daily coffee, delivered on schedule. Subscribe once — we handle the rest.
      </p>
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
