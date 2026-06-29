import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type NoticeTone = "amber" | "sage";

const TONES: Record<NoticeTone, string> = {
  amber: "bg-amber text-coffee",
  sage: "bg-sage-soft text-sage-ink",
};

/**
 * Inline callout (e.g. the "Locks in 5h 07m…" cutoff notice).
 * Amber by default; sage for confirmations.
 */
export function Notice({
  tone = "amber",
  icon = "⏱",
  children,
  className,
}: {
  tone?: NoticeTone;
  /** Leading glyph/element; pass null to omit. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[14px] px-4 py-3.5 text-[13px] leading-relaxed",
        TONES[tone],
        className,
      )}
    >
      {icon != null && <span className="text-lg leading-none">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
