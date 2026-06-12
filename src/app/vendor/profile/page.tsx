import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorProfileForm } from "@/components/vendor-profile-form";
import { getSession } from "@/lib/auth0";
import { vendorToJson } from "@/lib/serializers";
import { getCurrentVendorContext } from "@/lib/vendors";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function VendorProfilePage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/profile");

  // Non-operational vendors (pending/rejected/suspended) land on the
  // portal page, which explains their state.
  const context = await getCurrentVendorContext();
  if (!context) redirect("/vendor");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profile &amp; hours</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>
      <VendorProfileForm vendor={vendorToJson(context.vendor)} />
    </main>
  );
}
