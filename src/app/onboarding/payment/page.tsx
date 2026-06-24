import Link from "next/link";
import { redirect } from "next/navigation";

import { SaveCardButton } from "@/components/save-card-button";
import { StepIndicator } from "@/components/step-indicator";
import { getCurrentSubscription } from "@/lib/billing";
import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

export default async function OnboardingPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/onboarding/payment");

  const [params, subscription] = await Promise.all([
    searchParams,
    getCurrentSubscription(user._id),
  ]);
  // The membership activates from the checkout webhook, which can lag the
  // redirect — treat a `?success=1` return as saved so we don't bounce the
  // user back to the card form.
  const cardSaved =
    Boolean(params.success) ||
    (subscription?.billingMode === "card_on_file" && subscription.status !== "canceled");

  return (
    <section className="flex flex-col gap-6">
      <StepIndicator current={4} />

      <div className="flex flex-col gap-3 rounded-md border border-neutral-200 p-5">
        <h1 className="text-xl font-semibold tracking-tight">Add your card</h1>
        <p className="text-sm text-neutral-500">
          No subscription fee and no charge today. We save your card now and charge it only for the
          coffee you actually get — each day, at that day&apos;s cutoff. You can pause or stop any
          time.
        </p>

        {params.canceled && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Card setup was canceled — no card saved yet.
          </p>
        )}

        {cardSaved ? (
          <>
            <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Card saved — you&apos;re all set. Your coffee starts on your next scheduled day.
            </p>
            <Link
              href="/dashboard"
              className="rounded-md bg-amber-800 px-4 py-2 text-center font-medium text-white hover:bg-amber-700"
            >
              Go to dashboard
            </Link>
          </>
        ) : (
          <>
            <SaveCardButton returnTo="onboarding" label="Save my card & finish" />
            <Link href="/dashboard" className="text-sm text-neutral-500 hover:underline">
              I&apos;ll add it later
            </Link>
          </>
        )}
      </div>
    </section>
  );
}
