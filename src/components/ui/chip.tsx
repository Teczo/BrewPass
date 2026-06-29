import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  selected?: boolean;
};

/**
 * Selectable pill chip (drink/size/milk/strength choices, weekday picker).
 * Selected → solid espresso; unselected → white with hairline border.
 */
export function Chip({
  selected = false,
  className,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        "rounded-full px-4 py-[9px] text-[13px] font-semibold transition-colors",
        selected
          ? "bg-espresso text-white"
          : "border border-border bg-surface text-coffee hover:bg-field",
        className,
      )}
      {...rest}
    />
  );
}
