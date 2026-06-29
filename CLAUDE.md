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
- **Couriers:** `CourierAdapter` abstraction — provider-agnostic delivery dispatch, tracking, and webhooks. Adapters: **Lalamove** (Malaysia / MY market, primary); **Uber Direct** (Australia / AU market, primary — confirmed Perth coverage, self-serve sandbox); **DoorDash Drive Classic** (AU, secondary/fallback — allowlist-only, AU sandbox requires DoorDash Support to enable per-account; confirm granted API surface before building in detail). AU dispatch uses primary-with-auto-fallback (no vendor choice, no real-time quoting at cutoff). Courier fee is a platform cost — never charged to the user and never deducted from vendor payout.

### Conventions (carried from v1)
- TypeScript strict. Zod-validate all external input.
- Money in integer minor units (sen for MYR, cents for AUD); currency always travels with the amount. `Delivery.courierFeeCurrency` (`"MYR"` | `"AUD"`) records which currency the courier fee is denominated in — never assume MYR for courier-related amounts. The courier fee field is `courierFeeAmount` (renamed from `courierFeeAmountSen`; no migration needed — there are no pre-existing Delivery records).
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
- **Vendor** — businessName, ownerUserId, status (`pending` | `active` | `paused` | `suspended` | `offline`), address, geocoded lat/lng, serviceAreaRadius (or polygon), operatingHours, capacity (daily cap + optional per-slot caps), stripeConnectAccountId, commissionRateOverride (nullable → falls back to platform default), **payoutCadence (`per_order` | `daily_batch`, default `daily_batch`)**, ratingScore, acceptanceRate, onTimeRate. **`market` (`"MY"` | `"AU"`, required)** — the vendor's operating market. Geocoded at onboarding to suggest a default; the admin sets it authoritatively at approval (pre-filled from geocode, overridable). Used for per-market courier adapter resolution. `courierProvider` (nullable) — reserved for per-vendor override within their market; platform auto-fallback logic governs AU vendors by default (see Phase M).
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
- **CorporateAccount** — add `selectionMode` (`bundle` | `individual`), `memberSelfSelect` (bool), `memberCanDecline` (bool), `bundleDrink` (taxonomy spec, used when `selectionMode = bundle`), `officeDefaults` (location/schedule applied to office coffee), `joinCode`, and a saved **company payment method** (`companyStripePaymentMethodId` — the card all delivered office coffees are charged to, charge-then-deliver). **No seat count and no per-seat subscription** — billing is purely per delivered office coffee. *(Confirmed defaults: `individual` selection / `memberSelfSelect` on / `memberCanDecline` on — owner-overridable.)* The `memberUserIds` array is superseded by `CorporateMembership`. The owner may optionally hold their own `CorporateMembership` to receive office coffee.
- **Preference** — key per (`userId`, `scope`) where `scope` is `personal` or a `corporateMembershipId`, so a member holds a personal preference **and** a separate office preference. Changes the existing unique `{ userId }` index → `{ userId, scope }` (tested, reversible migration — Phase A discipline).
- **Order** — add `source` (`personal` | `corporate`) and `corporateMembershipId` (corporate orders only). Unique index moves `(userId, date)` → `(userId, date, source)`, so a member can hold a personal order and an office order on the same day. State machine, charging, and payout are otherwise unchanged — **personal coffee charges the member's own card; office coffee charges the company card** (charge-then-deliver, same as personal); never cross-charged. The member's personal card is **never** charged for an office coffee under any circumstance.
- **User** — joining/leaving a company **no longer mutates `role`**. The personal role, subscription, and preferences are untouched; membership lives entirely in `CorporateMembership`.

