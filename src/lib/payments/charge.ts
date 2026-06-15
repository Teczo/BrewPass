import type Stripe from "stripe";

import { getStripe } from "@/lib/stripe";

/**
 * Per-day coffee charge (Phase E). At an order's cutoff the saved card is
 * charged the order's gross price into the **platform balance** — a plain
 * PaymentIntent with no transfer_data. The vendor is paid separately, only
 * after delivery (critical rule #4: separate charges and transfers, not card
 * auth holds).
 *
 * Idempotent per order via the Stripe idempotency key `coffee_<orderId>`: a
 * re-run of the cutoff job (or our retry) can never double-charge
 * (critical rule #1). Policy on failure: retry once, then skip.
 */

export type ChargeResult = { ok: true; paymentIntentId: string } | { ok: false; reason: string };

/** Retry-once wrapper. The same idempotency key is reused so a transient
 * network failure that actually completed on Stripe's side resolves to the
 * same PaymentIntent instead of charging twice. */
async function withRetryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    try {
      return await fn();
    } catch {
      throw first;
    }
  }
}

export async function chargeOrderCoffee(args: {
  orderId: string;
  customerId: string;
  paymentMethodId: string;
  amountSen: number;
  drinkName: string;
}): Promise<ChargeResult> {
  const { orderId, customerId, paymentMethodId, amountSen, drinkName } = args;
  if (!Number.isInteger(amountSen) || amountSen <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  try {
    const stripe = getStripe();
    const intent = await withRetryOnce(() =>
      stripe.paymentIntents.create(
        {
          amount: amountSen,
          currency: "myr",
          customer: customerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `BrewPass coffee: ${drinkName}`,
          metadata: { orderId, kind: "coffee" },
        },
        { idempotencyKey: `coffee_${orderId}` },
      ),
    );

    if (intent.status === "succeeded") {
      return { ok: true, paymentIntentId: intent.id };
    }
    return { ok: false, reason: `payment_intent_${intent.status}` };
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as Stripe.StripeRawError).code ?? "charge_failed")
        : "charge_failed";
    return { ok: false, reason };
  }
}

/**
 * Refund a coffee charge in full (Phase E) — used when delivery fails after
 * the user was charged, or on dispute. Idempotent via `refund_<orderId>`.
 */
export async function refundOrderCoffee(
  orderId: string,
  paymentIntentId: string,
): Promise<ChargeResult> {
  try {
    const stripe = getStripe();
    const refund = await withRetryOnce(() =>
      stripe.refunds.create(
        { payment_intent: paymentIntentId, metadata: { orderId } },
        { idempotencyKey: `refund_${orderId}` },
      ),
    );
    return { ok: true, paymentIntentId: refund.id };
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as Stripe.StripeRawError).code ?? "refund_failed")
        : "refund_failed";
    return { ok: false, reason };
  }
}
