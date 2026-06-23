"use client";

import { useState } from "react";

import { DeliveryTracker } from "@/components/delivery-tracker";

export interface OfficeCoffeeItemJson {
  orderId: string;
  date: string;
  drinkName: string;
  detail: string;
  status: string;
  statusLabel: string;
  etaLabel: string;
  locationLabel: string;
  company: string;
  trackable: boolean;
}

const STATUS_CLASS: Record<string, string> = {
  delivered: "bg-green-100 text-green-800",
  out_for_delivery: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-700",
};

/**
 * Phase J.6 — compact office-coffee tracking for members. Shows details + ETA +
 * status at a glance ("arriving ~9:05 · Flat White · Level 12"); the live map is
 * optional and only offered while a coffee is out for delivery, so staff who
 * don't want the map never see it. Renders a flat list of office coffees — not
 * one-delivery-per-order — so Phase L can later group them into a single
 * DeliveryRun without reworking this view.
 */
export function OfficeCoffeeTracker({ items }: { items: OfficeCoffeeItemJson[] }) {
  const [openMap, setOpenMap] = useState<string | null>(null);
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <h2 className="font-semibold">Office coffee</h2>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const arriving = item.status === "delivered" ? "Delivered" : `Arriving ~${item.etaLabel}`;
          return (
            <li key={item.orderId} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-neutral-700">
                  <span className="font-medium text-neutral-900">{arriving}</span> ·{" "}
                  {item.drinkName} · {item.locationLabel}
                  <span className="block text-xs text-neutral-400">
                    {item.date} · {item.detail} · {item.company}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_CLASS[item.status] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {item.statusLabel}
                  </span>
                  {item.trackable && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMap((cur) => (cur === item.orderId ? null : item.orderId))
                      }
                      className="text-xs text-amber-800 hover:underline"
                    >
                      {openMap === item.orderId ? "Hide map" : "Track"}
                    </button>
                  )}
                </span>
              </div>
              {item.trackable && openMap === item.orderId && (
                <DeliveryTracker orderId={item.orderId} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
