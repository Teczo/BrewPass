# BrewPass — Fallbacks & Graceful Degradation Spec

Companion to `CLAUDE.md`. Defines every place the app must **degrade
gracefully** rather than break: what should happen when an expected thing
doesn't happen, a dependency is missing, or a path fails. Each entry is a
testable acceptance criterion.

**Terminology:** in this file, *fallback* = the substitute behavior;
*degraded mode* = a feature partially works without its dependency; *empty
state* = UI shown when there's no data yet; *circuit breaker* = stop
retrying a broken dependency and use a default.

**Core principle:** the app **never breaks**. The user can always log in,
land on a sensible screen, and either get value or see a clear explanation
of why not. Failures are isolated — one failed dependency never cascades.

Phase references map to `CLAUDE.md`. Rule numbers reference Critical Rules
in `CLAUDE.md`.

---

## 1. Cold-start / empty marketplace

The platform must be usable from day one — before vendors, before orders,
before taxonomy is populated in a fresh region.

### 1.1 First user signs up before any vendor is approved
- Allow full signup + 4-step onboarding to complete normally.
- Onboarding step 3 (Coffee preferences) works against the taxonomy — no
  vendor-menu dependency.
- Dashboard renders with **sample coffee illustrations** (not real orders)
  in the upcoming-order slot.
- Persistent banner: *"We're launching in your area soon — we'll email
  you the day your first vendor goes live."*
- **No order generation runs** for this user (skip silently in the 8 PM
  cron when no eligible vendor exists in their service area).
- Capture the user's address into a **launch-waitlist** record (see §1.2)
  so they're emailed automatically when coverage arrives.

### 1.2 User's address has no vendor in service radius
- Same as 1.1, but the banner copy is location-specific: *"No vendors
  deliver to {address} yet — we'll email you when one does."*
- Record `LaunchWaitlist { userId, address, lat, lng, market, createdAt,
  notifiedAt? }`.
- When a new vendor is approved with `status = active`, run a job that
  matches their service area against the waitlist and emails matched users
  once (set `notifiedAt`). Idempotent — never email the same user twice
  for the same vendor.

### 1.3 Vendor approved but hasn't published a menu yet
- Treat the vendor as offering the **full canonical taxonomy** at
  platform default prices. (Already in `USER_GUIDE` §13, preserves v1
  behavior.)
- Routing eligibility check: "can make the drink" passes for any
  taxonomy-valid drink.

### 1.4 No taxonomy seeded yet (fresh DB)
- Admin dashboard surfaces the **"Seed taxonomy"** button prominently.
- Subscriber onboarding step 3 shows a "platform setup in progress —
  check back shortly" state instead of an empty drink dropdown.
- Order generation cron exits early with a log line; never throws.

### 1.5 Admin dashboard with zero data
- All stat tiles render with `0` values normally.
- "Failures today" panel is **hidden** when there are no failures (not
  rendered as an empty red box).
- "Routing health" shows "No orders yet today" rather than divide-by-zero.

---

## 2. Routing engine fallbacks (Phase D)

The routing engine must always reach a decision — even if that decision
is "skip this user today."

### 2.1 Preferred vendor unavailable
- Triggers: offline, paused, suspended, full (capacity), closed
  (operating hours), out-of-area, can't make the drink, sold-out date.
- Auto-route to next-best eligible vendor by proximity → quality → ID.
- Set `assignmentMethod = reassigned` on the order.
- No user notification at routing time (would defeat "do nothing daily").
  The user sees the new vendor on the night-before reminder.

### 2.2 No eligible vendor for tomorrow
- Order remains in `scheduled` with `vendorId = null`.
- The next nightly run retries.
- If the order is still unrouted **at its own day's cutoff**, mark it
  `failed` with reason `no_vendor_available`, notify the user, no charge.
- If a user has 3+ consecutive `no_vendor_available` failures, escalate
  to admin (failures panel) — likely a coverage gap.

