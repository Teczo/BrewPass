"use client";

import { useEffect, useState } from "react";

import { formatMyr } from "@/lib/format";
import type { VendorJson } from "@/lib/serializers";

interface PayoutRow {
  id: string;
  period: string;
  cadence: "per_order" | "daily_batch";
  orderCount: number;
  netSen: number;
  status: "pending" | "paid" | "failed" | "reversed";
  createdAt: string;
}
interface Earnings {
  payoutCadence: "per_order" | "daily_batch";
  connectReady: boolean;
  pendingNetSen: number;
  pendingCount: number;
  paidNetSen: number;
  paidCount: number;
  payouts: PayoutRow[];
}

const STATUS_STYLE: Record<string, string> = {
  paid: "bg-green-100 text-green-800",
  pending: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-700",
  reversed: "bg-neutral-200 text-neutral-600",
};

export function VendorEarnings({ vendor }: { vendor: VendorJson }) {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [cadence, setCadence] = useState(vendor.payoutCadence);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/vendor/earnings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setEarnings(data);
          setCadence(data.payoutCadence);
        }
      })
      .catch(() => setError("Couldn't load earnings."));
  }, []);

  const connectReady = earnings?.connectReady ?? vendor.connect.payoutsEnabled;

  async function startOnboarding() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendor/connect", { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.url)
        throw new Error(payload?.error ?? "Could not start onboarding");
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  async function changeCadence(next: "per_order" | "daily_batch") {
    const previous = cadence;
    setCadence(next);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/vendor/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payoutCadence: next }),
      });
      if (!response.ok) throw new Error("Could not update payout cadence");
    } catch (err) {
      setCadence(previous);
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Connect onboarding */}
      <section className="rounded-md border border-neutral-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Payouts</h2>
            <p className="text-sm text-neutral-500">
              {connectReady
                ? "Your bank account is connected — payouts are enabled."
                : "Connect your bank with Stripe to receive payouts. Stripe handles all bank and verification details."}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
              connectReady ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
            }`}
          >
            {connectReady ? "Connected" : "Action needed"}
          </span>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={startOnboarding}
          className="mt-3 rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {connectReady ? "Update payout details" : "Connect with Stripe"}
        </button>
      </section>

      {/* Payout cadence */}
      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Payout schedule</h2>
        <p className="text-sm text-neutral-500">
          Funds are always released after delivery — this only sets how often they&apos;re swept to
          you.
        </p>
        <div className="mt-3 flex gap-2">
          {(
            [
              { key: "daily_batch", label: "Daily batch" },
              { key: "per_order", label: "Per order" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              disabled={busy}
              onClick={() => changeCadence(option.key)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                cadence === option.key
                  ? "bg-neutral-900 text-white"
                  : "border border-neutral-300 hover:bg-neutral-50"
              } disabled:opacity-50`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      {/* Totals */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">Held (awaiting payout)</p>
          <p className="text-2xl font-bold">{formatMyr(earnings?.pendingNetSen ?? 0)}</p>
          <p className="text-xs text-neutral-500">{earnings?.pendingCount ?? 0} delivered</p>
        </section>
        <section className="rounded-md border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500">Paid out</p>
          <p className="text-2xl font-bold">{formatMyr(earnings?.paidNetSen ?? 0)}</p>
          <p className="text-xs text-neutral-500">{earnings?.paidCount ?? 0} payouts</p>
        </section>
      </div>

      {/* Statements */}
      <section className="rounded-md border border-neutral-200 p-4">
        <h2 className="font-semibold">Payout history</h2>
        {!earnings || earnings.payouts.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No payouts yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-neutral-100 text-sm">
            {earnings.payouts.map((payout) => (
              <li key={payout.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{payout.period}</span>{" "}
                  <span className="text-neutral-500">
                    · {payout.orderCount} order{payout.orderCount === 1 ? "" : "s"} ·{" "}
                    {payout.cadence === "daily_batch" ? "batch" : "per order"}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">{formatMyr(payout.netSen)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      STATUS_STYLE[payout.status] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {payout.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
