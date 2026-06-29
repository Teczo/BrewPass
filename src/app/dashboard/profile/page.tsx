import Link from "next/link";
import { redirect } from "next/navigation";

import { HealthCard } from "@/components/health-card";
import { buttonClasses } from "@/components/ui/button";
import { Card, SectionLabel } from "@/components/ui/card";
import { StatusPill } from "@/components/ui/status-pill";
import { getCurrentSubscription } from "@/lib/billing";
import { locationsCollection, ordersCollection, preferencesCollection } from "@/lib/collections";
import { listMemberOffices } from "@/lib/corporate/roster";
import { summarizeHealth } from "@/lib/health";
import { personalPreferenceFilter } from "@/lib/preferences";
import { addDaysLocal, localDateOf } from "@/lib/time";
import { getOnboardingStatus, getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Profile hub (Phase N.6) — the bottom nav's 4th tab. A read-friendly summary
 * of the subscriber's settings, each linking out to the screen that edits it.
 * Assembled from existing data/components; no new behavior.
 */
export default async function ProfilePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/profile");
  if (user.role === "cafe" || user.role === "vendor") redirect("/vendor");

  const status = await getOnboardingStatus(user);
  if (!status.completed) redirect("/onboarding");

  const [locations, preferences, orders] = await Promise.all([
    locationsCollection(),
    preferencesCollection(),
    ordersCollection(),
  ]);
  const today = localDateOf(new Date());
  const [locationDocs, preference, subscription, offices] = await Promise.all([
    locations.find({ userId: user._id }).sort({ createdAt: 1 }).toArray(),
    preferences.findOne(personalPreferenceFilter(user._id)),
    getCurrentSubscription(user._id),
    listMemberOffices(user._id),
  ]);

  const defaultLocation = preference
    ? locationDocs.find((location) => location._id.equals(preference.defaultLocationId))
    : undefined;

  const hasLiveSubscription = subscription !== null && subscription.status !== "canceled";
  const cardOnFile = hasLiveSubscription && subscription.billingMode === "card_on_file";

  const healthSummary = user.healthOptInAt
    ? summarizeHealth(
        (
          await orders
            .find({
              userId: user._id,
              date: { $gte: addDaysLocal(today, -7), $lt: today },
              status: { $in: ["confirmed", "preparing", "out_for_delivery", "delivered"] },
            })
            .toArray()
        ).map((order) => order.drink),
        7,
      )
    : null;

  const firstName = user.name.split(" ")[0];

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-6">
      <header className="flex items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-espresso font-display text-2xl text-white">
          {firstName.charAt(0).toUpperCase()}
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl leading-tight text-espresso">{user.name}</h1>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{user.email}</span>
            <StatusPill tone="active">Subscriber</StatusPill>
          </div>
        </div>
      </header>

      {/* Your usual */}
      <Link href="/onboarding/preferences" className="block">
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <SectionLabel>Your usual</SectionLabel>
            {preference ? (
              <>
                <p className="font-display text-lg text-espresso">
                  {preference.defaultDrink.drink} · {preference.defaultDrink.size}
                </p>
                <p className="text-sm text-coffee">
                  {preference.defaultDrink.milk} ·{" "}
                  {preference.defaultDrink.sugar === 0
                    ? "no sugar"
                    : `sugar ${preference.defaultDrink.sugar}`}{" "}
                  · {preference.defaultDrink.strength}
                </p>
                <p className="text-sm text-muted">
                  {preference.schedule.days.map((day) => WEEKDAY_LABELS[day]).join(", ")} ·{" "}
                  {preference.schedule.time}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">Not set yet.</p>
            )}
          </div>
          <span className="text-muted">›</span>
        </Card>
      </Link>

      {/* Locations */}
      <Link href="/onboarding/locations" className="block">
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <SectionLabel>Locations</SectionLabel>
            {defaultLocation ? (
              <p className="text-sm text-coffee">
                <span className="font-semibold text-espresso">{defaultLocation.label}</span> ·{" "}
                {defaultLocation.address}
              </p>
            ) : locationDocs.length > 0 ? (
              <p className="text-sm text-coffee">
                {locationDocs.length} saved location{locationDocs.length === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="text-sm text-muted">None yet.</p>
            )}
          </div>
          <span className="text-muted">›</span>
        </Card>
      </Link>

      {/* Payment */}
      <Link href="/dashboard/billing" className="block">
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <SectionLabel>Payment</SectionLabel>
            <p className="text-sm text-coffee">
              {cardOnFile
                ? "Card on file · charged per coffee"
                : hasLiveSubscription
                  ? "Active plan"
                  : "No card on file yet"}
            </p>
          </div>
          <span className="text-muted">›</span>
        </Card>
      </Link>

      {/* Office coffee */}
      <Link href="/dashboard/corporate" className="block">
        <Card className="flex items-center justify-between gap-3 p-5">
          <div className="flex flex-col gap-1">
            <SectionLabel>Office coffee</SectionLabel>
            {offices.length > 0 ? (
              <p className="text-sm text-coffee">
                <span className="font-semibold text-espresso">{offices[0].company}</span> · joined
                {offices.length > 1 ? ` +${offices.length - 1} more` : ""}
              </p>
            ) : (
              <p className="text-sm text-muted">Join a company or run office coffee</p>
            )}
          </div>
          <span className="text-muted">›</span>
        </Card>
      </Link>

      {/* Health summary */}
      <div className="flex flex-col gap-2">
        <SectionLabel>Health summary</SectionLabel>
        <HealthCard optedIn={Boolean(user.healthOptInAt)} summary={healthSummary} />
      </div>

      <a href="/auth/logout" className={buttonClasses("danger", "w-full")}>
        Log out
      </a>
    </main>
  );
}
