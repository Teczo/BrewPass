"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface UpcomingOrderJson {
  id: string;
  drinkName: string;
  detail: string;
  customerName: string;
  deliverAt: string;
}

function formatKlTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Tomorrow's not-yet-locked orders. Assignment auto-accepts; a vendor can
 * decline before the 6 AM cutoff, which re-routes the order to another
 * vendor (or fails it if none can fulfil).
 */
export function VendorUpcoming({ orders }: { orders: UpcomingOrderJson[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decline(orderId: string) {
    if (!window.confirm("Decline this order? It will be re-routed to another vendor.")) return;
    setBusyId(orderId);
    setError(null);
    try {
      const response = await fetch(`/api/vendor/orders/${orderId}/decline`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Decline failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-neutral-500">
        Tomorrow&apos;s orders ({orders.length}) · locks 6:00 AM
      </h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="flex flex-col divide-y divide-neutral-100 rounded-md border border-neutral-200">
        {orders.map((order) => (
          <li key={order.id} className="flex items-center justify-between gap-3 p-3">
            <span className="flex flex-col">
              <span className="font-medium">{order.drinkName}</span>
              <span className="text-xs text-neutral-500">
                {order.detail} · {order.customerName} · {formatKlTime(order.deliverAt)}
              </span>
            </span>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => decline(order.id)}
              className="shrink-0 rounded border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {busyId === order.id ? "Declining…" : "Decline"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
