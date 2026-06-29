"use client";

import { useEffect, useState } from "react";

import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";

/**
 * In-app delivery tracking (v2.1). Polls the order's tracking endpoint and
 * renders the driver on our own Google map (Static Maps), so the subscriber
 * never leaves BrewPass. Falls back to the provider share link when live driver
 * location isn't available yet (per CLAUDE.md guidance).
 */

interface TrackingData {
  orderStatus: string;
  provider: string;
  deliveryStatus: string | null;
  trackingUrl: string | null;
  driver: { name: string; phone: string | null; plate: string | null } | null;
  driverLocation: { lat: number; lng: number; updatedAt: string | null } | null;
  dropoff: { label: string; lat: number; lng: number };
}

const POLL_MS = 15_000;

const DELIVERY_STATUS_LABEL: Record<string, string> = {
  pending: "Finding a driver",
  assigned: "Driver assigned",
  picked_up: "Picked up — on the way",
  delivered: "Delivered",
  failed: "Delivery problem",
};

function staticMapUrl(data: TrackingData): string | null {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key || !data.driverLocation) return null;
  const driver = `${data.driverLocation.lat},${data.driverLocation.lng}`;
  const drop = `${data.dropoff.lat},${data.dropoff.lng}`;
  const params = new URLSearchParams({ size: "640x300", scale: "2", key });
  // Two markers with no explicit center/zoom → Google auto-fits the bounds.
  return (
    `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}` +
    `&markers=${encodeURIComponent(`color:0x7c3aed|label:D|${driver}`)}` +
    `&markers=${encodeURIComponent(`color:red|label:H|${drop}`)}`
  );
}

export function DeliveryTracker({ orderId }: { orderId: string }) {
  const [data, setData] = useState<TrackingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch(`/api/orders/${orderId}/tracking`, { cache: "no-store" });
        if (!response.ok) throw new Error("Couldn't load tracking");
        const payload = (await response.json()) as TrackingData;
        if (!active) return;
        setData(payload);
        setError(null);
        // Stop polling once the order leaves the in-flight states.
        if (payload.orderStatus === "out_for_delivery") {
          timer = setTimeout(poll, POLL_MS);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Tracking unavailable");
        timer = setTimeout(poll, POLL_MS);
      }
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [orderId]);

  if (!data && !error) {
    return (
      <Card className="p-4 text-sm text-muted">Loading delivery tracking…</Card>
    );
  }

  const mapUrl = data ? staticMapUrl(data) : null;
  const statusLabel = data?.deliveryStatus
    ? (DELIVERY_STATUS_LABEL[data.deliveryStatus] ?? data.deliveryStatus)
    : "On its way";

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-espresso">Track your delivery</h2>
        <StatusPill tone="preparing">{statusLabel}</StatusPill>
      </div>

      {mapUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mapUrl}
          alt={`Driver location en route to ${data?.dropoff.label}`}
          className="w-full rounded-2xl border border-hairline"
        />
      ) : (
        <p className="text-sm text-coffee">
          {data?.driverLocation
            ? "Driver is on the way."
            : "We'll show the driver on the map as soon as they're en route."}
        </p>
      )}

      {data?.driver && (
        <p className="text-sm text-coffee">
          <span className="font-semibold text-espresso">{data.driver.name}</span>
          {data.driver.plate && ` · ${data.driver.plate}`}
          {data.driver.phone && (
            <a href={`tel:${data.driver.phone}`} className="ml-2 font-semibold text-coffee hover:underline">
              Call
            </a>
          )}
        </p>
      )}

      {data?.trackingUrl && (
        <a
          href={data.trackingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-coffee hover:underline"
        >
          Trouble loading? Open live tracking →
        </a>
      )}

      {error && <p className="text-xs text-muted">{error} — retrying…</p>}
    </Card>
  );
}