### 2.3 Vendor declines or accept-window times out
- Reassign to next eligible vendor via the same routing path.
- Count against the vendor's `acceptanceRate` (Phase G).

### 2.4 Vendor goes offline after assignment, before charge
- Re-route at cutoff if still pre-charge. Snapshot the new vendor + price.

### 2.5 Vendor goes offline after charge, before delivery
- Order is already `confirmed` and charged.
- Attempt reassignment to another eligible vendor at the same snapshot
  price (platform absorbs any rate difference for that day).
- If no reassignment possible → mark `failed`, **auto-refund customer in
  full** (rule #1), no vendor payout.

### 2.6 Vendor quality score has no history
- Default to neutral **0.5** so new vendors aren't starved by tiebreaks.

### 2.7 Multiple vendors tie on proximity
- Higher composite quality score wins.
- Still tied → deterministic ID sort (lowest `externalId` wins).

### 2.8 Vendor Pack vendor goes offline (sanctioned exception, rule #20)
- Do **not** reroute the pack to another vendor.
- Skip + refund that day's pack on the company card (idempotent).
- Notify the team admin: *"Your pack vendor {name} is closed today —
  you've been refunded RM{amount}. Tomorrow's pack is unaffected."*

---

## 3. AI / model fallbacks

The AI is advisory. No core flow may block on it.

### 3.1 Claude unavailable for vendor recommendation (Phase D)
- Deterministic priority-weighted scorer produces a recommendation of the
  same shape (vendor + one-line rationale).
- User sees no indication the AI was unavailable — the experience is
  identical.

### 3.2 Claude unavailable for monthly planner (Phase D.5)
- Silently produce the "usual every day" plan with routed vendors.
- Skip the rationale field per day (or use a generic "your usual at
  {vendor}").
- User can still review/edit/confirm normally.

### 3.3 Claude menu extraction fails (Phase C)
- Vendor sees: *"We couldn't read that menu — please map items manually."*
- Manual mapping path is always available.
- Uploaded images are discarded (never stored anyway — rule from
  `USER_GUIDE` §13).

### 3.4 Smart suggestion has insufficient pattern data
- Pattern needs ≥3 matching past orders **and** ≥60% dominance.
- Below threshold → no suggestion banner shown. Silent.

### 3.5 Weather API down (smart suggestions)
- Skip the rainy-day suggestion logic. Other suggestions still run.
- Never throw; never block the dashboard render.

---

## 4. Payment fallbacks (Phase E, J.7)

Charging is invisible to the user — failures must stay invisible too,
except where the user can act.

### 4.1 Personal card charge fails at cutoff
- Retry 3× over ~10 min (≈ 0, 3, 10 min).
- After final failure: mark order `failed` with reason
  `charge_failed_after_retries`, no vendor handoff, notify user once
  (push + email): *"We couldn't charge your card today — fix it in
  Billing to get tomorrow's coffee."*
- **Subscription stays active.** One failed day never pauses the plan.
- Idempotent — retries with the same Stripe idempotency key never
  double-charge.

### 4.2 Company card charge fails at cutoff (Phase J.7)
- Same retry policy (3× over ~10 min).
- Skip **only** affected member(s)' office coffee for that day.
- Notify the **team admin/owner immediately** (multi-person blast radius).
- Notify affected member(s) too.
- **Personal coffees for the same staff are completely unaffected** —
  different card, different order, never cross-blocked (rule #17).
- Company is **not** frozen over a single failed day.

### 4.3 Add-on charge fails but coffee charge succeeds
- Drop the add-ons silently from the order.
- Deliver the coffee normally.
- Notify the user post-cutoff: *"Couldn't add your croissant today —
  card on file might need updating."*

### 4.4 Charged then delivery fails
- Automatic full refund (idempotent, rule #1).
- Apology + reason sent to user (and to team admin for office coffee).
- Vendor was never paid (delivery-gated, rule #4) — nothing to claw back.

### 4.5 Stripe webhook arrives twice or out of order
- Verified by signing secret.
- Deduplicated by event ID in `webhookEventsCollection`.
- Idempotent processing — re-runs are no-ops.

### 4.6 User has no card on file
- Onboarding payment step has an explicit **"I'll add it later"** escape.
- Dashboard shows a persistent, dismissible-once-per-session **"Add your
  card to start getting coffee"** nudge.
- The app is fully navigable; the user is **never blocked** from the
  dashboard, locations, preferences, or vendor selection.
- No order generation runs for users without a card on file.

### 4.7 Vendor not Stripe Connect onboarded yet
**Decision (locked):** vendor receives orders before Connect is complete;
funds are held on the platform balance until they finish onboarding.
- Vendor portal shows a persistent "Complete payout setup to receive your
  earnings" banner with held-funds total visible.
- Orders flow normally; payouts queue but don't transfer.
- Once Connect onboarding completes (Stripe webhook), queued payouts
  sweep on the next scheduled cadence (per-order or daily-batch).
- No expiry — funds wait indefinitely.

---

## 5. Courier / delivery fallbacks (Phase M, L)

Courier dispatch can fail at any step. The state machine must never get
stuck.

### 5.1 AU primary courier (Uber Direct) dispatch fails
- Auto-fallback to next adapter in `AU_FALLBACK_CHAIN`
  (`["uber_direct", "doordash_drive"]`).
- Each adapter is skipped if `isConfigured()` returns false.
- Fallback logic lives in `src/lib/courier/index.ts`, not inside the
  adapters (rule #23).

### 5.2 All configured couriers in market fail at dispatch
- Mark delivery `failed`, mark order `failed`.
- Auto-refund the customer (rule #1).
- Notify admin (failures panel).
- Admin can manually re-dispatch from `/admin` (re-runs the fallback
  chain).

### 5.3 Adapter not configured
- `isConfigured() === false` → adapter is **silently skipped** in the
  fallback chain.
- Never raises an error; never logs as a failure.

### 5.4 Vendor's `courierProvider` is unset
- Resolve via `MARKET_PRIMARY_COURIERS[vendor.market]`.
  - MY → Lalamove.
  - AU → Uber Direct (with DoorDash Drive Classic fallback).

### 5.5 Live driver location goes stale (>60s no update)
- Show a fallback "Open in {provider} tracker" link to the courier's own
  page (`USER_GUIDE` §10).
- Continue polling in the background; if location resumes, fallback link
  disappears.

### 5.6 Webhook never arrives (stuck delivery)
- Background sweeper checks deliveries stuck in `assigned` or
  `picked_up` for >2× expected duration.
- Surface in admin "Failures today" with a "Resolve delivery" action:
  re-dispatch, manually mark delivered, or manually mark failed.

### 5.7 DoorDash `dasher_dropped_off_with_issue`
- Map to `delivered`.
- Store raw status in `Delivery.courierStatusRaw` for admin review.
- Payout proceeds.

### 5.8 Courier supports only single-pickup (Phase L.3)
- Phase L.3 (consolidated delivery) deferred for that market.
- All orders in that market deliver single-vendor-per-delivery.
- `DeliveryRun` is never created for vendors in that market.

---

## 6. Vendor portal fallbacks

### 6.1 Vendor status is non-operational
- `pending` → full-screen Notice: *"Application under review."*
- `rejected` → full-screen Notice with admin's reason + "Re-apply" CTA.
- `suspended` → full-screen Notice: *"Account suspended — contact
  support."*
- `paused` / `offline` → portal accessible but board shows "You're not
  accepting orders right now — go active to resume."

### 6.2 Vendor not Stripe Connect onboarded
- See §4.7. Orders accepted, funds held, banner shown.

### 6.3 Vendor quality auto-suspended (Phase G)
- Red banner on board: *"Your account is paused — quality score below
  threshold. Contact support."*
- No new orders routed until admin clears.
- Vendor can still see today's already-assigned orders (must finish them)
  and earnings.

### 6.4 Vendor menu has 0 items
- Routing treats them as offering full canonical taxonomy (§1.3).
- Portal shows "Add your menu" prompt but doesn't block.

### 6.5 Vendor marks date sold out
- Routing skips them for that date.
- Already-assigned orders for that date are reassigned at next routing
  pass.

---

## 7. Notification fallbacks

All notifications are **best-effort** — they never block an order or any
core action.

### 7.1 Push (FCM) delivery fails
- Email and SMS paths still attempt independently.
- Logged for monitoring; user-facing state unaffected.

### 7.2 Email (Resend) delivery fails
- Push and SMS still attempt.
- Logged. User can resend from app if applicable (e.g. statement).

### 7.3 SMS (Twilio) delivery fails
- Push and email still attempt.
- Delivery-confirmation SMS is the only critical SMS — if it fails, the
  in-app delivered state is still authoritative.

### 7.4 All channels fail
- Order proceeds anyway.
- Logged in Sentry for monitoring.

---

## 8. Corporate / office fallbacks (Phase J, K)

### 8.1 Member has both personal and office coffee on the same day
- **Both proceed by default** (different cards, no billing conflict).
- Show advisory dismissible `overlap-notice` on the dashboard with
  one-tap "cancel one" + "remember my choice."
- **Never a mandatory daily prompt** (would break the "do nothing daily"
  promise, rule #17).

### 8.2 Member sets "remember my choice" on overlap
**Decision (locked):** preference persists **forever** until the member
changes it.
- Store as `MemberOverlapPreference { membershipId, rule:
  "skip_personal_on_office_day" | "skip_office_on_personal_day",
  setAt }`.
- No expiry; no re-prompt.
- Member can clear the rule from Profile → Office coffee settings.
- The rule is applied at generation time (8 PM cron), not at cutoff —
  the skipped side never generates an order.

### 8.3 Owner hasn't set company card yet
- Office order generation **skipped** for that company (8 PM cron exits
  early with a log line).
- Owner dashboard shows prominent "Add company card to start office
  coffee" prompt.
- Members see: *"Your office coffee starts once {Owner Name} adds the
  company card."*

### 8.4 Owner hasn't set office defaults yet
- Same as 8.3 — generation skipped.
- Owner sees a setup checklist: card ✓, office defaults ✗, join code ✓.

### 8.5 Join code revoked or expired
- Redemption attempt fails with: *"This code is no longer active — ask
  your team admin for a new one."*
- Existing memberships from the same code are **unaffected** (revoking
  the code never removes anyone).

### 8.6 Join code at redemption cap
- Redemption fails: *"This code has reached its join limit."*
- Owner sees a "Cap reached" badge on the code; can rotate to a new
  uncapped or higher-capped code.

### 8.7 Pack slots unassigned at cutoff
- Unassigned slots are **paid-for-and-skipped** (still cheaper than
  per-coffee).
- Each unassigned slot creates **no** Order — only the pack is charged.

### 8.8 Bundle mode but no bundle drink set
- Generation skipped for that company with a log line.
- Owner dashboard shows: *"You're in bundle mode — set the bundle drink
  to start tomorrow's office coffee."*

---

## 9. Outbound webhooks (Phase I.5)

### 9.1 Webhook subscriber endpoint down
- Retry with exponential backoff (e.g. 1m, 5m, 15m, 1h, 6h).
- **Never blocks** the core order/charge/payout action that emitted the
  event (rule from Phase I.5 — best-effort, like notifications).
- After max retries, mark event `delivery_failed` for admin review.

### 9.2 Webhook cron not running (current Hobby plan)
- Events queued in DB.
- Documented in `CLAUDE.md` Go-Live TODO — restore the `*/5 * * * *`
  cron when upgrading to Pro.
- Manual trigger available for testing.

---

## 10. Data integrity fallbacks

### 10.1 Cron job re-runs (Vercel retries on transient failure)
- Idempotency key per `(orderId, action)` — re-runs are no-ops (rule #1).

### 10.2 Out-of-order Stripe webhook events
- Verified by signing secret.
- Deduplicated by Stripe event ID.
- State transitions are forward-only; out-of-order events are dropped
  with a log line.

### 10.3 Out-of-order courier webhook events
- Delivery state machine only advances forward.
- Out-of-order or duplicate events ignored idempotently
  (`USER_GUIDE` §10).

### 10.4 Race condition: user edits order at the cutoff boundary
- Server checks cutoff timestamp at the moment of write.
- Edits with timestamps past cutoff → rejected with a 409, client
  refreshes into read-only state.

### 10.5 Database connection lost mid-cron
- Cron job throws; Vercel retries.
- Idempotency keys ensure partial work isn't duplicated on retry.

---

## 11. Auth / role fallbacks

### 11.1 User logs in but Auth0 returns no role
- Default to `individual` role.
- Send to onboarding step 1.

### 11.2 User accesses a portal they don't have the role for
- `/vendor` for non-vendor → friendly redirect to `/dashboard` with a
  toast: *"That's the vendor portal — you're a subscriber."*
- `/admin` for non-admin → "No operator access" notice (not a 403 page).
- Subscriber-app routes for a vendor account → redirect to `/vendor`.

### 11.3 Auth0 itself is down
- Log in pages show a clear "Sign-in is temporarily unavailable — try
  again in a moment" message.
- Already-authenticated users continue to work normally (session
  tokens cached).

---

## 12. Geolocation / Maps fallbacks

### 12.1 Geocoding fails for vendor address (Phase B)
- Application proceeds with `lat/lng = null`.
- Admin reviews flag: "Address could not be geocoded — set service area
  manually."
- Vendor not eligible for routing until geocoded (no service-area check
  possible).

### 12.2 Geocoding fails for subscriber address (onboarding)
- Save the address text anyway; flag as `unverified`.
- Show: *"We couldn't verify this address — please check the pin on the
  map."*
- User can drag a map pin manually (Maps fallback) or proceed and let
  admin sort out at first delivery.

### 12.3 "Use my current location" denied or unavailable
- Falls back to manual address entry. Never blocks onboarding.

### 12.4 Maps JS fails to load (dashboard live tracker)
- Show non-map fallback: status badge + ETA text + courier provider's
  own tracking link (§5.5).

---

## 13. General render fallbacks

### 13.1 Any panel on the dashboard errors during render
- Wrap each panel (`upcoming-order`, `delivery-tracker`, `health-card`,
  etc.) in an error boundary.
- Failed panel shows a compact "We couldn't load this — refresh to try
  again" tile.
- Other panels render normally.

### 13.2 Data-heavy admin tables fail to load
- Show table skeleton with a retry button.
- Other admin panels (stat tiles, failures, routing health) render
  independently.

### 13.3 Image fails to load (vendor logo, menu item, courier driver photo)
- Show a neutral placeholder (initials for logos, coffee glyph for menu
  items, generic avatar for drivers).
- Never block the surrounding UI.

---

## Acceptance criteria summary

Each fallback above is a **testable contract**. For every entry:

1. The **happy path** still works unchanged.
2. The **fallback path** produces the documented behavior (no crash, no
   stuck state, no data corruption).
3. Where the user is informed, the **copy is friendly and actionable**.
4. Where the user is **not** informed, the system logs sufficient
   detail for admin/Sentry visibility.
5. Every fallback is **idempotent** — re-running it is safe.

When implementing, write the failure-case test alongside the happy-path
test. A phase isn't complete until both pass.
