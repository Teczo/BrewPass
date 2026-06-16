import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorMenuManager, type MenuSection } from "@/components/vendor-menu-manager";
import { VendorMenuOnboarding } from "@/components/vendor-menu-onboarding";
import { getSession } from "@/lib/auth0";
import { vendorMenuDraftsCollection, vendorMenuItemsCollection } from "@/lib/collections";
import { mappableOptionsFrom } from "@/lib/menu-extraction";
import { vendorMenuDraftToJson, vendorMenuItemToJson } from "@/lib/serializers";
import { loadActiveTaxonomy } from "@/lib/taxonomy";
import { getCurrentVendorContext } from "@/lib/vendors";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

const MENU_CATEGORIES = ["drink", "milk", "addon"] as const;

export default async function VendorMenuPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor/menu");

  const context = await getCurrentVendorContext();
  if (!context) redirect("/vendor");

  const [taxonomy, menuItems, drafts] = await Promise.all([
    loadActiveTaxonomy(),
    vendorMenuItemsCollection(),
    vendorMenuDraftsCollection(),
  ]);
  const items = await menuItems.find({ vendorId: context.vendor._id }).toArray();
  const itemBySlug = new Map(items.map((item) => [item.taxonomySlug, vendorMenuItemToJson(item)]));

  const sections: MenuSection[] = MENU_CATEGORIES.map((category) => ({
    category,
    options: taxonomy[category].map((option) => ({
      slug: option.slug,
      label: option.label,
      item: itemBySlug.get(option.slug) ?? null,
    })),
  }));

  const taxonomyEmpty = sections.every((section) => section.options.length === 0);
  const mappableOptions = mappableOptionsFrom(taxonomy);
  const draft = await drafts.findOne({ vendorId: context.vendor._id });
  const draftJson = draft ? vendorMenuDraftToJson(draft) : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu</h1>
          <p className="text-sm text-neutral-500">{context.vendor.businessName}</p>
        </div>
        <Link href="/vendor" className="text-sm text-amber-800 hover:underline">
          Back to orders
        </Link>
      </header>

      {taxonomyEmpty ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
          The platform menu hasn&apos;t been set up yet. Ask the BrewPass team to seed the option
          taxonomy.
        </p>
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            Map your offerings onto the BrewPass menu. Until you publish anything here, you&apos;re
            treated as offering the full standard menu.
          </p>
          <VendorMenuOnboarding options={mappableOptions} initialDraft={draftJson} />
          <VendorMenuManager sections={sections} />
        </>
      )}
    </main>
  );
}
