import { vendorsCollection } from "@/lib/collections";
import type { User, Vendor } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";
import { PORTAL_STATUSES } from "@/lib/vendor-rules";

export interface VendorContext {
  user: User;
  vendor: Vendor;
}

/**
 * Resolve the logged-in user to the vendor they operate. Authority is
 * membership in the vendor's portalUserSubs list (the owner is added on
 * application, staff by an admin), not the role flag alone — a user can't
 * grant themselves portal access by editing their role. Paused/offline
 * vendors keep portal access; pending/rejected/suspended do not.
 */
export async function getCurrentVendorContext(): Promise<VendorContext | null> {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const vendor = await findPortalVendorForUser(user);
  if (!vendor) return null;

  return { user, vendor };
}

export async function findPortalVendorForUser(user: User): Promise<Vendor | null> {
  const vendors = await vendorsCollection();
  return vendors.findOne({
    portalUserSubs: user.authSub,
    status: { $in: [...PORTAL_STATUSES] },
  });
}

/**
 * The vendor a user is tied to in ANY status (as owner or staff). Drives
 * the /vendor page state machine: pending/rejected/suspended screens, or
 * the board for operational vendors.
 */
export async function findVendorForUser(user: User): Promise<Vendor | null> {
  const vendors = await vendorsCollection();
  return vendors.findOne({
    $or: [{ portalUserSubs: user.authSub }, { ownerUserId: user._id }],
  });
}
