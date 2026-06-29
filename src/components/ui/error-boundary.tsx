"use client";

import * as Sentry from "@sentry/nextjs";
import { Component, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Per-panel render resilience (Phase O.5, `fallbacks.md` §13.1/§13.2). Wrap an
 * individual dashboard/admin panel so that if it throws during render, only
 * that panel collapses to a compact "couldn't load — refresh" tile while every
 * other panel on the page renders normally. The error is reported to Sentry so
 * a silently-degraded panel is still visible to operators (§13 AC #4).
 *
 * Note: a client error boundary catches errors thrown by its **client**
 * children. Errors in server-rendered panels propagate to the segment-level
 * `error.tsx` instead — both layers exist so no failure ever blanks the app.
 */

/** The compact fallback tile shown in place of a failed panel. */
export function PanelError({
  label,
  onRetry,
  className,
}: {
  label?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-hairline bg-surface p-4 text-sm text-muted",
        className,
      )}
    >
      We couldn&apos;t load {label ?? "this section"}.{" "}
      <button
        type="button"
        onClick={onRetry}
        className="font-semibold text-coffee underline underline-offset-2 hover:text-espresso"
      >
        Refresh to try again
      </button>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What failed, for the fallback copy (e.g. "your upcoming coffee"). */
  label?: string;
  /** Custom fallback; defaults to <PanelError label={label} …>. */
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    Sentry.captureException(error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <PanelError
            label={this.props.label}
            // Clearing the flag re-renders the children — a client panel that
            // fetches on mount retries from scratch.
            onRetry={() => this.setState({ hasError: false })}
          />
        )
      );
    }
    return this.props.children;
  }
}
