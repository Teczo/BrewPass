# CLAUDE.md — BrewPass AI (v2: Multi-Vendor Marketplace)

This file guides Claude Code for the **v2 marketplace** build on the `v2-marketplace` branch. Read it fully before generating code. Follow the phases in order. Do not skip ahead unless I explicitly say so.

The single-vendor MVP is complete and preserved at tag `v1.0-single-vendor` and on `main`. v2 is **additive + refactor**, not a rewrite. Do not duplicate logic — extend the existing code.

> **Phase I (added):** A backend-boundary improvement that extracts domain logic into pure service functions, exposes a versioned API over them, and emits outbound webhooks. It is **purely additive and behavior-preserving** — no frontend feature changes, no downgrades. It makes the platform more testable and maintainable today; downstream integration/portability is a side benefit, not a reason to compromise current behavior. See Phase I and the conventions below.

> **Charging model (updated): charge-then-deliver.** The card is saved at signup and **not** charged upfront. At each day's cutoff the card is charged for that day's coffee, and the order is sent to the vendor to make **only if the charge succeeds** — vendor handoff is gated on a successful charge. This avoids the "coffee delivered but card can't be charged" problem. The tradeoff (charged, then delivery fails) is handled by an **automatic refund** path, which is cleaner than chasing unpaid money. **Vendor payouts stay delivery-gated** — the customer's money is held in the platform balance between charge and delivery, and the vendor is paid only after the coffee is confirmed delivered. This applies to both personal and corporate (office) coffee. See Phase E and the critical rules.

---

## What's Changing (v1 → v2)

v1: I make all the coffee. Everything implicitly belongs to me.

v2: The app is a **marketplace** between existing coffee businesses (vendors) and subscribers who want a customized coffee every day. I become the platform operator. My own coffee operation becomes **Vendor #1** — no special-casing; I am just the first vendor.

The two highest-risk, highest-complexity additions are:
1. **Order routing engine** — deciding which vendor fulfills each subscriber's daily order.
2. **Stripe Connect + payouts** — split payments between platform and vendors.

Everything else is comparatively mechanical. Treat those two with extra care and tests.

---

## Two Locked Product Decisions

1. **Menu model: standardized platform taxonomy.** The platform defines the canonical option set (drinks, sizes, milks, add-ons, strength). Vendors map their offerings onto this taxonomy and set their own prices/availability. Subscriber preferences reference the **taxonomy**, never a single vendor's menu — this is what makes auto-orders portable when a subscriber is routed to a different vendor.

2. **Vendor selection: hybrid.** For each subscriber:
   - They can **pick a preferred vendor** manually, OR
   - The **AI assistant** recommends a vendor based on a short questionnaire (e.g. priorities: proximity, price, speed, rating, specific drink quality).
   - The user reviews the selection, **can edit it**, then confirms. Only after confirmation does it take effect.
   - A confirmed preferred vendor is used by routing when available; platform auto-routing is the fallback when that vendor is full/offline/out of area/can't make the drink.

---

## Tech Stack (unchanged from v1 unless noted)

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind.
- **Mobile:** Capacitor (same web build).
- **Hosting:** Vercel (serverless + Vercel Cron).
- **DB:** MongoDB Atlas.
- **Auth:** Auth0 (now with vendor + admin roles).
- **Payments:** Stripe — **add Stripe Connect** for vendor payouts.
- **Push:** Firebase Cloud Messaging.
- **Maps/geocoding:** Google Maps Platform (now also used for vendor service-area + routing distance).
- **SMS:** Twilio.
- **Email:** Resend.
- **Storage:** Vercel Blob (vendor logos, menu images).
- **Monitoring:** Sentry.

### Conventions (carried from v1)
- TypeScript strict. Zod-validate all external input.
- Money in integer minor units (sen), `MYR`.
- Timestamps UTC in DB; convert at edges. Default tz `Asia/Kuala_Lumpur`.
- Server-authoritative: routing, cutoff, payment capture, and payouts are server-only.
- Idempotency keys on all cron-triggered and payment/payout actions. Never double-charge, double-generate, or double-pay.

