import type { User } from "@/lib/models";
import { getOrCreateCurrentUser } from "@/lib/users";

/**
 * Admin gate. The first admin is set by flipping role to "admin" directly
 * in the database; after that, admins can promote others from the portal.
 */
export async function getCurrentAdmin(): Promise<User | null> {
  const user = await getOrCreateCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}
