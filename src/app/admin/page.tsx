import { redirect } from "next/navigation";

import {
  AdminCafes,
  AdminOrdersTable,
  AdminUsers,
  type AdminCafeRow,
  type AdminOrderRow,
  type AdminUserRow,
} from "@/components/admin-panels";
import { getCurrentAdmin } from "@/lib/admin";
import { getSession } from "@/lib/auth0";
import {
  cafesCollection,
  ordersCollection,
  subscriptionsCollection,
  usersCollection,
} from "@/lib/collections";
import { localDateOf } from "@/lib/time";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/auth/login?returnTo=/admin");

  const admin = await getCurrentAdmin();
  if (!admin) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-neutral-500">This account doesn&apos;t have operator access.</p>
        <a href="/dashboard" className="text-sm text-amber-800 hover:underline">
          Back to dashboard
        </a>
      </main>
    );
  }

  const today = localDateOf(new Date());
  const [orders, cafes, users, subscriptions] = await Promise.all([
    ordersCollection(),
    cafesCollection(),
    usersCollection(),
    subscriptionsCollection(),
  ]);

  const [todayOrders, cafeDocs, userDocs, activeSubs, totalUsers] = await Promise.all([
    orders.find({ date: today }).sort({ deliverAt: 1 }).limit(200).toArray(),
    cafes.find({}).sort({ name: 1 }).toArray(),
    users.find({}).sort({ createdAt: -1 }).limit(100).toArray(),
    subscriptions.countDocuments({ status: { $in: ["active", "trialing"] } }),
    users.estimatedDocumentCount(),
  ]);

  const nameById = new Map(userDocs.map((user) => [user._id.toHexString(), user.name]));
  const cafeNameById = new Map(cafeDocs.map((cafe) => [cafe._id.toHexString(), cafe.name]));

  // Fill in customer names not in the latest-100 slice.
  const missingUserIds = todayOrders
    .map((order) => order.userId)
    .filter((id) => !nameById.has(id.toHexString()));
  if (missingUserIds.length > 0) {
    const extra = await users
      .find({ _id: { $in: missingUserIds } })
      .project<{ _id: (typeof missingUserIds)[number]; name: string }>({ name: 1 })
      .toArray();
    for (const user of extra) nameById.set(user._id.toHexString(), user.name);
  }

  const statusCounts = new Map<string, number>();
  for (const order of todayOrders) {
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  }
  const failures = todayOrders.filter((order) => order.status === "failed");

  const todayCountByCafe = new Map<string, number>();
  for (const order of todayOrders) {
    const key = order.cafeId.toHexString();
    todayCountByCafe.set(key, (todayCountByCafe.get(key) ?? 0) + 1);
  }

  const orderRows: AdminOrderRow[] = todayOrders.map((order) => ({
    id: order._id.toHexString(),
    customerName: nameById.get(order.userId.toHexString()) ?? "Customer",
    drink: order.drink.drink,
    locationLabel: order.location.label,
    cafeName: cafeNameById.get(order.cafeId.toHexString()) ?? "?",
    status: order.status,
    deliverAt: order.deliverAt.toISOString(),
    failureReason: order.failureReason ?? null,
  }));

  const subByEmail = new Map(userDocs.map((user) => [user.authSub, user.name]));
  const cafeRows: AdminCafeRow[] = cafeDocs.map((cafe) => ({
    id: cafe._id.toHexString(),
    name: cafe.name,
    address: cafe.address,
    capacityPerHour: cafe.capacityPerHour,
    active: cafe.active,
    staff: cafe.portalUserSubs.map((sub) => ({ sub, name: subByEmail.get(sub) ?? sub })),
    todayCount: todayCountByCafe.get(cafe._id.toHexString()) ?? 0,
  }));

  const userRows: AdminUserRow[] = userDocs.map((user) => ({
    id: user._id.toHexString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isSelf: user._id.equals(admin._id),
    studentVerified: Boolean(user.studentVerifiedAt),
  }));

  const stats = [
    { label: "Orders today", value: todayOrders.length },
    { label: "Confirmed", value: statusCounts.get("confirmed") ?? 0 },
    { label: "Delivered", value: statusCounts.get("delivered") ?? 0 },
    { label: "Failed", value: failures.length },
    { label: "Active subscriptions", value: activeSubs },
    { label: "Users", value: totalUsers },
  ];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-neutral-500">
            {today} · signed in as {admin.email}
          </p>
        </div>
        <a href="/auth/logout" className="text-sm text-neutral-500 hover:underline">
          Log out
        </a>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-neutral-200 p-3">
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-xs text-neutral-500">{stat.label}</p>
          </div>
        ))}
      </section>

      {failures.length > 0 && (
        <section className="rounded-md border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-800">Failures today</h2>
          <ul className="mt-1 text-sm text-red-700">
            {failures.map((order) => (
              <li key={order._id.toHexString()}>
                {nameById.get(order.userId.toHexString()) ?? "Customer"} — {order.drink.drink}:{" "}
                {order.failureReason ?? "unknown"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Today&apos;s orders</h2>
        <AdminOrdersTable
          orders={orderRows}
          cafes={cafeRows.filter((cafe) => cafe.active).map(({ id, name }) => ({ id, name }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cafés</h2>
        <AdminCafes cafes={cafeRows} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Users (latest 100)</h2>
        <AdminUsers users={userRows} />
      </section>
    </main>
  );
}
