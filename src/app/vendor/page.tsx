import Link from "next/link";
import { redirect } from "next/navigation";

import { VendorBoard, type VendorOrderJson } from "@/components/vendor-board";
import { VendorUpcoming, type UpcomingOrderJson } from "@/components/vendor-upcoming";
import { getSession } from "@/lib/auth0";
import { deliveriesCollection, ordersCollection, usersCollection } from "@/lib/collections";
import type { Vendor } from "@/lib/models";
import { orderToJson } from "@/lib/serializers";
import { localDateOf, tomorrowLocalDate } from "@/lib/time";
import { getOrCreateCurrentUser } from "@/lib/users";
import { findVendorForUser } from "@/lib/vendors";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="flex max-w-md flex-col gap-3 text-neutral-500">{children}</div>
      <a href="/auth/logout" className="text-sm text-amber-800 hover:underline">
        Log out
      </a>
    </main>
  );
}

const STATUS_LABELS: Record<Vendor["status"], string> = {
  pending: "pending review",
  rejected: "rejected",
  active: "accepting orders",
  paused: "paused",
  suspended: "suspended",
  offline: "offline",
};

const SUSPEND_REASON: Record<string, string> = {
  low_rating: "low ratings",
  low_acceptance: "a low acceptance rate",
  low_ontime: "too many late deliveries",
};

/** Phase G: vendor-facing quality scorecard (rating, acceptance, on-time)
 * plus the auto-suspension banner when flagged. */
function VendorQualityStrip({ vendor }: { vendor: Vendor }) {
  const pct = (value?: number) => (value == null ? "—" : `${Math.round(value * 100)}%`);
  return (
    <section className="rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Quality</h2>
        {vendor.qualitySuspendedAt && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Paused by quality review
          </span>
        )}
      </div>
      {vendor.qualitySuspendedAt && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          You&apos;re temporarily not receiving new orders due to{" "}
          {SUSPEND_REASON[vendor.qualityFlagReason ?? ""] ?? "quality issues"}. Contact support to
          review.
        </p>
      )}
      <div className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-2xl font-bold">
            {vendor.ratingScore != null ? vendor.ratingScore.toFixed(1) : "—"}
            <span className="text-base font-normal text-neutral-400">★</span>
          </p>
          <p className="text-xs text-neutral-500">{vendor.ratingCount ?? 0} ratings</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{pct(vendor.acceptanceRate)}</p>
          <p className="text-xs text-neutral-500">accepted</p>
        </div>
        <div>
          <p className="text-2xl font-bold">{pct(vendor.onTimeRate)}</p>
          <p className="text-xs text-neutral-500">on time</p>
        </div>
      </div>
    </section>
  );
}

