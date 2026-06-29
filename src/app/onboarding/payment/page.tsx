import Link from "next/link";
import { redirect } from "next/navigation";

import { SaveCardButton } from "@/components/save-card-button";
import { StepIndicator } from "@/components/step-indicator";
import { buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
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

      <header className="flex flex-col gap-1.5">
        <h1 className="font-display text-[26px] leading-tight text-espresso">
          Save a card to finish
        </h1>
        <p className="text-sm text-coffee">
          No subscription fee. You&apos;re charged only for the coffee you
          actually get — the morning it&apos;s made. Pause or stop any time.
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        {params.canceled && (
          <Notice tone="amber" icon="⚠️">
            Card setup was canceled — no card saved yet.
          </Notice>
        )}

        {cardSaved ? (
          <>
            <Notice tone="sage" icon="✓">
              Card saved — you&apos;re all set. Your coffee starts on your next
              scheduled day.
            </Notice>
            <Link href="/dashboard" className={buttonClasses("primary", "w-full")}>
              Go to dashboard
            </Link>
          </>
        ) : (
          <>
            <SaveCardButton
              returnTo="onboarding"
              label="Save my card & finish"
              className={buttonClasses("primary", "w-full")}
            />
            <p className="text-center text-xs text-muted">
              Saved securely with Stripe · no charge today
            </p>
            <Link
              href="/dashboard"
              className="text-center text-sm font-semibold text-coffee hover:underline"
            >
              I&apos;ll add it later
            </Link>
          </>
        )}
      </Card>
    </section>
  );
}
