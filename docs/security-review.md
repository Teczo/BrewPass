# Security & Load Review — Order + Payment Paths (Phase 9)

Reviewed 2026-06-10 against the running code. Scope: order generation,
modification, cutoff, café/delivery transitions, Stripe billing, webhooks,
admin overrides.

## Controls verified in place

**Payments / billing**

- Stripe webhook signatures verified (`constructEventAsync` with
  `STRIPE_WEBHOOK_SECRET`); unsigned/invalid → 400.
- Webhook idempotency: event ids claimed via unique `(source, eventId)`
  index — duplicates acknowledged without reprocessing; failed processing
  releases the claim so Stripe retries.
- Out-of-order webhook safety: handlers re-fetch the subscription's
  current state from Stripe rather than trusting event payloads.
- All money in integer sen; prices live server-side in `src/lib/plans.ts`;
  the client only ever sends a plan id, never an amount.
- Student plan gated server-side on `studentVerifiedAt` (admin-set).
- Corporate seat changes verified against member count server-side;
  member adds re-check the seat limit atomically (`$expr` on `$size`).

**Order engine (server-authoritative, critical rules 1–5)**

- Generation idempotency: unique `(userId, date)` index — re-runs and
  concurrent cron invocations cannot double-generate.
- Cutoff: each order claimed atomically (`scheduled → confirmed`), quota
  decremented with a guarded conditional update (live plan + remaining
  quota). Double-decrement impossible; crash window degrades to an
  un-decremented coffee (favours the user, never double-charges).
- Modification window: every user update filters on
  `status + cutoffAt > now` inside the MongoDB query — a request racing
  the cutoff job cannot modify a locked order.
- Snapshots: orders copy drink/location/café at generation; later
  preference edits cannot leak in (unit-tested).
- All timestamps UTC; KL conversion confined to `src/lib/time.ts`
  (unit-tested, including the cutoff = previous-UTC-day edge).
- Cron endpoints require `Authorization: Bearer CRON_SECRET`, compared
  constant-time (`crypto.timingSafeEqual`); unconfigured → 503.

**Access control**

- Every collection access is scoped: users can only read/update their own
  orders/locations/preferences (`userId` in the query filter, never
  client-supplied ids alone).
- Café portal authority = membership in `Cafe.portalUserSubs`
  (admin-managed), not the self-describable role field; café updates are
  scoped to `cafeId`.
- Admin = `role: "admin"`; admins cannot change their own role; quota
  refunds idempotent via `quotaRefundedAt` claim.
- `admin` is excluded from self-serve role selection.

**Input handling**

- All route inputs validated with Zod; ObjectIds validated before use
  (no operator-injection surface — inputs are typed strings/numbers).
- Drink spec lengths capped (drink 80, milk 40, notes 300); addresses,
  labels, reasons all length-limited.
- Email HTML escapes user-controlled strings (`escapeHtml`) — fixed in
  this phase; push/SMS are plain text.

**Transport / headers**

- HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy` set globally (this phase).
- Secrets only in env vars; `.env*` git-ignored; Maps key server-only
  (geocoding proxied through authenticated API routes).

## Load notes

- Cron jobs process orders serially with `maxDuration = 300`s. At ~1–2
  DB round-trips per order this comfortably covers thousands of daily
  orders; beyond that, batch the per-order loops.
- Weather lookups are memoised per ~11 km cell per run.
- Mongo client is a shared singleton (no serverless connection storms);
  hot paths are covered by the indexes in `ensureIndexes()`.

## Known gaps / accepted for MVP

1. **No rate limiting** on authenticated endpoints (geocoding proxies are
   the costliest). Acceptable behind Auth0 sessions at MVP scale; add
   Vercel WAF rules or Upstash rate limiting before public launch.
2. **No Content-Security-Policy** yet — needs a nonce pipeline with
   Next.js inline scripts; schedule with the mobile webview testing.
3. **Café staff trust**: café users mark delivered/failed without rider
   confirmation (riders are manual in MVP). Revisit in a rider app phase.
4. **`ensureIndexes()` must be run** against new databases for the
   idempotency guarantees to hold (unique indexes). Run it as part of
   environment provisioning.
5. Stripe money refunds are manual (dashboard) by design; in-app
   "refund" returns quota credit only.
