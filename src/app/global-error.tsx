"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
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
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">Something went wrong</h1>
        <button
          className="rounded-md bg-amber-800 px-4 py-2 text-white hover:bg-amber-700"
          onClick={() => reset()}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
