"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
      <section className="flex items-center justify-between rounded-md border border-neutral-200 p-4">
        <div>
          <h2 className="font-semibold">Health insights</h2>
          <p className="text-sm text-neutral-500">
            Curious about your caffeine and sugar? Opt in for weekly estimates.
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggle(true)}
          disabled={busy}
          className="rounded-md border border-amber-800 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50"
        >
          Opt in
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-neutral-200 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Health insights · last 7 days</h2>
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={busy}
          className="text-xs text-neutral-400 hover:underline disabled:opacity-50"
        >
          Opt out
        </button>
      </div>
      {summary && summary.cups > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold">{summary.cups}</p>
            <p className="text-xs text-neutral-500">coffees</p>
          </div>
          <div>
            <p className="text-2xl font-bold">~{summary.caffeineMg}mg</p>
            <p className="text-xs text-neutral-500">
              caffeine (~{summary.avgCaffeineMgPerDay}mg/day)
            </p>
          </div>
          <div>
            <p className="text-2xl font-bold">~{summary.sugarG}g</p>
            <p className="text-xs text-neutral-500">sugar</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">No coffees in the last 7 days yet.</p>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        Rough estimates from your order history — not medical advice.
      </p>
    </section>
  );
}
