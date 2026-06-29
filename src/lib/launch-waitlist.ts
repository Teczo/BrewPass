import type { ObjectId } from "mongodb";

import { launchWaitlistCollection, usersCollection, vendorsCollection } from "@/lib/collections";
import type { GeoPoint, LaunchWaitlist, Vendor } from "@/lib/models";
import { newDocumentMeta, suggestMarketFromGeo } from "@/lib/models";
import { isWithinServiceArea } from "@/lib/order-engine/routing";
import { escapeHtml, sendEmail } from "@/lib/notifications";

/**
 * Cold-start launch waitlist (Phase O.1, `fallbacks.md` §1.1/§1.2).
 *
 * Generation records a user here when no vendor's service area covers their
 * address (a coverage gap). When a vendor is later approved `active`, the
 * approval flow matches their area against the unfulfilled list and emails the
 * matched users once. Both paths are idempotent (critical rule #1, §1.2).
 */

/**
 * Pure match test: does this vendor cover a waitlist entry? Same market and
 * within the vendor's service area. Only an `active` vendor can fulfil an entry
 * (a paused/offline vendor doesn't deliver). Unit-tested.
 */
export function vendorCoversWaitlistEntry(
  vendor: Pick<Vendor, "status" | "market" | "geo" | "serviceAreaRadiusKm">,
  entry: Pick<LaunchWaitlist, "market" | "geo">,
): boolean {
  if (vendor.status !== "active") return false;
  if (vendor.market !== entry.market) return false;
  // isWithinServiceArea only reads geo + serviceAreaRadiusKm off the vendor.
  return isWithinServiceArea(vendor as Vendor, entry.geo);
}

/**
 * Record (or refresh) a user's waitlist entry. Idempotent upsert on `userId`:
 * one record per user, and a re-run of generation never clears a fulfilled
 * entry — `notifiedAt`/`notifiedByVendorId` are left untouched, so a user who
 * was already emailed is never emailed again (§1.2). The address/geo/market are
 * refreshed so a later approval matches against the user's current location.
 */
export async function recordWaitlistEntry(args: {
  userId: ObjectId;
  address: string;
  geo: GeoPoint;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const market = suggestMarketFromGeo(args.geo);
  const collection = await launchWaitlistCollection();
  await collection.updateOne(
    { userId: args.userId },
    {
      $set: {
        address: args.address,
        geo: args.geo,
        market,
        updatedAt: now,
      },
      $setOnInsert: {
        ...newDocumentMeta(),
        userId: args.userId,
        createdAt: now,
      },
    },
    { upsert: true },
  );
}

export interface WaitlistMatchSummary {
  vendorId: string;
  matched: number;
  emailed: number;
}

/**
 * Match a newly-active vendor against unfulfilled waitlist entries and email
 * the covered users once (§1.2). Each entry is claimed atomically (the
 * `notifiedAt: { $exists: false }` filter) before its email is sent, so
 * concurrent approvals — or a re-run of this job — can never double-notify
 * (critical rule #1). Best-effort: an email failure still marks the entry
 * fulfilled (claimed before send) and never throws, exactly like notifications.
 */
export async function matchWaitlistForVendor(
  vendor: Vendor,
  now: Date = new Date(),
): Promise<WaitlistMatchSummary> {
  const summary: WaitlistMatchSummary = {
    vendorId: vendor._id.toHexString(),
    matched: 0,
    emailed: 0,
  };
  // A non-active vendor never covers anyone (vendorCoversWaitlistEntry guards
  // this too); skip the scan entirely.
  if (vendor.status !== "active") return summary;

  const collection = await launchWaitlistCollection();
  const candidates = await collection
    .find({ market: vendor.market, notifiedAt: { $exists: false } })
    .toArray();

  const users = await usersCollection();
  for (const entry of candidates) {
    if (!vendorCoversWaitlistEntry(vendor, entry)) continue;
    summary.matched += 1;

    // Claim before sending so a retry/concurrent run can't email twice.
    const claim = await collection.updateOne(
      { _id: entry._id, notifiedAt: { $exists: false } },
      { $set: { notifiedAt: now, notifiedByVendorId: vendor._id, updatedAt: now } },
    );
    if (claim.modifiedCount !== 1) continue; // another run already claimed it

    const user = await users.findOne({ _id: entry.userId });
    if (!user) continue;
    try {
      const ok = await sendEmail({
        to: user.email,
        subject: "Your BrewPass coffee is ready to set up",
        html:
          `<p>Good news${user.name ? `, ${escapeHtml(user.name.split(" ")[0])}` : ""}! ` +
          `<strong>${escapeHtml(vendor.businessName)}</strong> now delivers to ` +
          `${escapeHtml(entry.address)}.</p>` +
          `<p>Open BrewPass to pick your daily coffee — we'll take care of the rest.</p>`,
      });
      if (ok) summary.emailed += 1;
    } catch (error) {
      console.error(`Waitlist email failed for user ${entry.userId.toHexString()}:`, error);
    }
  }
  return summary;
}

/** Whether a user has an unfulfilled waitlist entry (drives the dashboard
 * "launching soon" banner, §1.1/§1.2). Returns the entry so the banner can show
 * the address. */
export async function getActiveWaitlistEntry(userId: ObjectId): Promise<LaunchWaitlist | null> {
  const collection = await launchWaitlistCollection();
  return collection.findOne({ userId, notifiedAt: { $exists: false } });
}

/**
 * Live coverage check for the dashboard cold-start banner (§1.1/§1.2): is any
 * of the user's delivery points covered by an active vendor right now? Driven
 * live (not off the waitlist record) so a brand-new user sees the correct state
 * on day one, before the nightly generation that would create their waitlist
 * entry. Cheap at cold-start, where there are few active vendors by definition.
 */
export async function hasCoverageForAnyPoint(points: GeoPoint[]): Promise<boolean> {
  if (points.length === 0) return false;
  const vendors = await vendorsCollection();
  const active = await vendors.find({ status: "active" }).toArray();
  return points.some((point) => active.some((vendor) => isWithinServiceArea(vendor, point)));
}