### Conventions (added for Phase I — additive, do not retrofit disruptively)
- **Domain logic lives in pure service functions**, separate from the HTTP/UI layer. Next.js route handlers and cron jobs should be thin callers of services (e.g. `assignVendor`, `generateMonthlyList`, `chargeOrderAtCutoff`, `sweepPayouts`), holding no business logic themselves. New work follows this shape; existing logic is migrated into it incrementally without behavior change.
- **Stable external IDs.** Every persistent entity gets a stable external UUID (`externalId`) that I control, separate from Mongo `_id`. Generate on create. Never expose raw `_id` across the API boundary; use `externalId`. This is a schema reservation made early because it is cheap now and expensive to retrofit.
- **Reserve `tenantId` on every entity.** Add a `tenantId` (a.k.a. `platformId`) field across the schema, defaulted to a single constant value for now. **Do NOT build multi-tenant logic, isolation, or per-tenant routing yet** — this is a reserved field only, same spirit as the deferred `walletBalance`. Reserving it now avoids a painful migration later; activating it is a future, separately-scoped decision.
- **API is versioned and additive.** The public API lives under `/v1`. It is a thin layer over service functions and must never change or degrade existing frontend behavior. The existing app keeps calling services directly (or via `/v1`) and continues to work unchanged.
- **Outbound webhooks are additive.** Emitting lifecycle events (`order.delivered`, `vendor.assigned`, `payout.released`, etc.) must not alter the order/charge/payout flow. Webhook emission is best-effort and never blocks a core action, exactly like notifications.

---

## Data Model Changes

**New entities**
- **Vendor** — businessName, ownerUserId, status (`pending` | `active` | `paused` | `suspended` | `offline`), address, geocoded lat/lng, serviceAreaRadius (or polygon), operatingHours, capacity (daily cap + optional per-slot caps), stripeConnectAccountId, commissionRateOverride (nullable → falls back to platform default), **payoutCadence (`per_order` | `daily_batch`, default `daily_batch`)**, ratingScore, acceptanceRate, onTimeRate.
- **OptionTaxonomy** (platform-level, seeded) — canonical drinks, sizes, milks, add-ons, strength levels. The single source of truth subscriber preferences point to.
- **VendorMenuItem** — vendorId, taxonomyRef, price, availability toggle, optional image. Maps a vendor's offering onto the taxonomy.
- **VendorPayout** — vendorId, period, gross, commission, net, stripeTransferId, status, statement data. Always released **post-delivery**; `payoutCadence` only controls how often held funds are swept to the vendor.
- **CommissionConfig** — platform default rate; per-vendor overrides live on Vendor.
- **Rating** — orderId, userId, vendorId, score, comment → aggregates into Vendor.ratingScore.
- **MonthlyList** — userId, period (month), status (`proposed` | `confirmed`), generationMethod (`ai` | `manual`), array of planned daily entries (date → taxonomy drink spec + assigned vendorId). The confirmed list is the source from which scheduled daily Orders are created.

