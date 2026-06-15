import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import {
  createOnboardingLink,
  getOrCreateConnectAccount,
  syncConnectStatus,
} from "@/lib/payments/connect";
import { getCurrentVendorContext } from "@/lib/vendors";

export const runtime = "nodejs";

/** Current Connect status for the vendor (refreshed from Stripe). */
export async function GET() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const status = await syncConnectStatus(context.vendor);
  return NextResponse.json(status);
}

/**
 * Start (or resume) Stripe Connect onboarding: ensure the connected account
 * exists and return a Stripe-hosted onboarding link. Stripe handles all
 * bank/KYC — we never collect payout details (critical rule #9).
 */
export async function POST() {
  const context = await getCurrentVendorContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = await getOrCreateConnectAccount(context.vendor);
  const url = await createOnboardingLink(accountId, requireEnv("APP_BASE_URL"));
  return NextResponse.json({ url });
}
