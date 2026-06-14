import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorEarnings } from "@/components/vendor-earnings";
import { getSession } from "@/lib/auth0";
import { vendorToJson } from "@/lib/serializers";
import { getCurrentVendorContext } from "@/lib/vendors";

export const dynamic = "force-dynamic";

export default async function VendorEarningsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/earnings");

  const context = await getCurrentVendorContext();
  if (!context) redirect("/vendor");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Earnings &amp; payouts</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>
      <VendorEarnings vendor={vendorToJson(context.vendor)} />
    </main>
  );
}
