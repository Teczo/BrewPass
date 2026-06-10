"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { SubscriptionJson } from "@/lib/serializers";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  paused: "Paused",
  past_due: "Payment overdue",
  incomplete: "Awaiting payment",
  canceled: "Canceled",
};

export function SubscriptionPanel({
  subscription,
  planName,
  manageable = true,
}: {
  subscription: SubscriptionJson;
  planName: string;
  manageable?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function manage(action: "pause" | "resume" | "cancel" | "reactivate") {
    if (action === "cancel" && !window.confirm("Cancel your plan at the end of this period?")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const periodEnd = new Date(subscription.currentPeriodEnd).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const quotaLeft = Math.max(0, subscription.quota.total - subscription.quota.used);

  return (
    <div className="flex flex-col gap-4 rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">BrewPass {planName}</h2>
          <p className="text-sm text-neutral-500">
            {STATUS_LABELS[subscription.status] ?? subscription.status}
            {subscription.cancelAtPeriodEnd && ` · ends ${periodEnd}`}
            {!subscription.cancelAtPeriodEnd &&
              subscription.status === "active" &&
              ` · renews ${periodEnd}`}
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">
          {quotaLeft} of {subscription.quota.total} coffees left
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className="h-full bg-amber-700"
          style={{
            width: `${Math.min(100, (subscription.quota.used / Math.max(1, subscription.quota.total)) * 100)}%`,
          }}
        />
      </div>

      {!manageable && (
        <p className="text-sm text-neutral-500">
          This plan is managed by your company&apos;s billing owner.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {manageable && subscription.status === "active" && !subscription.cancelAtPeriodEnd && (
          <button
            type="button"
            onClick={() => manage("pause")}
            disabled={busy}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
          >
            Pause
          </button>
        )}
        {manageable && subscription.status === "paused" && (
          <button
            type="button"
            onClick={() => manage("resume")}
            disabled={busy}
            className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            Resume
          </button>
        )}
        {manageable &&
          (subscription.cancelAtPeriodEnd ? (
            <button
              type="button"
              onClick={() => manage("reactivate")}
              disabled={busy}
              className="rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Keep my plan
            </button>
          ) : (
            subscription.status !== "canceled" && (
              <button
                type="button"
                onClick={() => manage("cancel")}
                disabled={busy}
                className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Cancel plan
              </button>
            )
          ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