**Vendor promotions (Phase K — added)**
- **VendorPromotion** — vendorId, `type` (`pack` | `buy_n_get_m` | `time_window_discount`), name, status (`draft` | `active` | `paused` | `expired`), `validFrom`/`validUntil` (campaigns are time-boxed), `commissionRateOverride` (nullable → falls back to the vendor/platform rate; lets a promo carry its own commission — a rule #11 business decision). A single base entity with a `type` discriminator so packs ship first (K.1) and other campaign types (K.2) extend the same model rather than a retrofit. Type-specific fields:
  - **pack** — `packSize` (fixed integer count), `packPrice` (vendor-set, the discounted total in sen), `packMode` (`fixed_drink` = same coffee ×N, drink spec stored as taxonomy; or `buyer_choice` = buyer picks `packSize` drinks from this vendor's menu, count locked).
  - **buy_n_get_m** — `buyQty`, `freeQty`.
  - **time_window_discount** — `discountPct`, `windowStart`/`windowEnd` (time-of-day), applicable days.
- **PackPurchase** — corporateAccountId (packs are an office-buying feature), vendorPromotionId, date, `packSnapshot` (size/price/mode/drink frozen at purchase — rule #6), `assignments` (array of `{ corporateMembershipId, drinkSpec }`, up to `packSize`; unassigned slots are paid-for-and-skipped), and `topUpOrderIds` (individual office Orders bought alongside to cover members beyond `packSize`). The day's office purchase = one optional PackPurchase + N top-up Orders. Charge-then-deliver: the company card is charged for (pack price + top-ups) at cutoff; each underlying coffee is still its own delivery-gated Order for payout.

**Consolidated delivery (Phase L — added)**
- **DeliveryRun** — groups multiple Orders (potentially across **different vendors**) into **one physical delivery** to one location at one time: `orderIds`, `dropLocation`, `targetDeliveryTime`, `pickupStops` (ordered list of vendor pickups), `courierRunId` (multi-stop courier reference), status. Orders stay per-vendor (each made and **paid delivery-gated independently**); the run is only the *delivery* grouping. **Per-order** delivery confirmation within a run — a partial failure refunds just the missing Order and pays the rest. A run is mutually exclusive with a vendor Pack on the same delivery (a Pack is single-vendor by definition).

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
- If the card charge fails at cutoff: **retry 3 times over ~10 minutes** (roughly at 0, 3, and 10 minutes) — most card failures at cutoff are transient and recover on retry.
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

> **Build order (dependency, not numbering):** the J.x numbers are conceptual order. For implementation, build **J.2 → J.3 → J.7 → J.4 → J.5 → J.6**. J.7 (office-order generation + company-card charging) is the *producer* of office orders; J.4/J.5/J.6 are *consumers* that display and reconcile them — so J.7 comes first, giving the others real orders to work against instead of mocks. (J.7 itself depends on J.2's office preference and J.3's autonomy rules being in place.) The numbers stay as written so existing commit/PR references (e.g. "J.7") don't break.

- **J.0 — Decouple membership from `role` (the non-conflict foundation). ✅ DONE.** Today, adding a member rewrites their `role` `individual`/`student` → `corporate`, erasing their personal identity. Stop this. **Corporate membership becomes a relationship (`CorporateMembership`), not a role mutation.** A user keeps their personal role, personal subscription, and personal preferences fully intact while also belonging to one (or more) companies. Migrate the existing `memberUserIds` array into `CorporateMembership` rows.
- **J.1 — Join by code (no email management). ✅ DONE (models + APIs; UI deferred to J.4).** The owner generates a **join code** for the company (rotatable; optional redemption cap if the owner wants to limit headcount), with optional single-use invite codes for tighter control. A staff member redeems the code from their app: if they already have a BrewPass account they **link it** (their personal coffee stays exactly as-is); if not, they sign up, then link. No owner-side email entry, no requirement that the owner knows the member's login. Redeeming creates a `CorporateMembership` (`active`). **No seat subscription is created** — office coffees are billed per delivery on the company card.
- **J.2 — Separate office preference.** Each membership carries its **own office preference** (drink/schedule/location), independent of the member's personal preference, defaulting to the owner's `officeDefaults`. Personal coffee is never touched. (Requires the per-(user, scope) preference key from the data-model change above.)
- **J.3 — Owner autonomy controls (server-enforced).** Per company, the owner sets: **selection mode** `bundle` (owner picks one office coffee for everyone) vs `individual` (each member picks their own); **`memberSelfSelect`** on/off (may members choose/edit their office coffee at all); **`memberCanDecline`** on/off (may members skip — "don't want today"). All three are enforced **server-side on every member order mutation**, not merely hidden in the UI.
- **J.4 — Owner visibility & control.** The owner sees, per member: joined or not, whether they've set their office coffee, today's/tomorrow's selection, want vs skip, and delivery status. The owner can set the bundle coffee and — where `memberSelfSelect` / `memberCanDecline` allow — toggle want/skip on a member's behalf. **Includes the deferred J.1 UI surfacing:** owner can view/share/rotate/revoke the company join code, and members get a "join a company" entry point to redeem a code. (J.1 shipped the join-code models + APIs without UI; this is where that UI lands, replacing the old seat-model corporate dashboard.)
- **J.5 — Personal/office coexistence & same-day reconciliation (critical).** A staff member may receive **both** a personal coffee and an office coffee, even on the same day — orders are unique per **(userId, date, source)**, not (userId, date). Charging stays correct and fully separated: **personal coffee charges the member's own card; office coffee charges the company card** (charge-then-deliver for both). The member's personal card is **never** charged for office coffee, and the company card is **never** charged for personal coffee. Because the two are billed to different cards, having both on the same day is **not a billing conflict** — both can simply proceed.
  - **Optional same-day notice (not a blocking prompt):** if a member would get both a personal and an office coffee on one day, the member may be *informed* and offered a one-tap "cancel one" — but the **default is keep both**, and they are never *required* to choose. This keeps the "user does nothing daily" promise intact (a mandatory daily prompt would break it).
  - **Remember-my-choice:** if a member repeatedly cancels one side on overlap days, let them set a standing rule (e.g. "on office-coffee days, skip my personal coffee") so they are not asked again. No daily interaction.
  - Neither account ever silently cancels the other; this is the only place the two interact, and it is advisory.
- **J.6 — Lightweight member tracking.** Members get coffee details + ETA + status for their office coffee; the live map is available but optional (a compact "arriving ~9:05 · Flat White · Level 12" view suffices for staff who don't want the map).
  - **Forward-compatible with Phase L (consolidated delivery):** an office is the most likely first consumer of a `DeliveryRun` (a whole team getting one consolidated drop). Don't assume one delivery = one order in the member-tracking view; L will group multiple office orders into a single delivery.
- **J.7 — Company-card charging (charge-then-deliver) & failure handling.** Each delivered office coffee is charged to the **company card** at its cutoff, gated the same way as personal coffee — office coffee is only sent to the vendor if the company-card charge succeeds; vendor payout stays delivery-gated; charged-but-undelivered office coffee auto-refunds to the company card.
  - **Company-card charge fails at cutoff:** retry on the same policy as personal (**3 times over ~10 minutes**), then **skip just that day's office coffee for the affected member(s) and notify the team admin (owner) immediately** — a company-card failure has a multi-person blast radius, so the owner is alerted fast to fix the card. Also notify the affected member(s). Personal coffees for the same staff are on personal cards and are **completely unaffected** — one company-card failure must never touch anyone's personal coffee. Do not freeze the whole company on a single failed day.
  - **Forward-compatible with Phase K (packs):** build generation so a day's office purchase is *a set of coffees*, not hardcoded as one-order-per-member. Today that set is N individual orders; Phase K adds the case where it's one Vendor Pack (covering up to `packSize` members) plus individual top-ups. Don't bake "exactly one order per member per day" into the generation/charging path — K will extend this, and per additive-phase discipline it should extend, not rewrite.
- **Build with tests** for J.0 (membership ≠ role), J.3 (server-side autonomy enforcement), J.5 (per-source idempotency + personal/office card separation), and J.7 (company-card charge-gating + failure isolation from personal coffee) before shipping.
- **Deliverable:** staff self-manage office coffee under owner-set autonomy rules, join by code, keep their personal account fully intact alongside their office membership, the company pays per delivered office coffee on one company card (charge-then-deliver, delivery-gated payout, auto-refund on failed delivery), and any same-day personal/office overlap is resolved without forcing daily interaction — no account ever overrides the other.

### Phase K — Vendor Promotions (Vendor Packs first)
**Goal:** let vendors run time-boxed discount campaigns, and let a team admin buy a discounted **Vendor Pack** for the office instead of per-member individual coffees. "Vendor Pack" is the marketplace product — deliberately named to **not** collide with Phase J's account-level `selectionMode = bundle` (owner picks one drink for everyone); the two words mean different things and must stay distinct in code. Packs are one *type* of `VendorPromotion`; the phase is built so other campaign types extend the same model.

**Admin-simplicity guardrail (don't break this).** The team admin's core job is to buy the team's coffee with as little friction as possible — that is the whole point of corporate. Promotions must surface as **optional savings nudges** ("a 10-pack from Café X is RM12 cheaper than your usual 8 — use it?"), **never** as a required comparison-shopping step. The admin who ignores promotions still gets a one-tap "buy the usual." The discount rewards the admin who looks; it never taxes the admin who doesn't.

- **K.1 — Vendor Packs (build first).**
  - **Vendor portal:** create/manage Packs (a `VendorPromotion` of `type = pack`): name, `packSize` (fixed count), `packPrice` (vendor-set discounted total), `packMode` (`fixed_drink` = same coffee ×N, or `buyer_choice` = buyer picks `packSize` drinks from the vendor's menu, count locked), and a validity window (the "run it for a week" campaign).
  - **Team admin:** when a Pack exists from a vendor in range, the admin can switch the office off per-member selection and **buy the Pack**. If the team is **larger than the pack** (12 members, 10-pack), the admin buys the Pack **plus individual top-up coffees** to cover the rest — one purchase, represented as a `PackPurchase` + `topUpOrderIds`. The admin then **assigns** which members each coffee covers (or auto-fills by member-list order). **Unassigned pack slots are paid-for-and-skipped** — the discount still beats per-coffee, so this is fine and expected. Assignments are **editable until that day's cutoff** like everything else; removing a member before cutoff frees their slot (auto-reassign to an unassigned member or leave paid-and-skipped — admin's choice).
  - **Vendor-pinned, opts out of reroute (the explicit exception to rule #5).** A Pack is *that vendor's* priced product, so a Pack purchase is **not portable** — if the vendor goes offline, a Pack order does **not** auto-reroute to another vendor (the discount couldn't survive a reroute anyway). Instead: notify the admin "your pack vendor is closed" and **skip/refund** that day's pack. This is the one sanctioned place taxonomy-portability does not apply; it must be explicit, not silent.
  - **Charging/payout:** charge-then-deliver unchanged — company card charged for (pack price + top-ups) at cutoff; each coffee a delivery-gated Order for payout. Commission applies to the pack gross; the pack's commission rate defaults to the vendor/platform rate unless a promo override is set (**rule #11** — confirm before hardcoding a promo-specific rate).
- **K.2 — Other campaign types.** Extend `VendorPromotion`: **buy-N-get-M** ("buy 4 get 1 free") and **time-window discounts** (e.g. 50% off individual coffees 2–4pm to fill quiet periods). Same model, new `type` values; surfaced under the same optional-nudge guardrail.
- **K.3 — Platform-suggested campaigns.** The vendor dashboard analyzes the vendor's *own* order data and **suggests** promotions ("Tuesday afternoons are your quietest — try a 2–4pm discount"). Suggestions only; the vendor always decides. A vendor-retention feature, not an automation that changes prices on its own.
- **Build with tests** for K.1 (pack purchase + top-up math, assignment up to `packSize`, paid-for-and-skipped slots, vendor-offline skip/refund, charge-then-deliver on the company card) before K.2/K.3.
- **Deliverable:** vendors run time-boxed packs (and later other campaigns); a team admin can buy a discounted pack + top-ups in one purchase, assign coffees to members, and the system charges/delivers/pays correctly — with promotions surfaced as optional savings, never forced comparison shopping.

### Phase L — Multi-Vendor Consolidated Delivery
**Goal — the differentiator:** collect coffees from **several different vendors** and deliver them **together** as one drop (e.g. an office wants a flat white from Café A and a cold brew from Café B, arriving together at 9am). Most providers force one vendor per delivery; BrewPass consolidates. This is the most ambitious phase and its hardest problems are **logistics and courier capability, not software** — treat accordingly.

- **L.1 — `DeliveryRun` grouping.** Add `DeliveryRun` (see data model): groups N Orders across different vendors into one drop/time/route. Orders stay per-vendor — each is made and **paid delivery-gated independently**; the run is only the delivery unit. This is the schema change that breaks the implicit "one delivery = one vendor" assumption; do it as a clean, tested addition (Phase A discipline), and make `DeliveryRun` optional so existing single-vendor deliveries are unaffected.
- **L.2 — Per-order confirmation within a run.** Delivery confirmation is **per Order inside the run**, not per run. If the run completes but Café B's coffee never arrived, refund **only** that Order (auto-refund, rule #1) and pay the others. The existing per-order refund logic already fits this — reuse it.
- **L.3 — Courier multi-stop (dependency-gated).** A run needs a **multi-stop pickup** courier job (rider hits Café A → Café B → drop) via the `CourierAdapter` abstraction. **This is blocking and external:** if the chosen courier (Lalamove first) does not support multi-stop pickup in-market, L.3 cannot ship as designed — do **not** fake it with sequential single trips (that kills both the "together" promise and the cost saving). Confirm courier multi-stop capability before committing build effort here. **AU market note:** Uber Direct and DoorDash Drive Classic standard products support one pickup location per delivery — neither is a candidate for L.3 as designed. If consolidated delivery is needed in Perth, a third AU adapter with confirmed multi-stop support (candidates: Sherpa, Stuart) must be validated first. AU market launches single-vendor-per-delivery only; L.3 for Perth is deferred until multi-stop coverage is confirmed.
- **L.4 — Quality/logistics rules (design before coding).** Hot coffee + multi-stop = real constraints: prep-time staggering (don't make A's coffee until B is nearly ready), a **max hold time** for the first-picked coffee, pickup-route ordering, and a policy for a late café (hold the run / drop without them / refund their item). These are product decisions to settle in the spec, ideally validated with a **manual pilot** (a person literally doing a 2-café→1-office run ~10×) before building the consolidation engine.
- **Build with tests** for L.1 (run grouping leaves single-vendor flow unchanged) and L.2 (partial-failure refunds exactly one order, pays the rest) before depending on L.3's courier integration.
- **Deliverable:** an office (or, later, any subscriber) can receive coffees from multiple vendors in a single consolidated delivery, with each vendor made and paid independently, partial failures refunded per-order, gated on real multi-stop courier capability and validated logistics rules.

### Phase M — Perth Market Courier Adapters (additive)
**Goal:** add Uber Direct and DoorDash Drive Classic as two new `CourierAdapter` implementations for the Australia / AU market, behind the same interface that Lalamove uses for MY. **Purely additive** — no changes to the delivery state machine, payout logic, refund logic, or any existing Lalamove/Grab behavior. The only schema additions are `Vendor.market`, `Delivery.courierFeeAmount` (renamed from `courierFeeAmountSen`), and `Delivery.courierFeeCurrency`.

**Prerequisites (confirm before going live):**
- Uber Direct: self-serve sandbox available; production requires Uber for Business developer account → Delivery API access → `client_id`, `client_secret`, `customer_id`. Perth CBD coverage confirmed.
- DoorDash Drive Classic: AU sandbox requires DoorDash Support to enable per-account; production is allowlist-only. Confirm which API surface (Drive Classic vs standard Drive) Support grants before building the DoorDash adapter in detail. Perth AU coverage confirmed at the product level; API surface TBC.
- Both adapters follow the same posture as the existing Grab adapter: `isConfigured()` returns false until production env vars are set, so adapters are dormant in production until access is granted.

**AU dispatch model — primary with auto-fallback (no vendor choice):**
- `MARKET_PRIMARY_COURIERS["AU"] = "uber_direct"` (Uber Direct is the AU primary).
- If the primary adapter's `dispatch()` call fails, automatically retry with the next configured AU adapter (`doordash_drive`, once its API access is granted). The fallback chain is ordered and platform-controlled — AU vendors do not choose their courier.
- No real-time quoting at cutoff (avoids added latency to the charging cron). Quote is fetched at dispatch time, same as the existing Lalamove flow.
- **Forward-reference:** once AU volume justifies optimizing courier cost, upgrade to parallel quoting (both adapters quote simultaneously with a timeout, pick cheapest). That is a future, separately-scoped decision; the auto-fallback model is the launch posture.

**What changes (additive only):**
- `courierProviderSchema` enum: add `"uber_direct"` and `"doordash_drive"`.
- `Vendor` entity: add `market: "MY" | "AU"` (required; geocoded default, admin-authoritative at approval — see Phase M conventions).
- `Delivery` entity: rename `courierFeeAmountSen` → `courierFeeAmount`; add `courierFeeCurrency: "MYR" | "AUD"`. No migration needed — no pre-existing Delivery records.
- `src/lib/courier/index.ts`: add `MARKET_PRIMARY_COURIERS` map and `AU_FALLBACK_CHAIN`; update `resolveCourierProvider` to use `vendor.market` when no explicit provider is set, with auto-fallback on dispatch failure. Existing MY behavior unchanged.
- `src/lib/courier/status.ts`: add `mapUberDirectStatus()` and `mapDoorDashDriveStatus()` functions; register in `mapCourierStatus()` dispatcher.
- `src/lib/courier/uber-direct.ts` and `src/lib/courier/doordash-drive.ts`: new adapter files.
- Webhook routes: handled automatically by the existing `[provider]` dynamic route — no route file changes needed.

**Status mapping (no state machine changes):**

| BrewPass State | Uber Direct | DoorDash Drive Classic |
|---|---|---|
| `pending` | `pending` | `created`, `confirmed` |
| `assigned` | `pickup` | `enroute_to_pickup`, `arrived_at_pickup` |
| `picked_up` | `pickup_complete`, `dropoff` | `picked_up`, `enroute_to_dropoff`, `arrived_at_dropoff` |
| `delivered` | `delivered` | `delivered`, `dasher_dropped_off_with_issue`* |
| `failed` | `canceled`, `returned` | `cancelled` |

\* `dasher_dropped_off_with_issue` → map to `delivered`; store raw status in `courierStatusRaw` for admin review; payout proceeds (the coffee physically left the dasher's hands). Revisit after observing real Perth volume — if this status frequently signals a non-delivery, reconsider.

**Webhook security:**
- Uber Direct: HMAC-SHA256 on `X-Postmates-Signature` header; secret in `UBER_DIRECT_WEBHOOK_SECRET`. Key events: `delivery.status.changed`, `delivery.courier.updated`.
- DoorDash Drive Classic: HMAC-SHA256 on `X-DoorDash-Signature` header; secret in `DOORDASH_DRIVE_WEBHOOK_SECRET`. Key events: `delivery_status` events. (Confirm exact header and event names against the Drive Classic API surface granted by DoorDash Support.)
- Both: idempotent per `(provider, courierOrderId, targetStatus)` in `webhookEventsCollection`, same mechanism as Lalamove.

**Uber Direct OAuth token caching:**
Uber Direct uses OAuth 2.0 Client Credentials (access token with TTL). In serverless, store the token in MongoDB — a `courierTokens` document keyed by provider with `expiresAt`; refresh on expiry before dispatch. No new infrastructure (rule #12); Atlas already handles it. DoorDash Drive Classic uses per-request JWT signing (RS256 with `signing_secret`) — no token storage needed.

**Build with tests** for each adapter (quote, dispatch, tracking, cancel, webhook verify, webhook parse, status mapping) against sandbox before enabling in production. The existing `lalamove.test.ts` is the template.

**Deliverable:** AU-market vendors are dispatched via Uber Direct (primary) with DoorDash Drive Classic as automatic fallback on dispatch failure, all through the existing `CourierAdapter` interface and state machine, with zero change to charging or payout logic. AU launch is single-vendor-per-delivery only; Phase L.3 for Perth is deferred pending multi-stop courier validation.

### Phase N — Subscriber UI Enhancement (additive, look-and-feel only)
**Goal:** apply the new **"BrewPass — Subscriber"** visual design (warm, calm café aesthetic) across all subscriber-facing screens. **Purely a restyle — no routing, charging, routing-engine, payout, or data-model changes.** This is behavior-preserving in the spirit of rule #13: new presentational markup wraps the **existing** server data and components; no feature is added, removed, or degraded. If a styling change would require altering server/data behavior, stop and confirm first.

The source of truth is the design document (10 subscriber screens + a token sheet). Screens map 1:1 onto existing routes, with **one new route** (Profile hub) added. A **second design doc** ("Office Coffee — Adding team members") covers the corporate team-admin + member flows and drives **N.8** (see there for its token caveat).

**Design tokens (single warm light theme — no dark mode):**
- **Colors:** Paper `#E9E2D6`, Surface `#FFFFFF`, Espresso `#3B2317`, Coffee `#5C4632`, Muted `#978674`, Sage `#5C7A4E`, Terracotta `#B0503C`, Amber `#F5DCA6`, Sage-soft `#D9E4CC`, Hairline `#E6DCCB`.
- **Type:** Fraunces (display/headings), Geist (heading/body), Geist Mono (figures — counts, prices, timers). Geist + Geist Mono are already wired in `layout.tsx`; **Fraunces must be added** via `next/font/google`.
- **Primitives:** status pills (`Scheduled` / `Preparing` / `Delivered` / `Skipped` / `Failed` / `Active`), button variants, chip, stepper, notice, field, card — built once under `src/components/ui/` and reused.

**Known mismatches to handle (none are app-breaking):**
- **Profile tab has no route.** The bottom nav's 4th tab ("Profile") needs a **new** `src/app/dashboard/profile/page.tsx` (assembled from existing `profile-form`, `locations-manager`, `health-card`, billing/corporate summaries). The design label "`/dashboard` (profile + hub)" is misleading — real `/dashboard` is the Home screen; Profile is a distinct screen.
- **`globals.css` ships a generic white/black theme + a `prefers-color-scheme: dark` override** that fights the warm palette. Replace the tokens and drop the dark-mode block.
- **No shared mobile app-shell / bottom-nav component exists yet** — build once, reuse across the four `/dashboard/*` tab screens.

- **N.0 — Design-system foundation.** Add color tokens + Fraunces (Tailwind v4 `@theme` in `globals.css`); remove the dark-mode override. Build the primitive UI components from the token sheet under `src/components/ui/`.
- **N.1 — App shell + bottom nav.** `BottomNav` (Home `/dashboard` · Monthly `/dashboard/monthly` · Vendors `/dashboard/vendor` · Profile `/dashboard/profile`) and the shared mobile shell; used by all `/dashboard/*` screens.
- **N.2 — Onboarding flow** (`/onboarding`, `/onboarding/locations`, `/onboarding/preferences`, `/onboarding/payment`): restyle the 4 steps + step indicator, drink/size/milk/strength chips, weekday schedule picker, Stripe card field, "no charge today / charged per coffee" copy.
- **N.3 — Home / dashboard** (`/dashboard`): weekday-plan card, "Tomorrow's Coffee" detail card with pills, locks-in notice, Edit/Skip actions, recent deliveries with inline rating.
- **N.4 — Vendors** (`/dashboard/vendor`): "Let AI pick / Browse cafés" toggle, AI-recommended + nearby vendor cards (rating/distance/price), Confirm CTA — over existing `vendor-selector`. Selection still takes effect only on confirm (rule #7).
- **N.5 — Monthly planner** (`/dashboard/monthly`): proposed-month list, per-day cards (drink + vendor + rationale + skip), Rating/Proximity re-plan controls, month total + Confirm — over existing `monthly-list-planner`.
- **N.6 — Profile hub (new route)** (`/dashboard/profile`): Your usual / Locations / Payment / Office coffee / Health summary / Log out, assembled from existing components.
- **N.7 — Payment / billing** (`/dashboard/billing`): pay-as-you-go card, card-on-file, 6:00 AM cutoff explainer, recent charges (incl. skipped = RM0.00), Pause/Cancel.
- **N.8 — Office coffee: team-admin + member tracks** (`/dashboard/corporate`). Driven by a **second design doc** ("BrewPass · Office Coffee — Adding team members"), which restyles the existing Phase J/K corporate surfaces into two clean flows. **Additive, behavior-preserving:** the corporate backend already exists (`/api/corporate/*` — `join-codes`, `join`, `office-preference`, `office-defaults`, `member-order`, `members`, `settings`, `company-card`) and **all owner-autonomy rules stay server-enforced** (rules #16–#18); this phase only adds/​restyles UI over those APIs. Most of it restyles existing components; two member surfaces are net-new UI over existing endpoints.
  - **Design-token note (DECIDED — unify onto N.0).** The team doc lists a *slightly different* palette (`#3A2513` espresso, `#EFE9DD` paper, `#3A643E` sage, `#8A4438` terracotta, `#FBE2BA` amber) and a different display font (Bricolage Grotesque). **Decision: reuse the existing N.0 subscriber tokens + Fraunces** for the team screens too — one coherent design system; the deltas are minor. Do **not** add Bricolage or new color tokens for N.8.
  - **N.8a — Team-admin track** (owner; restyle of `corporate-owner-dashboard`): owner home with **company-card** status ("•••• 4242 · charged here, never a member's card"), **office default** drink + schedule summary with Edit, "no seats — pay per delivered coffee" copy, and a **team roster** (avatars + count); the **join-code** panel (share/copy/share-sheet, rotate, revoke), **join-limit** edit (`redemptionCap`) and **single-use invite** minting (both already supported by the join-codes API); roster rows with member **status pills** (Want / Skipped / Joined / Pending) and the **autonomy rules** display (selection mode · self-select · decline). All toggles remain server-authoritative (rule #18).
  - **N.8b — Team-member track** (member): **join your company** by code with the "won't touch your personal account" reassurances (restyle of `join-company-panel`); a **"You're in" confirmation** state (new UI) offering "Set your office coffee" vs "Keep the office default"; a **"Set your office coffee" editor** (drink/size/milk/sugar/strength over the existing `office-preference` PUT, **gated by `canMemberSelectOffice`** — new UI, no new behavior; company-set schedule shown read-only, editable until the 6:00 AM cutoff); and **home tracking** showing both a personal and an office coffee with the **advisory non-blocking overlap** ("Both coffees tomorrow · Keep both / Cancel one / Remember my choice", default keep both — rule #17, restyle of the existing `overlap-notice`).
  - Also relocate the live **"Arriving ~9:05" `office-coffee-tracker`** from Home to the office screen (it was kept on Home in N.6 to avoid a gap).
  - **Build with tests** only if a member surface touches the autonomy gate (server already enforces it); otherwise this is presentational. No charging/payout/data-model change.
- **N.9 — Polish & verify.** Responsive pass, run the app per screen, confirm no behavior regressions, then push.
- **Deliverable:** all subscriber screens reflect the new warm design through a reusable token/primitive system + shared app shell and bottom nav, with a new Profile hub route, and **zero change to any server, routing, charging, or data behavior.**

### Phase O — Graceful Degradation & Fallbacks (additive + behavior-preserving hardening)
**Goal:** make the "app never breaks" principle real and testable. Source of truth is `fallbacks.md` (companion spec): every place the app must **degrade gracefully** rather than break — missing dependency, empty data, or a failed path. Each entry there is a testable acceptance criterion (happy path unchanged + fallback path produces the documented behavior, idempotently, with friendly copy or sufficient logging).

**Assessment of `fallbacks.md` (done as part of this phase's planning):** the spec is sound and **does not break the app** — it is overwhelmingly additive (new empty-states, new skip-reasons, new error boundaries) and consistent with the existing charge-then-deliver / delivery-gated-payout / idempotency model. **~60% is already implemented** and just needs characterization tests to lock it as a contract; the rest is net-new. **Three items need care or a decision before coding** (flagged inline below as ⚠) — they are the only places the spec could regress behavior or collide with an existing decision. **Build everything as small additive changes with the failure-case test written alongside the happy-path test** (`fallbacks.md` acceptance-criteria rule). No charging, payout, routing-decision, or state-machine semantics change except where a sub-item explicitly says so and is confirmed under rule #11/#12.

> **Already satisfied — verify with a characterization test, don't rebuild** (do not regress these): §2.1 preferred-vendor-unavailable reassign; §2.6 neutral 0.5 new-vendor quality; §2.7 quality-then-`externalId` tiebreak; §2.8 + §8.7 pack-vendor-offline skip/refund and paid-for-and-skipped slots (`pack-cutoff.ts`); §3.1 deterministic vendor-recommender fallback (`vendor-recommender.ts`); §3.2 deterministic monthly-planner fallback (`ai-planner.ts`); §3.3 manual menu-mapping fallback (`menu-extraction.ts`); §3.5 weather-down → `weatherFor` returns `"unknown"`; §4.3 add-on charge failure drops add-ons without touching the coffee (`chargeAddOns`); §4.4 charged-then-undelivered auto-refund (`refund.ts`); §4.5/§10.1–10.3 Stripe/courier/cron idempotency; §4.7 vendor-not-Connect-onboarded → payout held + retried (`payout.ts` `vendor_not_connect_ready`); §5.1–5.4/§5.7 AU courier fallback chain + `dasher_dropped_off_with_issue` mapping (`courier/index.ts`, `courier/status.ts`); §6.1 vendor-status notices (`vendor/page.tsx`); §8.1 advisory overlap notice; §8.2 remember-my-choice (already stored as **`User.overlapRule`**, not a separate `MemberOverlapPreference` collection — keep the existing field, treat the doc's model name as descriptive only); §8.3 no-company-card skip; §11.2 cross-portal role redirects. The night-before reminder already surfaces a reassigned vendor (§2.1).

- **O.1 — Cold-start / empty-marketplace (`fallbacks.md` §1). ✅ DONE.** Net-new. Built: `LaunchWaitlist` model/collection/indexes; `hasAreaCoverage` (pure coverage-gap test) + `vendorCoversWaitlistEntry`/`recordWaitlistEntry`/`matchWaitlistForVendor`/`hasCoverageForAnyPoint` in `src/lib/launch-waitlist.ts`; generation records a waitlist entry only on a true coverage gap (transient all-busy days fall through to O.2); vendor approval runs the idempotent match-and-email job; dashboard cold-start banner + sample slot (live coverage check, correct on day one); admin prominent seed-taxonomy banner + "No orders yet today" routing-health state. Onboarding step-3 already falls back to `DEFAULT_DRINK_OPTIONS` (kept — better than a blocking "setup in progress" message). The O.1/§2.2 coverage-gap branch (the ⚠ below) is in place; the §2.2 transient retry path itself is O.2.
  - Add **`LaunchWaitlist { userId, address, lat, lng, market, createdAt, notifiedAt? }`** collection (+ model, `externalId`/`tenantId` per rule #14). When personal order-generation finds **no vendor whose service area covers the address at all** (true coverage gap, not a transient all-busy day), skip silently and **upsert a waitlist record** instead of pushing a failure (§1.1/§1.2). When a vendor is approved `active`, run a **one-shot match-and-email job** against the waitlist (idempotent via `notifiedAt`; never email the same user twice for the same vendor).
  - Dashboard: location-aware launching-soon banner + sample-illustration upcoming slot for waitlisted users (§1.1/§1.2). Admin: prominent **"Seed taxonomy"** action and subscriber onboarding step-3 "platform setup in progress" state when taxonomy is unseeded (§1.4 — not currently present). Admin zero-data: hide (not empty-box) the failures panel and show "No orders yet today" instead of divide-by-zero in routing health (§1.5).
  - ⚠ **Reconcile §1 with §2.2 (the one real design tension).** §1 wants *silent skip + waitlist* for a **coverage gap**; §2.2 wants *scheduled order + retry + fail-and-notify* for a **transient** no-vendor day. These must branch on "does any vendor's service area cover this address, ever?" — otherwise waitlisted cold-start users get spammed with `no_vendor_available` failure notifications. Implement the coverage-gap check first; §2.2 applies only when coverage exists.
- **O.2 — Routing no-vendor lifecycle (`fallbacks.md` §2.2, §2.5).** ⚠ **Behavior change — confirm under rule #11.** Today `generateOrdersForDate` **skips silently** when `selectVendor` returns `no_vendor_available` (no order row). §2.2 instead wants the order persisted `scheduled` with `vendorId = null`, retried each nightly pass, marked `failed` + user-notified **at its own cutoff** if still unrouted, and **escalated to the admin failures panel after 3 consecutive `no_vendor_available` days** (coverage-gap signal). This is the correct, more observable behavior but it changes what generation writes — build it behind the O.1 coverage-gap branch (gap → waitlist/skip; transient → null-vendor scheduled). Also add §2.5: a vendor going offline **after charge, before delivery** attempts reassignment at the **snapshotted price** (platform absorbs the rate delta, rule #6), and only if no reassignment is possible falls through to the existing auto-refund.
- **O.3 — Charge-retry cadence (`fallbacks.md` §4.1, §4.2).** ⚠ **Infra decision — confirm under rule #11 + #12.** `fallbacks.md` and CLAUDE rule #3/#11 specify **"3× over ~10 min (≈ 0, 3, 10 min)"** for both personal and company-card charges; the current code (`charge.ts`) is **retry-*once* in-process, then skip**. A literal "0/3/10 min" schedule cannot run inside one cutoff invocation (`maxDuration` is 300 s = 5 min) and the Hobby plan allows only daily cron. So this needs a chosen mechanism — a short **retry cron** (e.g. a `charge_retry` sweep over `chargeStatus: "retrying"` orders with `nextRetryAt`/`chargeAttempts` fields) is the additive option, but it adds a cron (rule #12) and only works on Pro. **Until decided, document the current retry-once behavior as the interim and do not silently claim 3×.** Everything else in §4 (idempotent keys, subscription-stays-active, company-card multi-person blast-radius notify to owner) is already in place — keep it.
- **O.4 — Stuck-delivery sweeper & live-tracker degradation (`fallbacks.md` §5.5, §5.6).** Net-new. Add a background sweeper (cron or piggy-backed on an existing sweep) that finds deliveries stuck in `assigned`/`picked_up` for **>2× expected duration** and surfaces them in the admin "Failures today" panel with a **Resolve delivery** action (re-dispatch / mark delivered / mark failed) — §5.6, when a courier webhook never arrives. Tracker: when driver location is **>60 s stale**, show the courier's own "Open in {provider} tracker" link as a fallback while continuing to poll (§5.5; `trackingUrl` is already plumbed — gate it on staleness, and apply the same non-map fallback when Maps JS fails, §12.4). All-couriers-fail-at-dispatch already routes to refund (§5.2) — add the admin re-dispatch entry point.
- **O.5 — Per-panel render resilience (`fallbacks.md` §13).** Net-new (only a single `global-error.tsx` exists today). Wrap each dashboard/admin panel (`upcoming-order`, `delivery-tracker`, `health-card`, admin stat tiles/tables, etc.) in its **own error boundary** so one failed panel shows a compact "couldn't load — refresh" tile while the rest render (§13.1/§13.2). Add neutral image placeholders (logo initials, coffee glyph, generic driver avatar) so a broken image never blocks surrounding UI (§13.3). Add a Next.js route-level `error.tsx`/`loading.tsx` per major segment.
- **O.6 — Corporate, auth, geo & webhook tail (`fallbacks.md` §8.4, §8.8, §11.1/§11.3, §12, §9).** Mostly small gap-fills: owner setup-checklist + bundle-mode-no-drink skip copy (§8.4/§8.8 — the generation skips already exist, this is the owner-facing surfacing); Auth0-no-role → default `individual` to onboarding (§11.1) and Auth0-down sign-in message with cached sessions still working (§11.3); geocoding-failure flags for vendor (§12.1) and subscriber (§12.2) addresses with manual-pin / `unverified` fallback, and "use my location" → manual entry (§12.3); and the outbound-webhook retry/backoff + `delivery_failed` terminal state (§9.1) — note §9.2 (the `*/5` sweep cron) is already a documented Go-Live TODO, leave it there.
- **Build with tests** (failure-case alongside happy-path, per the `fallbacks.md` acceptance summary) especially for O.1 (waitlist match idempotency), O.2 (coverage-gap vs transient branch; 3-consecutive escalation), and O.4 (stuck-delivery detection threshold).
- **Deliverable:** every `fallbacks.md` entry is either verified by a characterization test (already-built items) or implemented with its failure-case test (net-new items), with the three ⚠ decisions (O.1/O.2 coverage-gap branch, O.3 retry cadence, O.2 routing behavior change) resolved under rules #11/#12 before their code lands. No regression to any happy path.

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
11. **Confirm with me before hardcoding** commission rates, capacity defaults, routing weightings, or cutoff times — business decisions. *(Settled so far: failed-charge retry = 3 retries over ~10 min, then skip-and-notify, personal and corporate alike; corporate defaults = `individual` / self-select on / decline on.)*
12. Don't swap or add infrastructure without asking.
13. **Phase I work is additive and behavior-preserving.** The service-extraction refactor must not change any user-facing behavior; the `/v1` API and webhooks are layered on top and must never degrade or remove an existing frontend feature. If a Phase I change would alter behavior, stop and confirm with me first.
14. **`externalId` and `tenantId` are schema reservations.** Always generate `externalId` on create and expose it (not `_id`) at the API boundary. Always set `tenantId` to the default constant, but **do not build any multi-tenant logic** until a future phase explicitly calls for it.
15. **Don't over-build for a hypothetical integrator/acquirer.** Build only what also improves the platform today (clean boundaries, stable IDs, a real API, events). No speculative acquirer-specific shims, adapters, or data-export pipelines until there's a concrete need.
16. **Corporate membership never overrides a personal account.** Joining or leaving a company must not change a user's personal `role`, personal subscription, or personal preferences. Membership is a relationship (`CorporateMembership`), not a role mutation. One user can simultaneously be a personal subscriber and an office member, and the two must work together.
17. **Personal and office coffee are distinct order sources with strictly separate cards.** Orders are unique per (userId, date, source), not (userId, date). **Personal coffee charges the member's own card; office coffee charges the company card** — never cross-charge in either direction, under any circumstance. There are **no seats**: the company is billed per delivered office coffee (charge-then-deliver). Because the two sources bill different cards, both can occur on the same day with no billing conflict; any same-day overlap notice is **advisory and non-blocking** (default keep both, optional remember-my-choice) — never a mandatory daily prompt, which would break the "user does nothing daily" promise. A company-card failure must never affect anyone's personal coffee.
18. **Owner autonomy toggles are server-authoritative.** `selectionMode` (bundle/individual), `memberSelfSelect`, and `memberCanDecline` are enforced on the server for every member order action — not just shown/hidden in the UI. Bundle and owner-set selections still snapshot at generation (rule #6); members may edit only when self-select is enabled.
19. **"Vendor Pack" ≠ "bundle selection mode."** A Vendor Pack is a vendor-priced discounted product (`VendorPromotion type=pack`). `selectionMode = bundle` is a Phase J office setting (owner picks one drink for everyone). Keep the two concepts and their names distinct in code and copy.
20. **Vendor Packs are vendor-pinned and opt out of taxonomy reroute (the sanctioned exception to rule #5).** A Pack order does not auto-reroute to another vendor; if the pack's vendor is offline, skip/refund that day's pack and notify the admin. This exception applies **only** to Packs, must be explicit, and never silent. All non-pack orders remain taxonomy-portable per rule #5.
21. **Promotions are optional savings, never forced comparison shopping.** The team admin's default flow stays one-tap "buy the usual"; packs/campaigns surface as optional nudges. Platform-suggested campaigns (K.3) are suggestions only — the vendor always decides; the platform never changes a vendor's prices on its own.
22. **A consolidated `DeliveryRun` groups orders for delivery only; each order is still made and paid per-vendor, delivery-gated, and confirmed individually.** Partial failure refunds exactly the missing order(s) and pays the rest. A run is mutually exclusive with a Pack on the same delivery. Multi-stop courier capability is an external dependency — never fake consolidation with sequential single trips.
23. **Courier adapters are additive and courier-agnostic.** New adapters implement `CourierAdapter` exactly — no exceptions, no interface overloads. A new adapter never touches charging, payout, refund, or state machine logic; it only translates between the provider's API and the neutral `CourierAdapter` types. Courier fee is always a platform cost — never charged to the user and never deducted from vendor payout, regardless of adapter. Provider-specific concerns (auth, idempotency key format, status names, webhook signature headers, token refresh) live entirely inside the adapter file. AU dispatch uses primary-with-auto-fallback (Uber Direct → DoorDash Drive Classic); fallback logic lives in `courier/index.ts`, not inside the adapters themselves.

---

## Build Order Reminder
A → B → C → **D (carefully)** → D.5 → **E (carefully)** → F → G → H → **I (additive, last of the core build)** → **J (corporate team accounts — additive; coexists with personal accounts)** → **K (vendor promotions / packs — additive)** → **M (Perth courier adapters — additive; gated on API access approval and AU sandbox enablement)** → **L (multi-vendor consolidated delivery — PARKED; gated on courier multi-stop validation)** → **N (subscriber UI enhancement — additive; look-and-feel only, no behavior change)** → **O (graceful degradation & fallbacks — additive hardening; verify what's built, implement the gaps, resolve 3 flagged ⚠ decisions first)**.

> **Current direction (as of 2026-06):** J and K are complete. **L.1 + L.2 (the software foundation) are now built** — the `DeliveryRun` model, per-vendor pickup-stop grouping, run-composition guards (rule #22 — ≥2 orders, no Pack orders, one shared drop), and the per-order-derived run-status rollup are in place and unit-tested, with single-vendor delivery unaffected (the run is optional). **L.3 (multi-stop courier dispatch) and L.4 (hot-coffee logistics rules) remain parked** — L.3 is gated on multi-stop courier capability that has not been validated (no current adapter supports it; `courierRunId` is reserved but unpopulated), and L.4 needs product decisions (max hold time, prep staggering, late-café policy — rule #11) ideally validated by a manual pilot first. Build order is **finish remaining J → K → M; L.1/L.2 done, L.3/L.4 deferred until courier multi-stop is confirmed.** **M is the active phase** and does not depend on L. **Phase O (graceful degradation & fallbacks, from `fallbacks.md`) is the newly-planned next phase** — additive hardening that can proceed in parallel once M lands; ~60% of `fallbacks.md` is already built (verify-with-tests, don't rebuild) and the net-new gaps (launch waitlist, no-vendor lifecycle, charge-retry cadence, stuck-delivery sweeper, per-panel error boundaries) carry **three ⚠ decisions to settle under rules #11/#12 before coding** — see Phase O.

D (routing) and E (charging/payouts) carry almost all the risk. If anything is shaky, it's there. D.5 (monthly list) is what makes "choose once a month" real and feeds scheduled orders into E. **I (service boundary + `/v1` API + webhooks + `externalId`/`tenantId` reservations) is additive and runs only once A–H are stable — it improves the backend without changing the frontend.** **K** adds vendor-priced packs/campaigns for offices (packs first, K.1), surfaced as optional savings. **L** is the differentiator and the hardest — its blocker is courier multi-stop capability, not code; validate logistics with a manual pilot before building the consolidation engine (parked until that capability is confirmed). **M** is additive and can begin in parallel with J–L once API access is provisioned; it does not depend on J, K, or L. AU market L.3 (consolidated delivery in Perth) needs separate multi-stop courier validation — Uber Direct and DoorDash Drive Classic are single-pickup only.

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
- [ ] **Register AU courier webhook URLs before onboarding Perth vendors.**
  In each provider's developer dashboard, register:
  - Uber Direct: `https://[domain]/api/webhooks/courier/uber_direct`
  - DoorDash Drive Classic: `https://[domain]/api/webhooks/courier/doordash_drive`
  Set `UBER_DIRECT_WEBHOOK_SECRET` and `DOORDASH_DRIVE_WEBHOOK_SECRET` in Vercel env vars
  to match the secrets configured in each provider dashboard.
- [ ] **Confirm DoorDash Drive Classic API surface with DoorDash Support** before
  building the DoorDash adapter in detail. AU sandbox requires Support to enable
  per-account; confirm whether the granted surface is Drive Classic or standard Drive,
  as endpoints, auth, and webhook event names may differ.
- [ ] **Apply for Uber Direct and DoorDash Drive production API access** (both are
  gated behind a business account application). Adapters build and test against sandbox;
  `isConfigured()` returns false until production env vars are set, so adapters stay
  dormant in production until access is granted.
