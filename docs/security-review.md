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

---

# v2 Marketplace Addendum — Routing, Connect & Payouts

Covers the v2 surfaces added on top of the Phase 9 review above:
multi-vendor routing, Stripe Connect, per-day charging, delivery-gated
payouts, and the v2.1 courier-delivery + AI-menu-onboarding additions. The
v1 controls above still apply unchanged.

## Controls verified in place (v2)

**Stripe Connect / payouts (critical rules 4, 9)**

- Vendors are **Express** connected accounts; bank/KYC is collected and
  held by Stripe — the app stores only the account id and the mirrored
  `charges_enabled` / `payouts_enabled` flags. No payout details touch our DB.
- Payouts are **delivery-gated**: a transfer is created only after an order
  is `delivered`, net of commission. No delivery → no transfer, regardless
  of `payoutCadence` (`per_order` vs `daily_batch` only changes sweep
  frequency).
- Charges and transfers are **separate** (not card auth holds): the user is
  charged at cutoff into the platform balance; the vendor's net is
  transferred post-delivery.
- All transfer/refund/reversal actions carry **idempotency keys** keyed per
  order; the `daily_batch` sweep is guarded by a unique
  `(vendorId, period, daily_batch)` payout index — re-runs and duplicate
  delivery events cannot double-pay.
- `account.updated` and `charge.dispute.created` go through the **same
  signed webhook** as billing (signature verified, event id claimed once via
  the unique `(source, eventId)` index). A dispute reverses the vendor
  transfer and refunds the user.

**Per-day charging (critical rule 3)**

- Card is saved at signup via a SetupIntent (`checkout.session.completed`) —
  no upfront/monthly charge. The user is charged **per day at cutoff**,
  server-side, into the platform balance. No client-supplied amounts.

**Routing engine (critical rules 2, 5, 6, 7)**

- Routing, charging, payouts, and refunds are **server-only**; clients
  request, the server decides.
- One order per `(userId, date)` (unique index) holds across the new
  vendor-assignment + reassignment paths — re-running generation can't
  double-generate.
- Subscriber preferences and monthly lists reference the **OptionTaxonomy**,
  not a single vendor's live menu, keeping auto-orders portable across
  reassignment. Vendor, drink spec, and price are **snapshotted** at
  order/list confirmation.
- AI and manual vendor selection, and the monthly list, take effect **only
  after the user confirms**; the AI recommender is advisory and server-only,
  with a deterministic fallback when `ANTHROPIC_API_KEY` is unset.

**Access control (v2)**

- Vendor portal authority = membership in `Vendor.portalUserSubs`
  (owner added on apply, granted on approval), not the self-describable role
  field; vendor reads/writes are scoped to their `vendorId`.
- The pending → active/rejected application transition is claimed atomically
  (concurrent reviews can't both win); approval grants the `vendor` role but
  never overrides an `admin`.
- Vendor applications validated with Zod; addresses geocoded server-side.

**Migrations (critical rules 8, 10)**

- Phase A (cafés → vendors) and Phase C (taxonomy seed) are **idempotent and
  reversible**, admin-only, and unit-tested. Phase A preserves café `_id`s as
  vendor ids so existing order references stay valid; the operator's own
  café becomes Vendor #1 with no special-casing.

**Courier delivery & AI menu onboarding (v2.1)**

- The courier webhook (`/api/webhooks/courier/:provider`) is the
  money-gating delivery signal and is handled like the Stripe webhook:
  **signature verified** before processing, each state transition claimed
  exactly once via the `(source, eventId)` index, out-of-order tolerant
  (only ever advances the state machine). `delivered` releases the
  delivery-gated payout; `failed` refunds the day — both idempotent.
- For courier vendors this removes the v1 "café staff mark delivered without
  rider confirmation" trust gap — delivery is confirmed by the courier, not
  a human button. Manual (self-deliver) vendors retain the staff-confirmed
  path. Admin force-deliver / re-dispatch go through the _same_ idempotent
  transition, so payout still releases exactly once.
- Courier dispatch carries a per-order idempotency key (no double-booking);
  a dispatch that fails after retries fails + refunds the order.
- AI menu onboarding is **propose-only**: the uploaded screenshot is
  processed in-request and **never persisted**, the module touches menu data
  only (never routing/charging/payout), and nothing is published until the
  vendor reviews and confirms — extracted rows flow through the _same_ menu
  write/validation gate as the manual editor.

## Known gaps / accepted (v2 / v2.1)

1. `account.updated` for Express accounts must reach the webhook — the
   endpoint has to listen to **connected-account** events (see
   `docs/deployment.md` §4). If misconfigured, vendors onboard but
   `payouts_enabled` never flips and payouts silently hold. Verify in the
   post-deploy checklist.
2. Failed-card-at-cutoff policy, courier dispatch-failure policy, and
   routing weightings are business decisions; confirm before hardcoding
   (critical rule 11).
3. Rate limiting and CSP gaps from the v1 review still stand. The browser
   tracking map needs a **referrer-restricted** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
   distinct from the server geocoding key (see `docs/deployment.md` §6).
