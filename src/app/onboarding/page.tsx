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
      <ProfileForm
        initial={{ name: user.name, phone: user.phone ?? "", role: user.role }}
        nextHref="/onboarding/locations"
      />
    </section>
  );
}
