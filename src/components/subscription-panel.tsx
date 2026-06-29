"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import type { SubscriptionJson } from "@/lib/serializers";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  paused: "Paused",
  past_due: "Payment overdue",
  incomplete: "Awaiting payment",
  canceled: "Canceled",
};

const STATUS_TONES: Record<string, StatusTone> = {
  active: "active",
  trialing: "active",
  paused: "skipped",
  past_due: "failed",
  incomplete: "scheduled",
  canceled: "failed",
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
  // Card-on-file memberships pay per coffee — no monthly quota to show.
  const perCoffee = subscription.billingMode === "card_on_file";
  const quotaLeft = Math.max(0, subscription.quota.total - subscription.quota.used);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <SectionLabel>
            BrewPass · {perCoffee ? "Pay as you go" : planName}
          </SectionLabel>
          <StatusPill tone={STATUS_TONES[subscription.status] ?? "scheduled"}>
            {STATUS_LABELS[subscription.status] ?? subscription.status}
          </StatusPill>
          <p className="text-sm text-coffee">
            {perCoffee ? (
              <>Charged per coffee. No monthly fee — only when one is made.</>
            ) : (
              <>
                {subscription.cancelAtPeriodEnd
                  ? `Ends ${periodEnd}`
                  : subscription.status === "active"
                    ? `Renews ${periodEnd}`
                    : STATUS_LABELS[subscription.status]}
              </>
            )}
          </p>
        </div>
        {!perCoffee && (
          <span className="shrink-0 font-mono text-sm font-semibold text-espresso">
            {quotaLeft}/{subscription.quota.total}
          </span>
        )}
      </div>

      {!perCoffee && (
        <div className="h-2 overflow-hidden rounded-full bg-hairline">
          <div
            className="h-full bg-coffee"
            style={{
              width: `${Math.min(100, (subscription.quota.used / Math.max(1, subscription.quota.total)) * 100)}%`,
            }}
          />
        </div>
      )}

      {!manageable && (
        <p className="text-sm text-muted">
          This plan is managed by your company&apos;s billing owner.
        </p>
      )}

      {manageable && (
        <div className="flex flex-wrap gap-3">
          {subscription.status === "active" && !subscription.cancelAtPeriodEnd && (
            <Button variant="secondary" onClick={() => manage("pause")} disabled={busy}>
              Pause coffee
            </Button>
          )}
          {subscription.status === "paused" && (
            <Button onClick={() => manage("resume")} disabled={busy}>
              Resume
            </Button>
          )}
          {subscription.cancelAtPeriodEnd ? (
            <Button onClick={() => manage("reactivate")} disabled={busy}>
              Keep my plan
            </Button>
          ) : (
            subscription.status !== "canceled" && (
              <Button variant="danger" onClick={() => manage("cancel")} disabled={busy}>
                Cancel
              </Button>
            )
          )}
        </div>
      )}
      {error && <p className="text-sm text-terracotta">{error}</p>}
    </Card>
  );
}
