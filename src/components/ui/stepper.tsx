import { cn } from "@/lib/cn";

/**
 * Numbered step indicator for the onboarding flow.
 * Current/completed steps are filled espresso; upcoming are outlined.
 */
export function Stepper({
  steps,
  current,
  className,
}: {
  /** Ordered step labels (e.g. ["Profile", "Locations", "Coffee", "Payment"]). */
  steps: string[];
  /** 1-based index of the active step. */
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-start gap-3", className)}>
      {steps.map((label, index) => {
        const step = index + 1;
        const reached = step <= current;
        return (
          <li key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <span
              className={cn(
                "grid h-[26px] w-[26px] place-items-center rounded-full font-mono text-xs font-semibold",
                reached
                  ? "bg-espresso text-white"
                  : "border border-border bg-surface text-muted",
              )}
            >
              {step}
            </span>
            <span
              className={cn(
                "text-[11px] font-medium",
                step === current ? "text-espresso" : "text-muted",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
