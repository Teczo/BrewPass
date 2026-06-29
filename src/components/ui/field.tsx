import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Label({
  className,
  children,
  ...rest
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-xs font-medium text-coffee", className)}
      {...rest}
    >
      {children}
    </label>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-xl border border-border bg-field px-3.5 py-3 text-[15px] font-medium text-ink",
        "placeholder:text-muted focus:border-coffee focus:outline-none",
        className,
      )}
      {...rest}
    />
  );
});

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  /** Helper text shown under the input. */
  hint?: ReactNode;
};

/**
 * Labelled text input with optional hint, matching the onboarding field style.
 */
export function Field({ label, hint, className, id, ...rest }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className={className} {...rest} />
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
