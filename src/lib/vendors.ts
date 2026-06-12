import { vendorsCollection } from "@/lib/collections";
import type { User, Vendor } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export interface VendorContext {
  user: User;
  vendor: Vendor;
}

/**
 * Resolve the logged-in user to the vendor they operate. Authority is
 * membership in the vendor's portalUserSubs list (set by an admin), not the
 * role flag alone — a user can't grant themselves portal access by editing
 * their role.
 */
export async function getCurrentVendorContext(): Promise<VendorContext | null> {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const vendors = await vendorsCollection();
  const vendor = await vendors.findOne({ portalUserSubs: user.authSub, status: "active" });
  if (!vendor) return null;

  return { user, vendor };
}
