import type { CorporateAccount, Order, User } from "@/lib/models";

/**
 * Phase J.7 — pure resolution of WHICH card a confirmed order is charged to,
 * enforcing the strict separation in critical rule #17: a `personal` order is
 * charged to the member's own saved card; a `corporate` (office) order is
 * charged to the company card. Cross-charging is impossible by construction —
 * the personal branch never reads the account and the corporate branch never
 * reads the user.
 */
export type ChargeCard = { customerId: string; paymentMethodId: string };

export type ChargeCardResult =
  | { ok: true; card: ChargeCard }
  | { ok: false; reason: "no_saved_card" | "no_company_card" | "no_corporate_account" };

export function resolveChargeCard(
  order: Pick<Order, "source" | "corporateAccountId">,
  ctx: { user: User | null; account: CorporateAccount | null },
): ChargeCardResult {
  if (order.source === "corporate") {
    if (!order.corporateAccountId || !ctx.account) {
      return { ok: false, reason: "no_corporate_account" };
    }
    const customerId = ctx.account.stripeCustomerId;
    const paymentMethodId = ctx.account.companyStripePaymentMethodId;
    if (!customerId || !paymentMethodId) return { ok: false, reason: "no_company_card" };
    return { ok: true, card: { customerId, paymentMethodId } };
  }

  const customerId = ctx.user?.stripeCustomerId;
  const paymentMethodId = ctx.user?.defaultPaymentMethodId;
  if (!customerId || !paymentMethodId) return { ok: false, reason: "no_saved_card" };
  return { ok: true, card: { customerId, paymentMethodId } };
}
