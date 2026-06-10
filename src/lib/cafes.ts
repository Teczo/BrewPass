import { cafesCollection } from "@/lib/collections";
import type { Cafe, User } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

export interface CafeContext {
  user: User;
  cafe: Cafe;
}

/**
 * Resolve the logged-in user to the café they operate. Authority is
 * membership in the café's portalUserSubs list (set by an admin), not the
 * role flag alone — a user can't grant themselves café access by editing
 * their role.
 */
export async function getCurrentCafeContext(): Promise<CafeContext | null> {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const cafes = await cafesCollection();
  const cafe = await cafes.findOne({ portalUserSubs: user.authSub, active: true });
  if (!cafe) return null;

  return { user, cafe };
}
