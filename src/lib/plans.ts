import type { SubscriptionPlan } from "@/lib/models";

/**
 * Plan catalogue — confirmed business decisions (2026-06-09):
 * prices RM149/199/299, quotas 12/22/31 coffees per month, prepaid model
 * (the subscription covers the coffees; orders decrement quota and are
 * never charged individually).
 */
export interface PlanDefinition {
  plan: SubscriptionPlan;
  name: string;
  priceSen: number;
  /** Coffees included per billing month. */
  quota: number;
  description: string;
  /** Stripe price lookup key — stable handle for resolving/creating prices. */
  lookupKey: string;
}

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  lite: {
    plan: "lite",
    name: "Lite",
    priceSen: 14900,
    quota: 12,
    description: "12 coffees a month — about three mornings a week.",
    lookupKey: "brewpass_lite_monthly",
  },
  weekday: {
    plan: "weekday",
    name: "Weekday",
    priceSen: 19900,
    quota: 22,
    description: "22 coffees a month — every working day covered.",
    lookupKey: "brewpass_weekday_monthly",
  },
  premium: {
    plan: "premium",
    name: "Premium",
    priceSen: 29900,
    quota: 31,
    description: "31 coffees a month — your coffee, every single day.",
    lookupKey: "brewpass_premium_monthly",
  },
};

export const PLAN_LIST = Object.values(PLANS);

export function planByLookupKey(lookupKey: string): PlanDefinition | undefined {
  return PLAN_LIST.find((plan) => plan.lookupKey === lookupKey);
}
