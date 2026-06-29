import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

/**
 * Button variants from the reference:
 *  - primary   → solid espresso (e.g. "Edit Tweak", "Continue")
 *  - secondary → white with hairline border ("Skip Day")
 *  - outline   → transparent pill, ink border ("Manage")
 *  - danger    → white with terracotta border + text ("Cancel")
 *  - link      → bare text CTA ("Choose your vendor →")
 */
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "danger"
  | "link";

const BASE =
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "rounded-[14px] bg-espresso px-[22px] py-[13px] text-sm text-white hover:bg-ink",
  secondary:
    "rounded-[14px] border border-border bg-surface px-[22px] py-[13px] text-sm text-espresso hover:bg-field",
  outline:
    "rounded-full border-[1.5px] border-ink bg-transparent px-[18px] py-[13px] text-sm text-espresso hover:bg-surface",
  danger:
    "rounded-[14px] border border-terracotta-soft bg-surface px-[22px] py-[13px] text-sm text-terracotta hover:bg-field",
  link: "bg-transparent px-1 py-2 text-sm text-coffee hover:text-espresso",
};

/**
 * Class string for a button variant. Use on a `<Link>` or `<a>` that should
 * look like a button without rendering a nested `<button>`.
 */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  fullWidth,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, cn(fullWidth && "w-full", className))}
      {...rest}
    />
  );
}
