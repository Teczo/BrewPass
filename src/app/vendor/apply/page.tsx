import { redirect } from "next/navigation";

import { VendorApplyForm } from "@/components/vendor-apply-form";
import { getSession } from "@/lib/auth0";
import { getOrCreateCurrentUser } from "@/lib/users";
import { findVendorForUser } from "@/lib/vendors";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function VendorApplyPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/apply");

  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/vendor/apply");

  // Already linked to a live vendor or an application in review → portal.
  const vendor = await findVendorForUser(user);
  if (vendor && vendor.status !== "rejected") redirect("/vendor");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Apply as a BrewPass vendor</h1>
        <p className="text-sm text-neutral-500">
          Tell us about your coffee business. The BrewPass team reviews every application; once
          approved you&apos;ll start receiving daily subscriber orders.
        </p>
      </header>
      <VendorApplyForm />
    </main>
  );
}
