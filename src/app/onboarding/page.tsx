import { redirect } from "next/navigation";

import { ProfileForm } from "@/components/profile-form";
import { StepIndicator } from "@/components/step-indicator";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingProfilePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/onboarding");

  return (
    <section className="flex flex-col gap-6">
      <StepIndicator current={1} />
      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">
          Let&apos;s get you set up
        </h1>
        <p className="text-sm text-coffee">
          First, the basics — so your barista knows who&apos;s getting the coffee.
        </p>
      </header>
      <ProfileForm
        initial={{ name: user.name, phone: user.phone ?? "", role: user.role }}
        nextHref="/onboarding/locations"
      />
    </section>
  );
}
