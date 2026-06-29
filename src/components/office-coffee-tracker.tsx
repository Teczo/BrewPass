"use client";

import { useState } from "react";

import { DeliveryTracker } from "@/components/delivery-tracker";
import { Card, SectionLabel } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";

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

const STATUS_TONES: Record<string, StatusTone> = {
  delivered: "delivered",
  out_for_delivery: "preparing",
  preparing: "preparing",
  scheduled: "scheduled",
  confirmed: "scheduled",
  failed: "failed",
  skipped: "skipped",
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
    <section className="flex flex-col gap-3">
      <SectionLabel>Office coffee</SectionLabel>
      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const arriving =
            item.status === "delivered" ? "Delivered" : `Arriving ~${item.etaLabel}`;
          return (
            <Card as="li" key={item.orderId} className="flex flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-espresso">{arriving}</span>
                  <span className="text-sm text-coffee">
                    {item.drinkName} · {item.locationLabel}
                  </span>
                  <span className="text-xs text-muted">
                    {item.date} · {item.detail} · {item.company}
                  </span>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <StatusPill tone={STATUS_TONES[item.status] ?? "scheduled"}>
                    {item.statusLabel}
                  </StatusPill>
                  {item.trackable && (
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMap((cur) => (cur === item.orderId ? null : item.orderId))
                      }
                      className="text-xs font-semibold text-coffee hover:underline"
                    >
                      {openMap === item.orderId ? "Hide map" : "Track"}
                    </button>
                  )}
                </div>
              </div>
              {item.trackable && openMap === item.orderId && (
                <DeliveryTracker orderId={item.orderId} />
              )}
            </Card>
          );
        })}
      </ul>
    </section>
  );
}
