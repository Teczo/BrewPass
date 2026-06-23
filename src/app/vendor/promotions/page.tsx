import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorPackManager } from "@/components/vendor-pack-manager";
import { getSession } from "@/lib/auth0";
import { vendorPromotionsCollection } from "@/lib/collections";
import { vendorPromotionToJson } from "@/lib/promotions/serialize";
import { drinkOptionsFrom, loadActiveTaxonomy } from "@/lib/taxonomy";
import { DEFAULT_DRINK_OPTIONS } from "@/lib/taxonomy-options";
import { getCurrentVendorContext } from "@/lib/vendors";

export const dynamic = "force-dynamic";

export default async function VendorPromotionsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/promotions");

  const context = await getCurrentVendorContext();
  if (!context) redirect("/vendor");

  const [promos, taxonomy] = await Promise.all([
    vendorPromotionsCollection(),
    loadActiveTaxonomy(),
  ]);
  const docs = await promos
    .find({ vendorId: context.vendor._id })
    .sort({ createdAt: -1 })
    .toArray();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendor Packs</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>
      <p className="text-sm text-neutral-500">
        Offer a discounted multi-coffee pack offices can buy for their team. Set a price for the
        whole pack and a validity window. Packs are pinned to you — they don&apos;t switch to
        another vendor.
      </p>
      <VendorPackManager
        promotions={docs.map(vendorPromotionToJson)}
        drinkOptions={drinkOptionsFrom(taxonomy) ?? DEFAULT_DRINK_OPTIONS}
      />
    </main>
  );
}
