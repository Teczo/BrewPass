"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Segment-level error boundary for the vendor portal (Phase O.5,
 * `fallbacks.md` §13).
 */
export default function VendorError({
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
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-bold">Couldn&apos;t load your portal</h1>
      <p className="max-w-md text-sm text-neutral-500">
        Something failed while loading. Your orders and earnings are safe — retry to reload.
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
