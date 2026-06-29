/**
 * Subscriber dashboard loading skeleton (Phase O.5, `fallbacks.md` §13.2).
 * Shown while the segment streams, so navigation never lands on a blank screen.
 */
export default function DashboardLoading() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 p-6" aria-hidden>
      <div className="h-12 animate-pulse rounded-3xl bg-surface" />
      <div className="h-24 animate-pulse rounded-3xl bg-surface" />
      <div className="h-40 animate-pulse rounded-3xl bg-surface" />
      <div className="h-28 animate-pulse rounded-3xl bg-surface" />
    </main>
  );
}
