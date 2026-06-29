"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { HealthSummary } from "@/lib/health";

/** Opt-in caffeine/sugar insights — estimates only, user-toggleable. */
export function HealthCard({
  optedIn,
  summary,
}: {
  optedIn: boolean;
  summary: HealthSummary | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle(optIn: boolean) {
    setBusy(true);
    try {
      await fetch("/api/me/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!optedIn) {
    return (
      <Card className="flex items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-semibold text-espresso">Health insights</h2>
          <p className="text-sm text-coffee">
            Curious about your caffeine and sugar? Opt in for weekly estimates.
          </p>
        </div>
        <Button variant="secondary" onClick={() => toggle(true)} disabled={busy}>
          Opt in
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-espresso">Health insights · last 7 days</h2>
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={busy}
          className="text-xs text-muted hover:underline disabled:opacity-50"
        >
          Opt out
        </button>
      </div>
      {summary && summary.cups > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="font-mono text-2xl font-semibold text-espresso">{summary.cups}</p>
            <p className="text-xs text-muted">coffees</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-semibold text-espresso">~{summary.caffeineMg}mg</p>
            <p className="text-xs text-muted">caffeine (~{summary.avgCaffeineMgPerDay}mg/day)</p>
          </div>
          <div>
            <p className="font-mono text-2xl font-semibold text-espresso">~{summary.sugarG}g</p>
            <p className="text-xs text-muted">sugar</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-coffee">No coffees in the last 7 days yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">
        Rough estimates from your order history — not medical advice.
      </p>
    </Card>
  );
}
