# CLAUDE.md — BrewPass AI (v2: Multi-Vendor Marketplace)

This file guides Claude Code for the **v2 marketplace** build on the `v2-marketplace` branch. Read it fully before generating code. Follow the phases in order. Do not skip ahead unless I explicitly say so.

The single-vendor MVP is complete and preserved at tag `v1.0-single-vendor` and on `main`. v2 is **additive + refactor**, not a rewrite. Do not duplicate logic — extend the existing code.

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

---

## Data Model Changes

**New entities**
- **Vendor** — businessName, ownerUserId, status (`pending` | `active` | `paused` | `suspended` | `offline`), address, geocoded lat/lng, serviceAreaRadius (or polygon), operatingHours, capacity (daily cap + optional per-slot caps), stripeConnectAccountId, commissionRateOverride (nullable → falls back to platform default), ratingScore, acceptanceRate, onTimeRate.
- **OptionTaxonomy** (platform-level, seeded) — canonical drinks, sizes, milks, add-ons, strength levels. The single source of truth subscriber preferences point to.
- **VendorMenuItem** — vendorId, taxonomyRef, price, availability toggle, optional image. Maps a vendor's offering onto the taxonomy.
- **VendorPayout** — vendorId, period, gross, commission, net, stripeTransferId, status, statement data.
- **CommissionConfig** — platform default rate; per-vendor overrides live on Vendor.
- **Rating** — orderId, userId, vendorId, score, comment → aggregates into Vendor.ratingScore.

**Modified entities (scope to vendor)**
- **Order** — add `vendorId`, `assignmentMethod` (`user_preferred` | `ai_routed` | `reassigned`), accept/reject status + window, `commissionAmount`, `vendorNetAmount`. Drink spec now references taxonomy.
- **Preference** — drink/size/milk/etc. reference **OptionTaxonomy**, not hardcoded values. Add `preferredVendorId` (nullable) + `vendorSelectionMethod` (`manual` | `ai`).
- **Cafe (v1)** → **fold into Vendor.** Migrate existing café/portal records to Vendor #1.

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

### Phase E — Stripe Connect + Payouts (critical)
- Onboard vendors as Stripe **connected accounts** (Stripe handles KYC/bank — do not store payout details).
- Split payment per order: subscriber charged → platform commission retained → vendor net transferred.
- Commission config: platform default + per-vendor override.
- Payout scheduling, vendor earnings view, statements, payout history.
- Refund/chargeback routing (reverse transfers correctly).
- Verify all webhooks with signing secret; handle duplicate/out-of-order events idempotently.
- **Deliverable:** money flows correctly from subscriber → platform + vendor, with statements and refunds.

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

---

## Critical Rules for Claude Code

1. **Never double-charge, double-generate, or double-pay.** Idempotency keys on all cron + payment + payout actions.
2. **Routing, cutoff, payment capture, and payouts are server-only.** Clients request; the server decides.
3. **Subscriber preferences reference the taxonomy, never a single vendor's menu.** This keeps auto-orders portable across vendors.
4. **Snapshot vendor, drink spec, and price at order confirmation.** Don't read live menus/preferences after lock.
5. **Vendor selection takes effect only after the user confirms.** AI recommendations and manual picks are both editable pre-confirm; never silently change a confirmed selection.
6. **My own operation is just Vendor #1.** No special-case branches for "the platform's own coffee."
7. **Stripe Connect:** never store vendor bank/KYC data; let Stripe handle it. Reverse transfers correctly on refund.
8. **Phase A migration must be clean, tested, and reversible.** This is where v1 and v2 data diverge.
9. **Confirm with me before hardcoding** commission rates, capacity defaults, routing weightings, or cutoff times — business decisions.
10. Don't swap or add infrastructure without asking.

---

## Build Order Reminder
A → B → C → **D (carefully)** → **E (carefully)** → F → G → H.
D (routing) and E (Connect/payouts) carry almost all the risk. If anything is shaky, it's there.