**Corporate team entities (Phase J — added)**
- **CorporateMembership** — corporateAccountId, userId, status (`invited` | `active` | `removed`), `officePreferenceId` (the member's office-scope Preference), `joinedVia` (`code` | `invite` | `email`), invitedAt / joinedAt / removedAt. **The source of truth for "user X belongs to company Y,"** replacing the raw `memberUserIds` array (migrated). Holds per-member office state and never touches the member's personal account. There is **no seat / no pre-paid subscription** — the company is billed per delivered office coffee on the company card (charge-then-deliver). The owner may also hold a `CorporateMembership` (they can drink office coffee too); membership and billing-ownership are independent.
- **CorporateJoinCode** — code, corporateAccountId, type (`reusable` | `single_use`), `redemptionCap` (optional — owner may cap how many people can join; null = uncapped), redeemedCount / redeemedBy, active, rotatedAt. Lets staff self-join without the owner managing emails. (There are no seats, so any cap is a join limit the owner chooses, not a billing unit.)

**Modified entities (scope to vendor)**
- **Order** — add `vendorId`, `monthlyListId`, `assignmentMethod` (`user_preferred` | `ai_routed` | `reassigned`), accept/reject status + window, `commissionAmount`, `vendorNetAmount`, `chargeStatus`, `payoutStatus`, `stripeChargeId`, `stripeTransferId`. Drink spec references taxonomy. State machine: `scheduled → confirmed(charged) → preparing → out_for_delivery → delivered(payout released)` / `failed(refunded)` / `skipped(not charged)`.
- **Preference** — drink/size/milk/etc. reference **OptionTaxonomy**, not hardcoded values. Add `preferredVendorId` (nullable) + `vendorSelectionMethod` (`manual` | `ai`).
- **User/Subscription** — saved Stripe payment method (card validated at signup, not charged upfront). Optional `walletBalance` field reserved for a possible future prepaid model (do not build wallet logic yet).
- **Cafe (v1)** → **fold into Vendor.** Migrate existing café/portal records to Vendor #1.

**Schema reservations (Phase I — added)**
- **`externalId`** — every persistent entity carries a stable external UUID generated on create, distinct from `_id`. Used at the API boundary for stable identity and future export/reconciliation. Backfill existing records in a tested, reversible migration (see Phase I).
- **`tenantId`** — every persistent entity carries a `tenantId`, defaulted to a single constant. Reserved only; no multi-tenant behavior is built yet.

**Corporate team accounts (Phase J — added; coexists with personal accounts)**
- **CorporateAccount** — add `selectionMode` (`bundle` | `individual`), `memberSelfSelect` (bool), `memberCanDecline` (bool), `bundleDrink` (taxonomy spec, used when `selectionMode = bundle`), `officeDefaults` (location/schedule applied to office coffee), `joinCode`, and a saved **company payment method** (`companyStripePaymentMethodId` — the card all delivered office coffees are charged to, charge-then-deliver). **No seat count and no per-seat subscription** — billing is purely per delivered office coffee. *(Proposed defaults: `individual` / self-select on / decline on — these are business decisions; confirm before locking, per critical rule #11.)* The `memberUserIds` array is superseded by `CorporateMembership`. The owner may optionally hold their own `CorporateMembership` to receive office coffee.
- **Preference** — key per (`userId`, `scope`) where `scope` is `personal` or a `corporateMembershipId`, so a member holds a personal preference **and** a separate office preference. Changes the existing unique `{ userId }` index → `{ userId, scope }` (tested, reversible migration — Phase A discipline).
- **Order** — add `source` (`personal` | `corporate`) and `corporateMembershipId` (corporate orders only). Unique index moves `(userId, date)` → `(userId, date, source)`, so a member can hold a personal order and an office order on the same day. State machine, charging, and payout are otherwise unchanged — **personal coffee charges the member's own card; office coffee charges the company card** (charge-then-deliver, same as personal); never cross-charged. The member's personal card is **never** charged for an office coffee under any circumstance.
- **User** — joining/leaving a company **no longer mutates `role`**. The personal role, subscription, and preferences are untouched; membership lives entirely in `CorporateMembership`.

**Migration note:** Phase A is where v1 and v2 data diverge. Write it as a clean, tested, reversible migration. After it runs, there is no separate "v1 data" — there is one app with Vendor #1.

---

## Phases

### Phase A — Multi-Tenancy Groundwork
- Introduce `Vendor`. Scope existing menu/order/capacity/portal data to a `vendorId`.
- Migrate my own operation + existing café-portal records to **Vendor #1**.
- No user-facing change yet. Verify v1 flows still work end-to-end with one vendor.
- **Deliverable:** the existing app runs unchanged, now internally vendor-scoped.

### Phase B — Vendor Onboarding + Portal Shell
- Vendor application flow (business info, location, hours, capacity) → status `pending`.
- Admin review → approve/reject → `active`.
- Auth0 vendor role; vendor login scoped to their Vendor.
- Vendor profile, operating hours, service-area (radius/polygon via Google Maps), status controls.
- **Deliverable:** a new vendor can apply, be approved, and log into their portal.

### Phase C — Standardized Taxonomy + Vendor Menus
- Seed **OptionTaxonomy** (canonical drinks/sizes/milks/add-ons/strength).
- Vendor menu management: map offerings to taxonomy, set prices, availability toggles, optional images.
- Refactor subscriber **Preference** to reference taxonomy (migrate v1 hardcoded prefs).
- **Deliverable:** vendors publish standardized menus; subscriber prefs are taxonomy-based and portable.

### Phase D — Vendor Selection + Routing Engine (critical)
- **Subscriber selection UI (hybrid):**
  - Manual: browse/select a preferred vendor in their area.
  - AI: short questionnaire (priorities — proximity, price, speed, rating, drink) → recommend a vendor.
  - Show selection → user can edit → confirm. Effective only after confirm.
- **Routing engine** (wire into existing daily order-generation + cutoff jobs):
  - If a confirmed preferred vendor exists and is available (in-area, within hours, under capacity, can make the drink) → assign it.
  - Else auto-route to best available vendor by proximity + capacity + hours + menu coverage (+ rating tiebreak).
  - Vendor accept/reject window; on reject or timeout → reassign.
  - Record `assignmentMethod` and snapshot vendor + price at confirmation.
- Idempotent: one order per (userId, date); safe to re-run jobs.
- **Build with tests before moving on.**
- **Deliverable:** each subscriber gets a vendor-assigned daily order via preferred-or-AI selection, with reassignment fallback.

### Phase D.5 — Monthly List (AI selection → confirm → scheduled orders)
This sits between selection/routing and payments. It is how the user "chooses once a month."
- **AI generates a proposed monthly list:** for each delivery day in the period, propose a drink (taxonomy) + assigned vendor, using the hybrid selection logic from Phase D (preferred vendor where set, AI-routed otherwise).
- **User reviews the full month:** can edit any day (swap vendor, change drink, skip a day), then **confirms** the list.
- **On confirm:** persist as individual **scheduled daily Orders**, one per delivery day, each carrying its `vendorId` and `monthlyListId`. The existing daily generation/cutoff jobs operate on these.
- Users can still edit individual upcoming days after confirming (until that day's cutoff) — reuse the existing modification-window logic.
- **Deliverable:** user confirms one monthly list; the system has a full month of scheduled, vendor-assigned daily orders requiring zero daily interaction.

### Phase E — Stripe Connect, Per-Day Charging & Delivery-Gated Payouts (critical)

**User charging model — charge-then-deliver, per-day (NOT monthly upfront).**
The user's pain point is choosing/approving daily, not being charged daily. Per-day charging is invisible to the user and avoids the refund/reconciliation mess of charging a variable month upfront. The card is charged **before** the coffee is sent to the vendor, so we never deliver a coffee we can't collect payment for.
- At signup: validate + save the card (Stripe SetupIntent / saved payment method). No upfront charge.
- At **each day's cutoff:** charge the user for that one coffee into the **platform balance**, and **only if the charge succeeds**, lock the order (`confirmed`/charged) and release it to the vendor to prepare. **Vendor handoff is gated on a successful charge** — an order is never sent to a vendor until its charge has cleared. Fully automatic — the user does nothing daily.
- Do **NOT** transfer to the vendor at this point. Funds are held in the platform balance until delivery is confirmed.
- Optionally surface a **monthly statement/summary** for the "one monthly payment" feel — without actually charging upfront.
- Do **not** offer the user a daily-vs-monthly charge toggle. If true prepaid is ever wanted, implement it as a **prepaid wallet** (top up → daily orders draw down → rollover/refund), never direct full-month card charges with mid-month adjustments. Deferred for now.

**Failed charge at cutoff — retry, then skip + notify.**
- If the card charge fails at cutoff: **retry a small number of times** over a short window (exact count/spacing is a business decision — confirm before hardcoding, rule #11).
- If it still fails after retries: **skip that day** (no coffee, order → `failed`/`skipped`, no vendor handoff) and **notify the customer** their card couldn't be charged so they can fix it. Do not pause the whole subscription on a single failed day.

**Charged but delivery fails — automatic refund.**
- Because we now charge before delivery, a coffee can be paid for and then **fail to deliver** (vendor burns it, rider can't reach the customer, etc.). When a `confirmed`/charged order ends in `failed` (not delivered):
  - **Automatically refund the customer in full** for that order (money back to card, via Stripe refund — idempotent).
  - Send the customer (and, for office coffee, the team admin) an **apology + the reason** for the failure.
  - Since the vendor was never paid (payout is delivery-gated), there is nothing to claw back.

**Money mechanism — separate charges and transfers (the "charge early, hold, release on delivery").**
- Charge the user into the platform balance at cutoff (above), gated so the order only goes to the vendor if the charge cleared.
- Create the Stripe **transfer** to the vendor's connected account **only after delivery is confirmed**, net of commission.
- This holds the vendor's share until the day's coffee is delivered — even though the customer was charged earlier. Charge early (so we never deliver an uncollectible coffee), pay the vendor late (so we never pay for a coffee that didn't arrive). Use separate charges and transfers, not card auth holds (card authorizations expire in ~7 days and don't fit daily recurring orders).

**Vendor payout cadence — vendor's choice.**
- Vendors choose `payoutCadence` in their portal: `per_order` (transfer per completed delivery) or `daily_batch` (sweep the day's held, delivered funds once). Default `daily_batch` (fewer transfers, lower fees for the platform).
- Cadence only changes *how often held funds are swept*, never *whether* payout is delivery-gated. No delivery → no payout, regardless of cadence.
- Do not auto-assign cadence by vendor size/popularity — let vendors choose. Tiering can come later if real demand appears.

**Connect, commission, refunds.**
- Onboard vendors as Stripe **connected accounts** (Stripe handles KYC/bank — never store payout details).
- Commission: platform default + per-vendor override, retained on transfer.
- Vendor earnings view, statements, payout history.
- **Refund / no-show handling:** charge happens before handoff, so by delivery time the customer has already paid. If **delivery fails** → no transfer to the vendor, and **automatically refund the customer in full** for that day (+ apology/reason; for office coffee also notify the team admin). Delivered then disputed → refund user and **reverse the transfer** from the vendor (Stripe transfer reversal).
- Verify all webhooks with signing secret; handle duplicate/out-of-order events idempotently.

**Edge cases to design now:**
- Vendor goes offline for days a user pre-assigned → routing reassigns; charge/payout follow the new vendor; notify user.
- User edits a day after confirming → cancel that scheduled order, regenerate; no charge until its own cutoff.
- User joins mid-month → list + charging start from join date.
- Charge fails at cutoff → retry a few times, then skip-and-notify (do not pause the whole plan on one failed day).
- Charged successfully but delivery then fails → automatic full refund + apology/reason; vendor (never paid) keeps nothing.

- **Deliverable:** per-day charge at cutoff into platform balance with **vendor handoff gated on the charge succeeding**; vendor paid (per-order or batched, their choice) only after delivery; failed charges skip-and-notify; charged-but-undelivered orders auto-refund; correct refunds and transfer reversals.

### Phase F — Capacity & Lightweight Inventory
- Daily order caps + optional per-slot caps per vendor (feeds routing availability).
- "Sold out today" / per-item unavailable toggles.
- Order-accepting cutoff per vendor.
- (Defer true ingredient-level inventory unless vendors request it.)
- **Deliverable:** vendors control load; routing respects capacity and availability.

### Phase G — Ratings, SLAs, Vendor Quality
- Post-delivery rating → aggregate into Vendor.ratingScore.
- Track acceptanceRate + onTimeRate; surface in vendor portal.
- Feed quality signals into routing tiebreaks; auto-throttle/flag poor performers.
- **Deliverable:** quality scoring that improves routing and flags bad vendors.

### Phase H — Admin Expansion
- Approve/suspend vendors; set commission (default + overrides).
- Routing health dashboard (reassignment rate, vendor load, failures).
- Dispute tools, manual order reassignment, manual refunds.
- **Deliverable:** operator can run the marketplace from the admin portal.

### Phase I — Service Boundary, Versioned API & Outbound Webhooks (additive, no downgrade)
**Goal:** improve the backend boundary so domain logic is cleanly callable and observable, without changing any frontend feature. This is a maintainability/testability win first; portability is a side benefit. **Nothing user-facing changes. No feature is removed or degraded.**

Run only after the platform is stable (A–H). Build in **small, short-lived feature branches off `main`** (e.g. `feature/extract-routing-service`, `feature/v1-api-scaffold`, `feature/outbound-webhooks`) that merge back quickly. Do **not** keep one long-lived parallel API branch — it would drift and conflict against ongoing work. The single-vendor branch stays frozen as a reference; this work belongs on the live trunk.

- **I.1 — Extract domain logic into pure service functions.** Move routing, monthly-list generation, charging, payout sweeps, refunds, etc. into framework-agnostic service functions. Next.js routes and cron jobs become thin callers. **Behavior must be identical** — this is a refactor, verified by the existing tests (add characterization tests first where coverage is thin). No schema or UX change.
- **I.2 — Stable external IDs.** Add `externalId` (UUID) to every entity, generated on create. Backfill existing rows in a **tested, reversible** migration (mirror the Phase A discipline). Use `externalId` at the API boundary; never expose raw `_id`.
- **I.3 — Reserve `tenantId`.** Add `tenantId` to every entity, defaulted to one constant value, in the same migration. **No multi-tenant logic** — reservation only. A separate future phase would activate it if ever needed.
- **I.4 — Versioned `/v1` API.** Thin HTTP handlers over the I.1 services, under `/v1`, Zod-validated, authenticated. Additive: the existing frontend keeps working exactly as before (it may migrate onto `/v1` opportunistically, but is never forced to and never loses behavior).
- **I.5 — Outbound webhooks.** Emit signed lifecycle events (`order.scheduled`, `vendor.assigned`, `order.confirmed`, `order.delivered`, `order.failed`, `payout.released`, `refund.issued`, etc.) to registered subscribers. Best-effort and non-blocking — emission failure never blocks or alters a core order/charge/payout action, exactly like notifications. Idempotent delivery with retries.
- **Deliverable:** the same product, now with a clean service layer, a versioned API, stable external IDs, a reserved tenant field, and outbound events — all additive, no frontend feature change, fully covered by tests proving behavior is unchanged.

### Phase J — Corporate Team Accounts: Self-Management & Personal/Office Coexistence
**Goal:** turn the existing corporate feature (one billing owner, members) into a real team product: staff manage their own office coffee, the owner controls how much autonomy they get, members join with a simple code, the company pays **per delivered office coffee on one company card** (charge-then-deliver — no seats, no monthly seat fee), and — critically — **a staff member's personal BrewPass account and their office membership coexist without either ever overriding the other.** Additive and migration-safe, same discipline as Phase A. Builds on the existing `CorporateAccount`; **replaces the old per-seat subscription billing with per-delivered-coffee billing on the company card.**

- **J.0 — Decouple membership from `role` (the non-conflict foundation).** Today, adding a member rewrites their `role` `individual`/`student` → `corporate`, erasing their personal identity. Stop this. **Corporate membership becomes a relationship (`CorporateMembership`), not a role mutation.** A user keeps their personal role, personal subscription, and personal preferences fully intact while also belonging to one (or more) companies. Migrate the existing `memberUserIds` array into `CorporateMembership` rows.
- **J.1 — Join by code (no email management).** The owner generates a **join code** for the company (rotatable; optional redemption cap if the owner wants to limit headcount), with optional single-use invite codes for tighter control. A staff member redeems the code from their app: if they already have a BrewPass account they **link it** (their personal coffee stays exactly as-is); if not, they sign up, then link. No owner-side email entry, no requirement that the owner knows the member's login. Redeeming creates a `CorporateMembership` (`active`). **No seat subscription is created** — office coffees are billed per delivery on the company card.
- **J.2 — Separate office preference.** Each membership carries its **own office preference** (drink/schedule/location), independent of the member's personal preference, defaulting to the owner's `officeDefaults`. Personal coffee is never touched. (Requires the per-(user, scope) preference key from the data-model change above.)
- **J.3 — Owner autonomy controls (server-enforced).** Per company, the owner sets: **selection mode** `bundle` (owner picks one office coffee for everyone) vs `individual` (each member picks their own); **`memberSelfSelect`** on/off (may members choose/edit their office coffee at all); **`memberCanDecline`** on/off (may members skip — "don't want today"). All three are enforced **server-side on every member order mutation**, not merely hidden in the UI.
- **J.4 — Owner visibility & control.** The owner sees, per member: joined or not, whether they've set their office coffee, today's/tomorrow's selection, want vs skip, and delivery status. The owner can set the bundle coffee and — where `memberSelfSelect` / `memberCanDecline` allow — toggle want/skip on a member's behalf.
- **J.5 — Personal/office coexistence & same-day reconciliation (critical).** A staff member may receive **both** a personal coffee and an office coffee, even on the same day — orders are unique per **(userId, date, source)**, not (userId, date). Charging stays correct and fully separated: **personal coffee charges the member's own card; office coffee charges the company card** (charge-then-deliver for both). The member's personal card is **never** charged for office coffee, and the company card is **never** charged for personal coffee. Because the two are billed to different cards, having both on the same day is **not a billing conflict** — both can simply proceed.
  - **Optional same-day notice (not a blocking prompt):** if a member would get both a personal and an office coffee on one day, the member may be *informed* and offered a one-tap "cancel one" — but the **default is keep both**, and they are never *required* to choose. This keeps the "user does nothing daily" promise intact (a mandatory daily prompt would break it).
  - **Remember-my-choice:** if a member repeatedly cancels one side on overlap days, let them set a standing rule (e.g. "on office-coffee days, skip my personal coffee") so they are not asked again. No daily interaction.
  - Neither account ever silently cancels the other; this is the only place the two interact, and it is advisory.
- **J.6 — Lightweight member tracking.** Members get coffee details + ETA + status for their office coffee; the live map is available but optional (a compact "arriving ~9:05 · Flat White · Level 12" view suffices for staff who don't want the map).
- **J.7 — Company-card charging (charge-then-deliver) & failure handling.** Each delivered office coffee is charged to the **company card** at its cutoff, gated the same way as personal coffee — office coffee is only sent to the vendor if the company-card charge succeeds; vendor payout stays delivery-gated; charged-but-undelivered office coffee auto-refunds to the company card.
  - **Company-card charge fails at cutoff:** retry a few times, then **skip just that day's office coffee for the affected member(s) and notify the team admin (owner)**. Personal coffees for the same staff are on personal cards and are **completely unaffected** — one company-card failure must never touch anyone's personal coffee. Do not freeze the whole company on a single failed day.
- **Build with tests** for J.0 (membership ≠ role), J.3 (server-side autonomy enforcement), J.5 (per-source idempotency + personal/office card separation), and J.7 (company-card charge-gating + failure isolation from personal coffee) before shipping.
- **Deliverable:** staff self-manage office coffee under owner-set autonomy rules, join by code, keep their personal account fully intact alongside their office membership, the company pays per delivered office coffee on one company card (charge-then-deliver, delivery-gated payout, auto-refund on failed delivery), and any same-day personal/office overlap is resolved without forcing daily interaction — no account ever overrides the other.

---

## Critical Rules for Claude Code

1. **Never double-charge, double-generate, double-pay, or double-refund.** Idempotency keys on all cron + charge + transfer + refund actions, keyed per (orderId, action). A **charged-but-undelivered** order (charge succeeded, delivery later failed) must **auto-refund the customer in full** — idempotently, once.
2. **Routing, cutoff, charging, payouts, and refunds are server-only.** Clients request; the server decides.
3. **Charge-then-deliver: charge the card per-day at cutoff into the platform balance, and only send the order to the vendor if the charge succeeds.** Never charge the full month upfront. Vendor handoff is **gated on a successful charge** — no order is made or delivered unless its charge cleared. The user does nothing daily; charging is invisible. Any "monthly" feel is a statement/summary or a future prepaid wallet, never upfront card charges with mid-month adjustments. If the charge fails, retry a few times, then skip-and-notify (don't pause the whole plan on one failed day).
4. **Vendor payout is always delivery-gated.** No delivery → no transfer. `payoutCadence` (per_order vs daily_batch) only controls sweep frequency, never whether payout happens. Use separate charges and transfers, not card auth holds.
5. **Subscriber preferences and monthly lists reference the taxonomy, never a single vendor's menu.** Keeps auto-orders portable across vendors and reassignment.
6. **Snapshot vendor, drink spec, and price at order confirmation / list confirmation.** Don't read live menus/preferences after lock.
7. **Vendor selection and the monthly list take effect only after the user confirms.** Both AI and manual are editable pre-confirm; never silently change a confirmed selection or list.
8. **My own operation is just Vendor #1.** No special-case branches.
9. **Stripe Connect:** never store vendor bank/KYC data. Reverse transfers correctly on refund/dispute.
10. **Phase A migration must be clean, tested, and reversible.** This is where v1 and v2 data diverge.
11. **Confirm with me before hardcoding** commission rates, capacity defaults, routing weightings, cutoff times, or failed-card policy — business decisions.
12. Don't swap or add infrastructure without asking.
13. **Phase I work is additive and behavior-preserving.** The service-extraction refactor must not change any user-facing behavior; the `/v1` API and webhooks are layered on top and must never degrade or remove an existing frontend feature. If a Phase I change would alter behavior, stop and confirm with me first.
14. **`externalId` and `tenantId` are schema reservations.** Always generate `externalId` on create and expose it (not `_id`) at the API boundary. Always set `tenantId` to the default constant, but **do not build any multi-tenant logic** until a future phase explicitly calls for it.
15. **Don't over-build for a hypothetical integrator/acquirer.** Build only what also improves the platform today (clean boundaries, stable IDs, a real API, events). No speculative acquirer-specific shims, adapters, or data-export pipelines until there's a concrete need.
16. **Corporate membership never overrides a personal account.** Joining or leaving a company must not change a user's personal `role`, personal subscription, or personal preferences. Membership is a relationship (`CorporateMembership`), not a role mutation. One user can simultaneously be a personal subscriber and an office member, and the two must work together.
17. **Personal and office coffee are distinct order sources with strictly separate cards.** Orders are unique per (userId, date, source), not (userId, date). **Personal coffee charges the member's own card; office coffee charges the company card** — never cross-charge in either direction, under any circumstance. There are **no seats**: the company is billed per delivered office coffee (charge-then-deliver). Because the two sources bill different cards, both can occur on the same day with no billing conflict; any same-day overlap notice is **advisory and non-blocking** (default keep both, optional remember-my-choice) — never a mandatory daily prompt, which would break the "user does nothing daily" promise. A company-card failure must never affect anyone's personal coffee.
18. **Owner autonomy toggles are server-authoritative.** `selectionMode` (bundle/individual), `memberSelfSelect`, and `memberCanDecline` are enforced on the server for every member order action — not just shown/hidden in the UI. Bundle and owner-set selections still snapshot at generation (rule #6); members may edit only when self-select is enabled.

---

## Build Order Reminder
A → B → C → **D (carefully)** → D.5 → **E (carefully)** → F → G → H → **I (additive, last)** → **J (corporate team accounts — additive; coexists with personal accounts)**.
D (routing) and E (charging/payouts) carry almost all the risk. If anything is shaky, it's there. D.5 (monthly list) is what makes "choose once a month" real and feeds scheduled orders into E. **I (service boundary + `/v1` API + webhooks + `externalId`/`tenantId` reservations) is additive and runs only once A–H are stable — it improves the backend without changing the frontend.**

---

## Go-Live TODO (before real customers)

Deferred to keep the initial deploy on Vercel's free **Hobby** plan (Hobby
allows only daily cron jobs). Revisit these the moment real, paying
customers come on board:

- [ ] **Re-add the outbound-webhooks cron.** It was removed from
  `vercel.json` because its `*/5 * * * *` (every-5-minutes) schedule is
  blocked on Hobby. The route still exists at
  `src/app/api/cron/webhooks/route.ts` and can be triggered manually
  (`curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/webhooks`).
  When going live, **upgrade Vercel to Pro and restore this entry in
  `vercel.json`:**
  ```json
  { "path": "/api/cron/webhooks", "schedule": "*/5 * * * *" }
  ```
  Until then, outbound webhook deliveries (Phase I.5) are enqueued but only
  swept when the cron is run manually — fine while there are no external
  webhook subscribers, **not** fine once integrations rely on timely events.
- [ ] **Confirm the Pro plan covers `maxDuration = 300`.** All cron routes
  request a 300s budget; Hobby caps function runtime lower. Harmless at test
  volume (jobs finish in well under a second), but the daily
  charging/payout sweeps need the headroom at real order volume.
