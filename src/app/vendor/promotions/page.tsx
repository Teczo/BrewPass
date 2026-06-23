import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorPackManager } from "@/components/vendor-pack-manager";
import { getSession } from "@/lib/auth0";
import { vendorPromotionsCollection } from "@/lib/collections";
import { loadCampaignSuggestions } from "@/lib/promotions/campaign-suggestions";
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

  const [promos, taxonomy, suggestions] = await Promise.all([
    vendorPromotionsCollection(),
    loadActiveTaxonomy(),
    loadCampaignSuggestions(context.vendor._id),
  ]);
  const docs = await promos
    .find({ vendorId: context.vendor._id })
    .sort({ createdAt: -1 })
    .toArray();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Promotions</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>
      <p className="text-sm text-neutral-500">
        Run time-boxed campaigns: discounted <strong>packs</strong> and <strong>buy-N-get-M</strong>{" "}
        bundles offices buy for their team (pinned to you — they don&apos;t switch vendors), and{" "}
        <strong>time-window discounts</strong> that automatically cut prices during quiet hours.
      </p>
      <VendorPackManager
        promotions={docs.map(vendorPromotionToJson)}
        drinkOptions={drinkOptionsFrom(taxonomy) ?? DEFAULT_DRINK_OPTIONS}
        suggestions={suggestions}
      />
    </main>
  );
}
