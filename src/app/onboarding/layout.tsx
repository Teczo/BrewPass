import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth0";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/onboarding");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-7 bg-paper px-6 py-8">
      <span className="font-display text-xl font-semibold tracking-tight text-espresso">
        BrewPass
      </span>
      {children}
    </main>
  );
}
