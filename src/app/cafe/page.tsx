import { redirect } from "next/navigation";

import { CafeBoard, type CafeOrderJson } from "@/components/cafe-board";
import { getSession } from "@/lib/auth0";
import { getCurrentCafeContext } from "@/lib/cafes";
import { deliveriesCollection, ordersCollection, usersCollection } from "@/lib/collections";
import { orderToJson } from "@/lib/serializers";
import { localDateOf, tomorrowLocalDate } from "@/lib/time";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function CafePortalPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/cafe");

  const context = await getCurrentCafeContext();
  if (!context) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-bold">Café portal</h1>
        <p className="max-w-md text-neutral-500">
          This account isn&apos;t linked to a café. Ask the BrewPass team to add you to your
          café&apos;s staff list.
        </p>
        <a href="/auth/logout" className="text-sm text-amber-800 hover:underline">
          Log out
        </a>
      </main>
    );
  }

  const now = new Date();
  const today = localDateOf(now);
  const tomorrow = tomorrowLocalDate(now);

  const orders = await ordersCollection();
  const [todayDocs, tomorrowCount] = await Promise.all([
    orders
      .find({
        cafeId: context.cafe._id,
        date: today,
        status: { $in: ["confirmed", "preparing", "out_for_delivery", "delivered"] },
      })
      .sort({ deliverAt: 1 })
      .toArray(),
    orders.countDocuments({ cafeId: context.cafe._id, date: tomorrow, status: "scheduled" }),
  ]);

  const users = await usersCollection();
  const deliveries = await deliveriesCollection();
  const [customers, deliveryDocs] = await Promise.all([
    users
      .find({ _id: { $in: todayDocs.map((doc) => doc.userId) } })
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

  const boardOrders: CafeOrderJson[] = todayDocs.map((doc) => {
    const delivery = deliveryByOrderId.get(doc._id.toHexString());
    return {
      ...orderToJson(doc),
      customerName: nameById.get(doc.userId.toHexString()) ?? "Customer",
      delivery: delivery ? { status: delivery.status, riderId: delivery.riderId ?? null } : null,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{context.cafe.name}</h1>
          <p className="text-sm text-neutral-500">
            Today&apos;s queue · {today}
            {tomorrowCount > 0 &&
              ` · ${tomorrowCount} order${tomorrowCount === 1 ? "" : "s"} scheduled for tomorrow (locks 6:00 AM)`}
          </p>
        </div>
        <a href="/auth/logout" className="text-sm text-neutral-500 hover:underline">
          Log out
        </a>
      </header>
      <CafeBoard orders={boardOrders} />
    </main>
  );
}
