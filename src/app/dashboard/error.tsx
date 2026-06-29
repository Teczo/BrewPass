"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { buttonClasses } from "@/components/ui/button";

/**
 * Segment-level error boundary for the subscriber dashboard (Phase O.5,
 * `fallbacks.md` §13). Catches a render/data error anywhere under `/dashboard/*`
 * and shows a friendly retry instead of a blank screen; the rest of the app
 * (auth, other segments) is unaffected.
 */
export default function DashboardError({
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
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="text-4xl" aria-hidden>
        ☕
      </span>
      <h1 className="font-display text-2xl text-espresso">Something went wrong</h1>
      <p className="text-sm text-coffee">
        We couldn&apos;t load this just now. Your coffee plan is safe — try again in a moment.
      </p>
      <button type="button" onClick={reset} className={buttonClasses("primary")}>
        Try again
      </button>
    </main>
  );
}
