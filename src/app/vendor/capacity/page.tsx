import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorCapacity } from "@/components/vendor-capacity";
import { getSession } from "@/lib/auth0";
import { vendorToJson } from "@/lib/serializers";
import { localDateOf } from "@/lib/time";
import { getCurrentVendorContext } from "@/lib/vendors";

export const dynamic = "force-dynamic";

export default async function VendorCapacityPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/capacity");

  const context = await getCurrentVendorContext();
  if (!context) redirect("/vendor");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Capacity &amp; availability</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>
      <VendorCapacity vendor={vendorToJson(context.vendor)} today={localDateOf(new Date())} />
    </main>
  );
}
