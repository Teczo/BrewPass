import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/**
 * Shared subscriber shell + bottom nav for every `/dashboard/*` screen
 * (Phase N.1). Presentational wrapper only; pages keep their own data
 * fetching, auth guards, and `<main>` markup.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
