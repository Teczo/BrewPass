# CLAUDE.md — BrewPass AI (v2.1: Multi-Vendor Marketplace + Courier Delivery)

This file guides Claude Code for the **v2 marketplace** build on the `v2-marketplace` branch. Read it fully before generating code. Follow the phases in order. Do not skip ahead unless I explicitly say so.

The single-vendor MVP is complete and preserved at tag `v1.0-single-vendor` and on `main`. v2 is **additive + refactor**, not a rewrite. Do not duplicate logic — extend the existing code.

> **v2.1 update (this revision):** adds **courier-integrated delivery** (Phase E.5) and the **delivery-inclusive pricing model**. Delivery was previously a manual, vendor-driven stub (free-text rider name, human "mark delivered" button). It is now a first-class, courier-dispatched, webhook-gated step. Everything below about routing, charging, payouts, and idempotency still holds — delivery integration plugs into the **existing** `Delivery` state machine, it does not replace it.

---

## What's Changing (v1 → v2)

v1: I make all the coffee. Everything implicitly belongs to me.

v2: The app is a **marketplace** between existing coffee businesses (vendors) and subscribers who want a customized coffee every day. I become the platform operator. My own coffee operation becomes **Vendor #1** — no special-casing; I am just the first vendor.

The highest-risk, highest-complexity additions are:
1. **Order routing engine** — deciding which vendor fulfills each subscriber's daily order.
2. **Stripe Connect + payouts** — split payments between platform and vendors.
3. **Courier-integrated delivery (v2.1)** — dispatching a real courier and letting the courier's delivery confirmation, not a human button, gate payout. This touches money flow, so treat it with the same care as routing and payouts.

Everything else is comparatively mechanical. Treat those three with extra care and tests.

---

## Product Decisions (locked)

1. **Menu model: standardized platform taxonomy.** The platform defines the canonical option set (drinks, sizes, milks, add-ons, strength). Vendors map their offerings onto this taxonomy and set their own prices/availability. Subscriber preferences reference the **taxonomy**, never a single vendor's menu — this is what makes auto-orders portable when a subscriber is routed to a different vendor.

2. **Vendor selection: hybrid.** For each subscriber:
   - They can **pick a preferred vendor** manually, OR
   - The **AI assistant** recommends a vendor based on a short questionnaire (e.g. priorities: proximity, price, speed, rating, specific drink quality).
   - The user reviews the selection, **can edit it**, then confirms. Only after confirmation does it take effect.
   - A confirmed preferred vendor is used by routing when available; platform auto-routing is the fallback when that vendor is full/offline/out of area/can't make the drink.

3. **Delivery model: platform-integrated courier, baked into plan price (v2.1).** The product is **convenience**, not low price. The subscriber pays once (card on file), plans drinks once a week, and never browses, books, or pays for delivery separately. Therefore:
   - **Delivery is dispatched by the platform via a third-party courier** (Lalamove first, Grab as a second adapter). The subscriber never leaves the app to arrange or track delivery.
   - **The delivery fee is absorbed into the plan price** — there is no separate, user-visible delivery charge, and no per-order delivery line item to the subscriber.
   - **Tracking is in-app.** The user sees status/driver location inside BrewPass, not on the courier's own app/site.

