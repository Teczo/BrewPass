const STEPS = ["Profile", "Locations", "Coffee", "Payment"] as const;

export function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex gap-2 text-sm">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const active = step === current;
        const done = step < current;
        return (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              active
                ? "bg-amber-800 text-white"
                : done
                  ? "bg-amber-100 text-amber-900"
                  : "bg-neutral-100 text-neutral-500"
            }`}
          >
            {step}. {label}
          </li>
        );
      })}
    </ol>
  );
}
