import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth0";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/onboarding");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Set up your BrewPass</h1>
        <p className="text-sm text-neutral-500">
          Three quick steps: profile, delivery locations, and your usual coffee.
        </p>
      </header>
      {children}
    </main>
  );
}
