"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { buttonClasses } from "@/components/ui/button";

/**
 * Segment-level error boundary for onboarding (Phase O.5, `fallbacks.md` §13).
 * A failure on one step never strands the new user on a blank screen.
 */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
      <h1 className="font-display text-2xl text-espresso">Something went wrong</h1>
      <p className="text-sm text-coffee">
        We couldn&apos;t load this step. Nothing you entered was lost — try again.
      </p>
      <button type="button" onClick={reset} className={buttonClasses("primary")}>
        Try again
      </button>
    </main>
  );
}
