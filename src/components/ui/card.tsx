import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  /** `lg` uses the elevated hero-card shadow from the reference (e.g. the token sheet card). */
  elevation?: "sm" | "lg";
  as?: ElementType;
};

/**
 * White surface card on the warm Paper background.
 * Mirrors the reference: white fill, generous radius, soft warm shadow.
 */
export function Card({
  elevation = "sm",
  as,
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as ?? "div";
  return (
    <Tag
      className={cn(
        "rounded-3xl bg-surface text-ink",
        elevation === "lg" ? "shadow-card-lg" : "shadow-card",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * Mono uppercase section label (e.g. "WEEKDAY PLAN", "RECENT CHARGES").
 */
export function SectionLabel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}
