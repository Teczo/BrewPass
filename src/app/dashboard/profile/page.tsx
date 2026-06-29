import { redirect } from "next/navigation";

import { getOrCreateCurrentUser } from "@/lib/users";

// Session-dependent: must render per-request, never be statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Profile hub route — target of the bottom nav's 4th tab (Phase N.1).
 * Minimal placeholder so the tab resolves; the full hub (Your usual /
 * Locations / Payment / Office coffee / Health summary / Log out) is
 * assembled from existing components in Phase N.6.
 */
export default async function ProfilePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/auth/login?returnTo=/dashboard/profile");
  if (user.role === "cafe" || user.role === "vendor") redirect("/vendor");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-6">
      <h1 className="font-display text-2xl text-espresso">Profile</h1>
      <p className="text-sm text-coffee">
        Your profile hub lands here in Phase N.6.
      </p>
    </main>
  );
}