4. **Pricing model: delivery-inclusive, margin-protected (v2.1).** Because delivery is baked in, every kilometre of service radius is a platform cost, not a user cost. Plan prices are set so that, per delivered coffee: `plan revenue per coffee ≥ negotiated vendor coffee cost + courier fee + payment fees + target margin`. Radius is a **primary cost control**, not just an eligibility filter; proximity-first routing protects unit economics. **Vendor coffee cost is a negotiated marketplace rate** (below the vendor's retail price) in exchange for guaranteed daily volume — not necessarily the vendor's public menu price. Confirm exact plan prices, target margin, vendor rate, and assumed courier fee with me before hardcoding any of them.

---

## Tech Stack (unchanged from v1 unless noted)

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind.
- **Mobile:** Capacitor (same web build).
- **Hosting:** Vercel (serverless + Vercel Cron).
- **DB:** MongoDB Atlas.
- **Auth:** Auth0 (now with vendor + admin roles).
- **Payments:** Stripe — **add Stripe Connect** for vendor payouts.
- **Courier (v2.1):** **Lalamove API** (primary, v3 — open developer portal, self-serve key, official Node.js client library). **Grab / GrabExpress** as a second adapter (GrabPlatform; access is partnership-gated, onboard later). Both behind a single courier abstraction — see Phase E.5.
- **Push:** Firebase Cloud Messaging.
- **Maps/geocoding:** Google Maps Platform (vendor service-area + routing distance; also used to render in-app delivery tracking).
- **SMS:** Twilio.
- **Email:** Resend.
- **Storage:** Vercel Blob (vendor logos, menu images).
- **Monitoring:** Sentry.

### Conventions (carried from v1)
- TypeScript strict. Zod-validate all external input.
- Money in integer minor units (sen), `MYR`.
- Timestamps UTC in DB; convert at edges. Default tz `Asia/Kuala_Lumpur`.
- Server-authoritative: routing, cutoff, payment capture, payouts, **and courier dispatch** are server-only.
- Idempotency keys on all cron-triggered and payment/payout/**courier-dispatch** actions. Never double-charge, double-generate, double-pay, **or double-dispatch**.

---

## Data Model Changes

**New entities**
- **Vendor** — businessName, ownerUserId, status (`pending` | `active` | `paused` | `suspended` | `offline`), address, geocoded lat/lng, serviceAreaRadius (or polygon), operatingHours, capacity (daily cap + optional per-slot caps), stripeConnectAccountId, commissionRateOverride (nullable → falls back to platform default), **negotiatedCoffeeRate (nullable → vendor's marketplace coffee cost; see pricing model)**, **payoutCadence (`per_order` | `daily_batch`, default `daily_batch`)**, ratingScore, acceptanceRate, onTimeRate.
- **OptionTaxonomy** (platform-level, seeded) — canonical drinks, sizes, milks, add-ons, strength levels. The single source of truth subscriber preferences point to.
- **VendorMenuItem** — vendorId, taxonomyRef, price, availability toggle, optional image. Maps a vendor's offering onto the taxonomy.
- **VendorPayout** — vendorId, period, gross, commission, net, stripeTransferId, status, statement data. Always released **post-delivery**; `payoutCadence` only controls how often held funds are swept to the vendor.
- **CommissionConfig** — platform default rate; per-vendor overrides live on Vendor.
- **Rating** — orderId, userId, vendorId, score, comment → aggregates into Vendor.ratingScore.
- **MonthlyList** — userId, period (month), status (`proposed` | `confirmed`), generationMethod (`ai` | `manual`), array of planned daily entries (date → taxonomy drink spec + assigned vendorId). The confirmed list is the source from which scheduled daily Orders are created.

**Modified entities (scope to vendor)**
- **Order** — add `vendorId`, `monthlyListId`, `assignmentMethod` (`user_preferred` | `ai_routed` | `reassigned`), accept/reject status + window, `commissionAmount`, `vendorNetAmount`, `chargeStatus`, `payoutStatus`, `stripeChargeId`, `stripeTransferId`. Drink spec references taxonomy. State machine: `scheduled → confirmed(charged) → preparing → out_for_delivery → delivered(payout released)` / `failed(refunded)` / `skipped(not charged)`.
- **Delivery (modified for v2.1)** — one record per order, unique on `orderId`. Existing fields: status `pending → assigned → picked_up → delivered → failed`, `assignedAt`/`pickedUpAt`/`deliveredAt`/`failureReason`. **Add courier fields:** `courierProvider` (`lalamove` | `grab` | `manual`), `courierOrderId` (the provider's order/delivery ref), `courierQuotationId`, `courierStatusRaw` (last raw provider status), `trackingUrl` (provider share link), `driverName`/`driverPhone`/`driverPlate` (from provider driver details, nullable), `driverLat`/`driverLng` + `driverLocationUpdatedAt` (for the in-app map), `courierFeeAmount` (sen, what the platform paid the courier — internal, never shown as a user charge). `riderId` is retained for the legacy `manual` path. The `manual` provider keeps the old free-text behaviour as a fallback.
- **Preference** — drink/size/milk/etc. reference **OptionTaxonomy**, not hardcoded values. Add `preferredVendorId` (nullable) + `vendorSelectionMethod` (`manual` | `ai`).
- **User/Subscription** — saved Stripe payment method (card validated at signup, not charged upfront). Optional `walletBalance` field reserved for a possible future prepaid model (do not build wallet logic yet).
- **Cafe (v1)** → **fold into Vendor.** Migrate existing café/portal records to Vendor #1.

**Migration note:** Phase A is where v1 and v2 data diverge. Write it as a clean, tested, reversible migration. After it runs, there is no separate "v1 data" — there is one app with Vendor #1. The v2.1 `Delivery` field additions are backward-compatible: existing/legacy deliveries default to `courierProvider: "manual"`.

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
  - **(v2.1) Radius is a cost control.** Keep per-vendor radius tight (confirm the cap with me — do not reuse v1's 1–100 km vendor-set range without sign-off). Optionally call the courier quotation endpoint at assignment time to estimate delivery cost and reject too-far assignments before they're scheduled.
- Idempotent: one order per (userId, date); safe to re-run jobs.
- **Build with tests before moving on.**
- **Deliverable:** each subscriber gets a vendor-assigned daily order via preferred-or-AI selection, with reassignment fallback.

### Phase D.5 — Monthly List (AI selection → confirm → scheduled orders)
This sits between selection/routing and payments. It is how the user "chooses once a month" (or once a week).
- **AI generates a proposed monthly list:** for each delivery day in the period, propose a drink (taxonomy) + assigned vendor, using the hybrid selection logic from Phase D (preferred vendor where set, AI-routed otherwise).
- **User reviews the full month:** can edit any day (swap vendor, change drink, skip a day), then **confirms** the list.
- **On confirm:** persist as individual **scheduled daily Orders**, one per delivery day, each carrying its `vendorId` and `monthlyListId`. The existing daily generation/cutoff jobs operate on these.
- Users can still edit individual upcoming days after confirming (until that day's cutoff) — reuse the existing modification-window logic.
- **Deliverable:** user confirms one list; the system has a full month of scheduled, vendor-assigned daily orders requiring zero daily interaction.

### Phase E — Stripe Connect, Per-Day Charging & Delivery-Gated Payouts (critical)

**User charging model — per-day auto-charge (NOT monthly upfront).**
The user's pain point is choosing/approving daily, not being charged daily. Per-day charging is invisible to the user and avoids the refund/reconciliation mess of charging a variable month upfront.
- At signup: validate + save the card (Stripe SetupIntent / saved payment method). No upfront charge.
- At **each day's cutoff:** charge the user for that one coffee into the **platform balance**, lock the order (`confirmed`/charged). Fully automatic — the user does nothing daily.
- **(v2.1) The per-coffee charge is the delivery-inclusive plan rate, not a coffee-plus-delivery itemization.** Delivery cost is absorbed by the platform out of the plan revenue; the user never sees a delivery line item. (Add-ons remain the only separately itemized extra.)
- Do **NOT** transfer to the vendor at this point. Funds are held in the platform balance.
- Optionally surface a **monthly statement/summary** for the "one monthly payment" feel — without actually charging upfront.
- Do **not** offer the user a daily-vs-monthly charge toggle. If true prepaid is ever wanted, implement it as a **prepaid wallet** (top up → daily orders draw down → rollover/refund), never direct full-month card charges with mid-month adjustments. Deferred for now.

**Money mechanism — separate charges and transfers (the "hold then release").**
- Charge the user into the platform balance at cutoff (above).
- Create the Stripe **transfer** to the vendor's connected account **only after delivery is confirmed**, net of commission.
- This holds the vendor's share until the day's coffee is delivered — the Grab/Uber model. Use separate charges and transfers, not card auth holds (card authorizations expire in ~7 days and don't fit daily recurring orders).
- **(v2.1) The courier fee is a platform cost, paid to the courier separately from the vendor transfer.** It is deducted from platform margin, never from the vendor's net and never re-charged to the user.

**Vendor payout cadence — vendor's choice.**
- Vendors choose `payoutCadence` in their portal: `per_order` (transfer per completed delivery) or `daily_batch` (sweep the day's held, delivered funds once). Default `daily_batch` (fewer transfers, lower fees for the platform).
- Cadence only changes *how often held funds are swept*, never *whether* payout is delivery-gated. No delivery → no payout, regardless of cadence.
- Do not auto-assign cadence by vendor size/popularity — let vendors choose. Tiering can come later if real demand appears.

**Connect, commission, refunds.**
- Onboard vendors as Stripe **connected accounts** (Stripe handles KYC/bank — never store payout details).
- Commission: platform default + per-vendor override, retained on transfer. Commission is computed against the **vendor's coffee cost / net**, not the delivery-inclusive plan price the user pays.
- Vendor earnings view, statements, payout history.
- **Refund / no-show handling:** delivery fails → no transfer; refund or credit the user for that day. Delivered then disputed → refund user and **reverse the transfer** from the vendor (Stripe transfer reversal). Courier fees already paid on a failed delivery are a platform loss, not clawed back from the vendor.
- Verify all webhooks with signing secret; handle duplicate/out-of-order events idempotently.

**Edge cases to design now:**
- Vendor goes offline for days a user pre-assigned → routing reassigns; charge/payout follow the new vendor; notify user.
- User edits a day after confirming → cancel that scheduled order, regenerate; no charge until its own cutoff.
- User joins mid-month → list + charging start from join date.
- Failed card at daily cutoff → decide policy (retry / skip-and-notify / pause). Confirm with me.

- **Deliverable:** per-day auto-charge at cutoff into platform balance; vendor paid (per-order or batched, their choice) only after delivery; correct refunds and transfer reversals.

### Phase E.5 — Courier-Integrated Delivery & In-App Tracking (critical, v2.1)

This replaces the manual rider stub with real courier dispatch, and makes the **courier's delivery confirmation the event that releases payout**. It plugs into the **existing** `Delivery` state machine and the existing `out_for_delivery → delivered` transition — it does not introduce a parallel flow.

**Courier abstraction (build this first).**
- Define a provider-agnostic interface behind the `Delivery` record, e.g. `CourierAdapter` with: `getQuote(pickup, dropoff, drinkMeta) → { quotationId, feeAmount, expiresAt }`, `dispatch(quotationId, pickup, dropoff, contacts) → { courierOrderId, trackingUrl }`, `getTracking(courierOrderId) → { status, driver, lat, lng }`, `cancel(courierOrderId)`.
- **Lalamove is the first adapter** (v3 API, Node.js client lib). **Grab is a second adapter** behind the same interface, added when GrabPlatform access is granted. The order/payout/quality logic only ever talks to the `Delivery` state machine and the adapter interface — never a provider SDK directly. A future **own-fleet** option (deferred) is just another adapter.
- Per-vendor (or per-order) `courierProvider` selects the adapter; default to the configured platform primary (Lalamove). `manual` remains as a fallback for vendors who self-deliver or when no courier is available.

**Dispatch flow (wired into the existing handoff).**
- On the existing `preparing → out_for_delivery` transition (`POST /api/vendor/orders/[id]/status`), instead of (or in addition to) creating a `pending` `Delivery` with a typed rider name, **call the adapter to dispatch a courier**. Store `courierOrderId`, `courierQuotationId`, `trackingUrl` on the `Delivery`. Keep the insert idempotent on `orderId` so re-clicks/retries never double-dispatch (idempotency key per `(orderId, "dispatch")`).
- **Quotation validity is short (Lalamove ~5 min).** Quote at dispatch time, not just at planning time; if a planning-time quote has expired, re-quote before placing. Handle the price-mismatch/expiry error path explicitly.

**Webhook-driven state (this is the money-gating change).**
- The courier's status webhook drives the `Delivery` and `Order` state machines: provider `PICKED_UP` → `Delivery.picked_up`; provider `COMPLETED`/delivered → `Delivery.delivered` → triggers the **existing** `handleOrderDelivered()` (payout release / quality `recordDelivery()`); provider failure/cancellation → `Delivery.failed` → existing `refundFailedDelivery()`.
- **Verify every courier webhook with its signing secret.** Treat exactly like Stripe webhooks.
- **Webhooks may arrive out of order and are retried** (Lalamove disables the URL after ~10 consecutive failed deliveries of an event). So: sort by the provider's event timestamp, make every handler idempotent per `(orderId, providerStatus)`, never move the state machine backwards, and keep the endpoint reliable.
- The vendor's manual "mark delivered" button remains available **only** for the `manual` provider path; for courier-dispatched orders, delivery confirmation comes from the webhook, not a human click. (Allow an admin manual override for stuck courier orders.)

**In-app tracking.**
- Store `trackingUrl` and the latest `driverLat`/`driverLng`/`driverLocationUpdatedAt` (+ driver name/phone/plate) on the `Delivery`.
- Render tracking **inside BrewPass** — either the provider's embeddable share link or our own Google Map fed by the adapter's driver-location data. The user never leaves the app. Verify the current provider capability for live driver location before committing to the own-map approach; fall back to the share link if live location isn't exposed.

**Pricing / cost wiring.**
- Record `courierFeeAmount` on the `Delivery` for internal margin reporting. It is **never** surfaced to the user as a charge and **never** deducted from the vendor net — it is a platform cost against margin (see pricing model).

**Edge cases to design now:**
- No courier available / dispatch fails at handoff → retry policy, then fall back to `manual` or notify ops; the order must not silently stall.
- Courier cancels mid-delivery → reassign courier (`dispatch` again on the same `Delivery`, new `courierOrderId`) or mark failed → refund; never double-pay the vendor.
- Delivery confirmed by webhook but our `handleOrderDelivered()` side-effects fail → must be safely retryable (idempotent), payout never lost or duplicated.
- Provider webhook for an order we don't recognize / already-terminal order → ignore safely.

- **Deliverable:** orders are dispatched to a real courier at handoff; the courier's verified, idempotent delivery webhook (not a human button) confirms delivery and releases payout; the subscriber tracks the driver in-app; courier fee is recorded as a platform cost.

### Phase F — Capacity & Lightweight Inventory
- Daily order caps + optional per-slot caps per vendor (feeds routing availability).
- "Sold out today" / per-item unavailable toggles.
- Order-accepting cutoff per vendor.
- (Defer true ingredient-level inventory unless vendors request it.)
- **Deliverable:** vendors control load; routing respects capacity and availability.

### Phase G — Ratings, SLAs, Vendor Quality
- Post-delivery rating → aggregate into Vendor.ratingScore.
- Track acceptanceRate + onTimeRate; surface in vendor portal. **(v2.1) On-time is computed from the courier `delivered` webhook timestamp vs `deliverAt` + grace.**
- Feed quality signals into routing tiebreaks; auto-throttle/flag poor performers.
- **Deliverable:** quality scoring that improves routing and flags bad vendors.

### Phase H — Admin Expansion
- Approve/suspend vendors; set commission (default + overrides); **set per-vendor negotiated coffee rate (v2.1).**
- Routing health dashboard (reassignment rate, vendor load, failures). **(v2.1) add courier health: dispatch-failure rate, courier-cancellation rate, average courier fee, average delivery time.**
- Dispute tools, manual order reassignment, manual refunds, **manual courier re-dispatch / mark-delivered override for stuck courier orders (v2.1).**
- **Deliverable:** operator can run the marketplace from the admin portal.

---

## Critical Rules for Claude Code

1. **Never double-charge, double-generate, double-pay, double-refund, or double-dispatch.** Idempotency keys on all cron + charge + transfer + refund + **courier-dispatch** actions, keyed per (orderId, action).
2. **Routing, cutoff, charging, payouts, refunds, and courier dispatch are server-only.** Clients request; the server decides.
3. **Charge the user per-day at cutoff into the platform balance; never charge the full month upfront.** The user does nothing daily — charging is invisible. The per-coffee charge is the **delivery-inclusive plan rate**; the user never sees a separate delivery charge. Any "monthly" feel is a statement/summary or a future prepaid wallet, never upfront card charges with mid-month adjustments.
4. **Vendor payout is always delivery-gated, and delivery is confirmed by the courier webhook (v2.1), not a human button** (except the legacy `manual` provider path). No delivery → no transfer. `payoutCadence` (per_order vs daily_batch) only controls sweep frequency, never whether payout happens. Use separate charges and transfers, not card auth holds.
5. **Courier integration goes behind the `CourierAdapter` abstraction; order/payout/quality logic never calls a provider SDK directly (v2.1).** Lalamove first, Grab second, own-fleet maybe later — all adapters behind one interface. The `Delivery` state machine is the single seam.
6. **Verify and idempotently handle every courier webhook, exactly like Stripe webhooks (v2.1).** Signing secret, out-of-order tolerant (sort by provider timestamp), never move state backwards, keep the endpoint reliable (providers disable failing URLs).
7. **The courier fee is a platform cost (v2.1).** Never charge it to the user as a line item; never deduct it from the vendor net. It comes out of platform margin. Record it on the `Delivery` for reporting only.
8. **Subscriber preferences and monthly lists reference the taxonomy, never a single vendor's menu.** Keeps auto-orders portable across vendors and reassignment.
9. **Snapshot vendor, drink spec, and price at order confirmation / list confirmation.** Don't read live menus/preferences after lock.
10. **Vendor selection and the monthly list take effect only after the user confirms.** Both AI and manual are editable pre-confirm; never silently change a confirmed selection or list.
11. **My own operation is just Vendor #1.** No special-case branches.
12. **Stripe Connect:** never store vendor bank/KYC data. Reverse transfers correctly on refund/dispute. **Courier (v2.1):** never store courier payout/driver bank data; the courier handles its own fleet payments.
13. **Phase A migration must be clean, tested, and reversible.** This is where v1 and v2 data diverge. The v2.1 `Delivery` field additions must default legacy rows to `courierProvider: "manual"`.
14. **Confirm with me before hardcoding** commission rates, capacity defaults, routing weightings, cutoff times, failed-card policy, **plan prices, target margin, negotiated vendor coffee rate, assumed courier fee, the service-radius cap, and the courier dispatch-failure/retry policy** — all business decisions.
15. **Don't swap or add infrastructure without asking.** Lalamove and Grab are new third-party infra approved for v2.1; any *additional* courier or provider beyond these needs sign-off.

---

## Build Order Reminder
A → B → C → **D (carefully)** → D.5 → **E (carefully)** → **E.5 (carefully)** → F → G → H.

D (routing), E (charging/payouts), and **E.5 (courier delivery, v2.1)** carry almost all the risk. E.5 is where delivery confirmation moves from a human button to a verified courier webhook that releases real money — treat its webhook handling with the same rigor as Stripe. D.5 (monthly list) is what makes "choose once" real and feeds scheduled orders into E. Build E before E.5: payouts must be correct and delivery-gated *before* the gating signal becomes an external webhook.
