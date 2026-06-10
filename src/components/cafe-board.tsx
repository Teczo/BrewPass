"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { OrderJson } from "@/lib/serializers";

export type CafeOrderJson = OrderJson & {
  customerName: string;
  delivery: { status: string; riderId: string | null } | null;
};

const COLUMNS = [
  { status: "confirmed", title: "To prepare", action: "preparing", actionLabel: "Start preparing" },
  {
    status: "preparing",
    title: "In progress",
    action: "out_for_delivery",
    actionLabel: "Ready — hand off",
  },
  { status: "out_for_delivery", title: "Out for delivery", action: null, actionLabel: null },
  { status: "delivered", title: "Delivered", action: null, actionLabel: null },
] as const;

function DeliveryControls({
  order,
  busy,
  onAction,
}: {
  order: CafeOrderJson;
  busy: boolean;
  onAction: (body: object) => void;
}) {
  const [rider, setRider] = useState(order.delivery?.riderId ?? "");

  return (
    <div className="mt-1 flex flex-col gap-2 border-t border-neutral-100 pt-2">
      <div className="flex gap-1">
        <input
          className="min-w-0 flex-1 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          placeholder="Rider name"
          value={rider}
          onChange={(e) => setRider(e.target.value)}
          maxLength={120}
        />
        <button
          type="button"
          onClick={() => onAction({ action: "assign", riderId: rider.trim() })}
          disabled={busy || rider.trim().length === 0}
          className="rounded-md border border-neutral-300 px-2 py-1 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
        >
          {order.delivery?.riderId ? "Reassign" : "Assign"}
        </button>
      </div>
      {order.delivery?.riderId && (
        <p className="text-xs text-neutral-500">Rider: {order.delivery.riderId}</p>
      )}
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onAction({ action: "delivered" })}
          disabled={busy}
          className="flex-1 rounded-md bg-green-700 px-2 py-1.5 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-50"
        >
          Mark delivered
        </button>
        <button
          type="button"
          onClick={() => {
            const reason = window.prompt("Why did the delivery fail?");
            if (reason?.trim()) onAction({ action: "failed", reason: reason.trim() });
          }}
          disabled={busy}
          className="rounded-md border border-red-200 px-2 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Failed
        </button>
      </div>
    </div>
  );
}

function formatKlTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function CafeBoard({ orders }: { orders: CafeOrderJson[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(orderId: string, url: string, payload: object) {
    setBusyId(orderId);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Update failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  function advance(orderId: string, status: string) {
    return post(orderId, `/api/cafe/orders/${orderId}/status`, { status });
  }

  function deliveryAction(orderId: string, payload: object) {
    return post(orderId, `/api/cafe/deliveries/${orderId}`, payload);
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((column) => {
          const columnOrders = orders.filter((order) => order.status === column.status);
          return (
            <section key={column.status} className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-neutral-500">
                {column.title} ({columnOrders.length})
              </h2>
              {columnOrders.length === 0 && (
                <p className="rounded-md border border-dashed border-neutral-200 p-3 text-sm text-neutral-400">
                  Nothing here.
                </p>
              )}
              {columnOrders.map((order) => (
                <article
                  key={order.id}
                  className="flex flex-col gap-1 rounded-md border border-neutral-200 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{order.drink.drink}</p>
                    <span className="text-xs text-neutral-500">
                      {formatKlTime(order.deliverAt)}
                    </span>
                  </div>
                  <p className="text-sm text-neutral-500">
                    {order.drink.size} · {order.drink.milk} ·{" "}
                    {order.drink.sugar === 0 ? "no sugar" : `sugar ${order.drink.sugar}`} ·{" "}
                    {order.drink.strength}
                  </p>
                  {order.drink.notes && (
                    <p className="text-sm text-amber-900">“{order.drink.notes}”</p>
                  )}
                  <p className="text-xs text-neutral-400">
                    {order.customerName} → {order.location.label}
                  </p>
                  {column.action && (
                    <button
                      type="button"
                      onClick={() => advance(order.id, column.action)}
                      disabled={busyId !== null}
                      className="mt-1 rounded-md bg-amber-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {busyId === order.id ? "Updating…" : column.actionLabel}
                    </button>
                  )}
                  {order.status === "out_for_delivery" && (
                    <DeliveryControls
                      order={order}
                      busy={busyId !== null}
                      onAction={(body) => deliveryAction(order.id, body)}
                    />
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
