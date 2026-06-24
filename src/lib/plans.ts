import type { SubscriptionPlan } from "@/lib/models";

/**
 * Plan catalogue.
 *
 * **Current model (charge-then-deliver, per coffee).** Individuals are no
 * longer sold a priced monthly tier. At signup the card is saved (Stripe
 * SetupIntent, no upfront charge) and each coffee is charged at its own
 * cutoff. The only plan an individual gets is `standard` — no price, no quota
 * cap; the weekly schedule in their Preference decides which days produce a
 * coffee. `quota` is retained on the record for backward compatibility but is
 * not a cap for card-on-file memberships (see `evaluateGeneration`/
 * `evaluateCutoff`).
 *
 * The priced tiers below (`lite`/`weekday`/`premium`/`student`) are **legacy**:
 * kept only so historical/migrated subscriptions still resolve a name. They are
 * not offered in the UI. Corporate is the team flow (billed per delivered
 * office coffee on the company card — no seats).
 */
export interface PlanDefinition {
  plan: SubscriptionPlan;
  name: string;
  priceSen: number;
  /** Coffees included per billing month. 0 = no cap (card-on-file). */
  quota: number;
  description: string;
  /** Stripe price lookup key — stable handle for resolving/creating prices. */
  lookupKey: string;
}

export const PLANS: Record<SubscriptionPlan, PlanDefinition> = {
  standard: {
    plan: "standard",
    name: "Pay as you go",
    priceSen: 0,
    quota: 0,
    description: "A coffee on every day you schedule — charged per coffee, no monthly fee.",
    lookupKey: "brewpass_standard_card_on_file",
  },
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
  student: {
    plan: "student",
    name: "Student",
    priceSen: 14900,
    quota: 22,
    description: "22 coffees a month at the Lite price — for verified students.",
    lookupKey: "brewpass_student_monthly",
  },
  corporate: {
    plan: "corporate",
    name: "Corporate",
    priceSen: 19900,
    quota: 22,
    description: "Per seat: 22 coffees a month for every team member.",
    lookupKey: "brewpass_corporate_seat_monthly",
  },
};

export const PLAN_LIST = Object.values(PLANS);

/** The single plan a new individual membership gets — card-on-file, per-coffee
 * charging, no priced tier. */
export const DEFAULT_INDIVIDUAL_PLAN = PLANS.standard;

export function planByLookupKey(lookupKey: string): PlanDefinition | undefined {
  return PLAN_LIST.find((plan) => plan.lookupKey === lookupKey);
}
