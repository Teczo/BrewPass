import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Order/membership status pills. Tones match the reference token sheet:
 *  - scheduled/preparing → amber
 *  - delivered/active    → sage
 *  - skipped             → outlined terracotta on white
 *  - failed              → solid terracotta
 */
export type StatusTone =
  | "scheduled"
  | "preparing"
  | "delivered"
  | "skipped"
  | "failed"
  | "active";

const TONES: Record<StatusTone, string> = {
  scheduled: "bg-amber text-amber-ink",
  preparing: "bg-amber text-amber-ink",
  delivered: "bg-sage-soft text-sage-ink border border-sage-line",
  active: "bg-sage-soft text-sage-ink",
  skipped: "bg-surface text-terracotta border border-terracotta-soft",
  failed: "bg-terracotta text-white",
};

const DEFAULT_LABELS: Record<StatusTone, string> = {
  scheduled: "Scheduled",
  preparing: "Preparing",
  delivered: "Delivered",
  skipped: "Skipped",
  failed: "Failed",
  active: "Active",
};

export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-[5px] text-xs font-semibold",
        TONES[tone],
        className,
      )}
    >
      {children ?? DEFAULT_LABELS[tone]}
    </span>
  );
}
