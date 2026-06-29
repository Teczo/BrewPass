/**
 * Operator console loading skeleton (Phase O.5, `fallbacks.md` §13.2) — stat
 * tiles + a table placeholder while the console streams.
 */
export default function AdminLoading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 p-6" aria-hidden>
      <div className="h-10 w-48 animate-pulse rounded bg-neutral-100" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-md bg-neutral-100" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-md bg-neutral-100" />
    </main>
  );
}
