import { SectionLabel } from "@/components/ui/card";
import { Stepper } from "@/components/ui/stepper";

const STEPS = ["Profile", "Locations", "Coffee", "Payment"];

export function StepIndicator({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Step {current} of 4</SectionLabel>
      <Stepper steps={STEPS} current={current} />
    </div>
  );
}
