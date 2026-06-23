import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";

import type { CorporateAccount, Order, User } from "@/lib/models";
import { resolveChargeCard } from "@/lib/payments/charge-card";

const user = {
  stripeCustomerId: "cus_member",
  defaultPaymentMethodId: "pm_member",
} as unknown as User;

const account = {
  _id: new ObjectId(),
  stripeCustomerId: "cus_company",
  companyStripePaymentMethodId: "pm_company",
} as unknown as CorporateAccount;

function personalOrder(): Pick<Order, "source" | "corporateAccountId"> {
  return { source: "personal" };
}
function officeOrder(): Pick<Order, "source" | "corporateAccountId"> {
  return { source: "corporate", corporateAccountId: account._id };
}

describe("resolveChargeCard — strict personal/company card separation (rule #17)", () => {
  it("charges a personal order to the member's own card", () => {
    expect(resolveChargeCard(personalOrder(), { user, account })).toEqual({
      ok: true,
      card: { customerId: "cus_member", paymentMethodId: "pm_member" },
    });
  });

  it("charges an office order to the company card", () => {
    expect(resolveChargeCard(officeOrder(), { user, account })).toEqual({
      ok: true,
      card: { customerId: "cus_company", paymentMethodId: "pm_company" },
    });
  });

  it("never falls back to the member card for an office order (no cross-charge)", () => {
    // Company card missing → fail; must NOT use the member's card even though
    // it's present in ctx.
    const result = resolveChargeCard(officeOrder(), {
      user,
      account: { ...account, companyStripePaymentMethodId: undefined } as CorporateAccount,
    });
    expect(result).toEqual({ ok: false, reason: "no_company_card" });
  });

  it("never falls back to the company card for a personal order (no cross-charge)", () => {
    const result = resolveChargeCard(personalOrder(), {
      user: { stripeCustomerId: undefined, defaultPaymentMethodId: undefined } as User,
      account,
    });
    expect(result).toEqual({ ok: false, reason: "no_saved_card" });
  });

  it("fails an office order with no account resolved", () => {
    expect(resolveChargeCard(officeOrder(), { user, account: null })).toEqual({
      ok: false,
      reason: "no_corporate_account",
    });
  });
});
