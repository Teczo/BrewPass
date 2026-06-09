"use client";

import { useState } from "react";

export interface PlanCard {
  plan: string;
  name: string;
  priceLabel: string;
  quota: number;
  description: string;
}

export function PlanPicker({ plans }: { plans: PlanCard[] }) {
  const [error, setError] = useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  async function subscribe(plan: string) {
    setLoadingPlan(plan);
    setError(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not start checkout");
      window.location.assign(body.url as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoadingPlan(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.plan}
            className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4"
          >
            <h3 className="font-semibold">{plan.name}</h3>
            <p className="text-2xl font-bold">
              {plan.priceLabel}
              <span className="text-sm font-normal text-neutral-500">/month</span>
            </p>
            <p className="flex-1 text-sm text-neutral-500">{plan.description}</p>
            <button
              type="button"
              onClick={() => subscribe(plan.plan)}
              disabled={loadingPlan !== null}
              className="rounded-md bg-amber-800 px-4 py-2 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {loadingPlan === plan.plan ? "Redirecting…" : "Subscribe"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
