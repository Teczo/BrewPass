import Stripe from "stripe";

import { requireEnv } from "@/lib/env";

/** Lazy Stripe client singleton — constructed on first use so builds and
 * unconfigured environments don't require the secret key. */
let client: Stripe | undefined;

export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  }
  return client;
}