export default async function VendorPortalPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/vendor");

  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/vendor");

  const vendor = await findVendorForUser(user);

  if (!vendor) {
    return (
      <Notice title="Vendor portal">
        <p>
          This account isn&apos;t linked to a vendor yet. Run a coffee business? Apply to join the
          BrewPass marketplace.
        </p>
        <Link
          href="/vendor/apply"
          className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          Apply as a vendor
        </Link>
        <Link href="/dashboard" className="text-sm text-amber-800 hover:underline">
          Back to dashboard
        </Link>
      </Notice>
    );
  }

  if (vendor.status === "pending") {
    return (
      <Notice title="Application under review">
        <p>
          Thanks for applying, <span className="font-medium">{vendor.businessName}</span>! The
          BrewPass team is reviewing your application — we&apos;ll email you once it&apos;s
          approved.
        </p>
      </Notice>
    );
  }

  if (vendor.status === "rejected") {
    return (
      <Notice title="Application declined">
        <p>
          Unfortunately the application for{" "}
          <span className="font-medium">{vendor.businessName}</span> wasn&apos;t approved.
        </p>
        {vendor.reviewNote && <p className="text-sm italic">“{vendor.reviewNote}”</p>}
        <Link
          href="/vendor/apply"
          className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          Apply again
        </Link>
      </Notice>
    );
  }

  if (vendor.status === "suspended") {
    return (
      <Notice title="Account suspended">
        <p>
          <span className="font-medium">{vendor.businessName}</span> has been suspended by the
          BrewPass team. Contact support to resolve this.
        </p>
      </Notice>
    );
  }

  // Operational statuses (active/paused/offline): the fulfillment board.
  const now = new Date();
  const today = localDateOf(now);
  const tomorrow = tomorrowLocalDate(now);

  const orders = await ordersCollection();
  const [todayDocs, tomorrowDocs] = await Promise.all([
    orders
      .find({
        vendorId: vendor._id,
        date: today,
        status: { $in: ["confirmed", "preparing", "out_for_delivery", "delivered"] },
      })
      .sort({ deliverAt: 1 })
      .toArray(),
    orders
      .find({ vendorId: vendor._id, date: tomorrow, status: "scheduled" })
      .sort({ deliverAt: 1 })
      .toArray(),
  ]);
  const tomorrowCount = tomorrowDocs.length;

  const users = await usersCollection();
  const deliveries = await deliveriesCollection();
  const customerIds = [...todayDocs, ...tomorrowDocs].map((doc) => doc.userId);
  const [customers, deliveryDocs] = await Promise.all([
    users
      .find({ _id: { $in: customerIds } })
      .project<{ _id: (typeof todayDocs)[number]["userId"]; name: string }>({ name: 1 })
      .toArray(),
    deliveries.find({ orderId: { $in: todayDocs.map((doc) => doc._id) } }).toArray(),
  ]);
  const nameById = new Map(
    customers.map((customer) => [customer._id.toHexString(), customer.name]),
  );
  const deliveryByOrderId = new Map(
    deliveryDocs.map((delivery) => [delivery.orderId.toHexString(), delivery]),
  );

  const boardOrders: VendorOrderJson[] = todayDocs.map((doc) => {
    const delivery = deliveryByOrderId.get(doc._id.toHexString());
    return {
      ...orderToJson(doc),
      customerName: nameById.get(doc.userId.toHexString()) ?? "Customer",
      delivery: delivery ? { status: delivery.status, riderId: delivery.riderId ?? null } : null,
    };
  });

  const upcomingOrders: UpcomingOrderJson[] = tomorrowDocs.map((doc) => ({
    id: doc._id.toHexString(),
    drinkName: doc.drink.drink,
    detail: `${doc.drink.size} · ${doc.drink.milk} · ${doc.drink.strength}`,
    customerName: nameById.get(doc.userId.toHexString()) ?? "Customer",
    deliverAt: doc.deliverAt.toISOString(),
  }));

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {vendor.businessName}{" "}
            <span
              className={`align-middle text-xs font-medium ${
                vendor.status === "active" ? "text-green-700" : "text-neutral-400"
              }`}
            >
              · {STATUS_LABELS[vendor.status]}
            </span>
          </h1>
          <p className="text-sm text-neutral-500">
            Today&apos;s queue · {today}
            {tomorrowCount > 0 &&
              ` · ${tomorrowCount} order${tomorrowCount === 1 ? "" : "s"} scheduled for tomorrow (locks 6:00 AM)`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/vendor/menu" className="text-sm text-amber-800 hover:underline">
            Menu
          </Link>
          <Link href="/vendor/capacity" className="text-sm text-amber-800 hover:underline">
            Capacity
          </Link>
          <Link href="/vendor/earnings" className="text-sm text-amber-800 hover:underline">
            Earnings
          </Link>
          <Link href="/vendor/profile" className="text-sm text-amber-800 hover:underline">
            Profile &amp; hours
          </Link>
          <a href="/auth/logout" className="text-sm text-neutral-500 hover:underline">
            Log out
          </a>
        </div>
      </header>
      <VendorQualityStrip vendor={vendor} />
      <VendorBoard orders={boardOrders} />
      <VendorUpcoming orders={upcomingOrders} />
    </main>
  );
}
