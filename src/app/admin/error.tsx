"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Segment-level error boundary for the operator console (Phase O.5,
 * `fallbacks.md` §13). One failed query/table never blanks the whole console —
 * the operator gets a retry.
 */
export default function AdminError({
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">Couldn&apos;t load operations</h1>
      <p className="text-sm text-neutral-500">
        Something failed while loading the console. The data is fine — retry to reload.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white hover:bg-neutral-700"
      >
        Retry
      </button>
    </main>
  );
}
