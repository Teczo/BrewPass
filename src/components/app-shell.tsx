import type { ReactNode } from "react";

import { BottomNav } from "@/components/bottom-nav";
import { cn } from "@/lib/cn";

/**
 * Shared mobile app shell for subscriber `/dashboard/*` screens (Phase N.1).
 * Centered Paper-background column with the fixed bottom tab bar; content gets
 * bottom padding so it never sits behind the nav. Presentational only — no data
 * or routing behavior. The page provides its own `<main>` inside `children`.
 */
export function AppShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">
      <div className={cn("flex flex-1 flex-col pb-28", className)}>
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
