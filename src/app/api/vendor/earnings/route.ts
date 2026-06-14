import { NextResponse } from "next/server";

import { ordersCollection, vendorPayoutsCollection } from "@/lib/collections";
import { vendorPayoutToJson } from "@/lib/serializers";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/**
 * Vendor earnings view (Phase E): held funds awaiting payout (delivered but
 * not yet swept), lifetime paid net, and recent payout statements. Scoped to
 * the caller's own vendor.
 */
export async function GET() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vendorId = context.vendor._id;
  const [orders, payouts] = await Promise.all([ordersCollection(), vendorPayoutsCollection()]);

  const [pending, paid, recentPayouts] = await Promise.all([
    orders
      .aggregate<{
        net: number;
        count: number;
      }>([
        { $match: { vendorId, status: "delivered", payoutStatus: "pending" } },
        { $group: { _id: null, net: { $sum: "$vendorNetAmountSen" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    payouts
      .aggregate<{
        net: number;
        count: number;
      }>([
        { $match: { vendorId, status: "paid" } },
        { $group: { _id: null, net: { $sum: "$netSen" }, count: { $sum: 1 } } },
      ])
      .toArray(),
    payouts.find({ vendorId }).sort({ createdAt: -1 }).limit(20).toArray(),
  ]);

  return NextResponse.json({
    payoutCadence: context.vendor.payoutCadence ?? "daily_batch",
    connectReady: context.vendor.connectPayoutsEnabled === true,
    pendingNetSen: pending[0]?.net ?? 0,
    pendingCount: pending[0]?.count ?? 0,
    paidNetSen: paid[0]?.net ?? 0,
    paidCount: paid[0]?.count ?? 0,
    payouts: recentPayouts.map(vendorPayoutToJson),
  });
}
