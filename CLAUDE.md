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
- **AI:** Anthropic API (already used for vendor recommendation; also used for menu extraction in Phase C.5). Server-side only; key in `ANTHROPIC_API_KEY`.

### Conventions (carried from v1)
- TypeScript strict. Zod-validate all external input.
- Money in integer minor units (sen), `MYR`.
- Timestamps UTC in DB; convert at edges. Default tz `Asia/Kuala_Lumpur`.
- Server-authoritative: routing, cutoff, payment capture, and payouts are server-only.
- Idempotency keys on all cron-triggered and payment/payout actions. Never double-charge, double-generate, or double-pay.

---

## Data Model Changes

**New entities**
- **Vendor** — businessName, ownerUserId, status (`pending` | `active` | `paused` | `suspended` | `offline`), address, geocoded lat/lng, serviceAreaRadius (or polygon), operatingHours, capacity (daily cap + optional per-slot caps), stripeConnectAccountId, commissionRateOverride (nullable → falls back to platform default), **payoutCadence (`per_order` | `daily_batch`, default `daily_batch`)**, ratingScore, acceptanceRate, onTimeRate.
- **OptionTaxonomy** (platform-level, seeded) — canonical drinks, sizes, milks, add-ons, strength levels. The single source of truth subscriber preferences point to.
- **VendorMenuItem** — vendorId, taxonomyRef, price, availability toggle, optional image. Maps a vendor's offering onto the taxonomy.
- **VendorMenuDraft** (Phase C.5) — vendorId, status (`proposed` | `confirmed`), array of proposal rows produced by AI menu extraction. Each row: `{ rawText, matchedTaxonomyRef | null, proposedPriceSen, confidence }`. This is a **staging area only** — it never feeds routing, charging, or order generation. Rows become real `VendorMenuItem`s only when the vendor confirms and each row is replayed through the existing menu-write validation. Source screenshots are **not** persisted (processed transiently in-request).
- **VendorPayout** — vendorId, period, gross, commission, net, stripeTransferId, status, statement data. Always released **post-delivery**; `payoutCadence` only controls how often held funds are swept to the vendor.
- **CommissionConfig** — platform default rate; per-vendor overrides live on Vendor.
- **Rating** — orderId, userId, vendorId, score, comment → aggregates into Vendor.ratingScore.
- **MonthlyList** — userId, period (month), status (`proposed` | `confirmed`), generationMethod (`ai` | `manual`), array of planned daily entries (date → taxonomy drink spec + assigned vendorId). The confirmed list is the source from which scheduled daily Orders are created.

**Modified entities (scope to vendor)**
- **Order** — add `vendorId`, `monthlyListId`, `assignmentMethod` (`user_preferred` | `ai_routed` | `reassigned`), accept/reject status + window, `commissionAmount`, `vendorNetAmount`, `chargeStatus`, `payoutStatus`, `stripeChargeId`, `stripeTransferId`. Drink spec references taxonomy. State machine: `scheduled → confirmed(charged) → preparing → out_for_delivery → delivered(payout released)` / `failed(refunded)` / `skipped(not charged)`.
- **Preference** — drink/size/milk/etc. reference **OptionTaxonomy**, not hardcoded values. Add `preferredVendorId` (nullable) + `vendorSelectionMethod` (`manual` | `ai`).
- **User/Subscription** — saved Stripe payment method (card validated at signup, not charged upfront). Optional `walletBalance` field reserved for a possible future prepaid model (do not build wallet logic yet).
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

### Phase C.5 — AI-Assisted Menu Onboarding (extends Phase C)
**Goal:** cut vendor onboarding from a manual mapping chore to a quick review. Most vendors already have a menu on Grab/Uber/DoorDash; let them upload a screenshot, have the AI extract items and map each onto the taxonomy, then review/edit/confirm.

**The flow (four steps, strictly in this order):**
1. **Upload + extract (no writes).** Vendor uploads one or more menu screenshots. A server-side, vendor-scoped extraction route sends the image to the Anthropic API and returns proposal rows. The image is **processed transiently and never stored** — only the extracted rows are kept.
2. **Persist as draft.** Rows are saved to a `VendorMenuDraft` (`status: proposed`) so review is resumable — the vendor can leave and come back. Persisting the draft is **not** publishing; nothing is live or routable yet.
3. **Review + edit.** Vendor reviews proposals in the existing menu-management UI. Rows the AI couldn't confidently map (`matchedTaxonomyRef: null`) are flagged "needs your input." Vendor fixes drinks, prices, mappings.
4. **Confirm → publish.** On confirm, **each row is replayed through the exact same validation as a manual menu edit** (the existing `PUT /api/vendor/menu` path: active-slug check, size/strength reject, price-when-available, `priceSen` bounds). Only rows that pass become real `VendorMenuItem`s. The draft is marked `confirmed`. A batch write endpoint is acceptable **only if** it calls that same validation — never fork it.

**Implementation notes:**
- New extraction lib lives alongside `vendor-recommender.ts`, reusing `new Anthropic()` + `messages.create` with an image block and structured (`json_schema`) output. Proposal row shape: `{ rawText, matchedTaxonomyRef | null, proposedPriceSen, confidence }`.
- The `confidence` field is **advisory display only** — surfaced to the vendor so they know what to scrutinize. It is **never** used to auto-accept a row (see Rule 16).
- No image storage. Do **not** add `@vercel/blob` for this feature; process the screenshot within the extraction request and discard it.
- This feature touches **menu data only.** It must not read from or write to routing, cutoff, charging, payout, or order-generation paths.

- **Deliverable:** a vendor uploads a menu screenshot, the AI proposes a taxonomy-mapped menu, and after the vendor reviews and confirms, a validated menu is published — with manual mapping always available as the fallback.

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

**User charging model — per-day auto-charge (NOT monthly upfront).**
The user's pain point is choosing/approving daily, not being charged daily. Per-day charging is invisible to the user and avoids the refund/reconciliation mess of charging a variable month upfront.
- At signup: validate + save the card (Stripe SetupIntent / saved payment method). No upfront charge.
- At **each day's cutoff:** charge the user for that one coffee into the **platform balance**, lock the order (`confirmed`/charged). Fully automatic — the user does nothing daily.
- Do **NOT** transfer to the vendor at this point. Funds are held in the platform balance.
- Optionally surface a **monthly statement/summary** for the "one monthly payment" feel — without actually charging upfront.
- Do **not** offer the user a daily-vs-monthly charge toggle. If true prepaid is ever wanted, implement it as a **prepaid wallet** (top up → daily orders draw down → rollover/refund), never direct full-month card charges with mid-month adjustments. Deferred for now.

**Money mechanism — separate charges and transfers (the "hold then release").**
- Charge the user into the platform balance at cutoff (above).
- Create the Stripe **transfer** to the vendor's connected account **only after delivery is confirmed**, net of commission.
- This holds the vendor's share until the day's coffee is delivered — the Grab/Uber model. Use separate charges and transfers, not card auth holds (card authorizations expire in ~7 days and don't fit daily recurring orders).

**Vendor payout cadence — vendor's choice.**
- Vendors choose `payoutCadence` in their portal: `per_order` (transfer per completed delivery) or `daily_batch` (sweep the day's held, delivered funds once). Default `daily_batch` (fewer transfers, lower fees for the platform).
- Cadence only changes *how often held funds are swept*, never *whether* payout is delivery-gated. No delivery → no payout, regardless of cadence.
- Do not auto-assign cadence by vendor size/popularity — let vendors choose. Tiering can come later if real demand appears.

**Connect, commission, refunds.**
- Onboard vendors as Stripe **connected accounts** (Stripe handles KYC/bank — never store payout details).
- Commission: platform default + per-vendor override, retained on transfer.
- Vendor earnings view, statements, payout history.
- **Refund / no-show handling:** delivery fails → no transfer; refund or credit the user for that day. Delivered then disputed → refund user and **reverse the transfer** from the vendor (Stripe transfer reversal).
- Verify all webhooks with signing secret; handle duplicate/out-of-order events idempotently.

**Edge cases to design now:**
- Vendor goes offline for days a user pre-assigned → routing reassigns; charge/payout follow the new vendor; notify user.
- User edits a day after confirming → cancel that scheduled order, regenerate; no charge until its own cutoff.
- User joins mid-month → list + charging start from join date.
- Failed card at daily cutoff → decide policy (retry / skip-and-notify / pause).

- **Deliverable:** per-day auto-charge at cutoff into platform balance; vendor paid (per-order or batched, their choice) only after delivery; correct refunds and transfer reversals.

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

1. **Never double-charge, double-generate, double-pay, or double-refund.** Idempotency keys on all cron + charge + transfer + refund actions, keyed per (orderId, action).
2. **Routing, cutoff, charging, payouts, and refunds are server-only.** Clients request; the server decides.
3. **Charge the user per-day at cutoff into the platform balance; never charge the full month upfront.** The user does nothing daily — charging is invisible. Any "monthly" feel is a statement/summary or a future prepaid wallet, never upfront card charges with mid-month adjustments.
4. **Vendor payout is always delivery-gated.** No delivery → no transfer. `payoutCadence` (per_order vs daily_batch) only controls sweep frequency, never whether payout happens. Use separate charges and transfers, not card auth holds.
5. **Subscriber preferences and monthly lists reference the taxonomy, never a single vendor's menu.** Keeps auto-orders portable across vendors and reassignment.
6. **Snapshot vendor, drink spec, and price at order confirmation / list confirmation.** Don't read live menus/preferences after lock.
7. **Vendor selection, the monthly list, AND AI-extracted menus take effect only after the user confirms.** Both AI and manual are editable pre-confirm; never silently change a confirmed selection, list, or menu. AI menu extraction (Phase C.5) writes to a `VendorMenuDraft` only — nothing becomes a live `VendorMenuItem` before the vendor confirms.
8. **My own operation is just Vendor #1.** No special-case branches.
9. **Stripe Connect:** never store vendor bank/KYC data. Reverse transfers correctly on refund/dispute.
10. **Phase A migration must be clean, tested, and reversible.** This is where v1 and v2 data diverge.
11. **Confirm with me before hardcoding** commission rates, capacity defaults, routing weightings, cutoff times, failed-card policy, or AI confidence thresholds / default menu pricing — business decisions.
12. Don't swap or add infrastructure without asking. (Phase C.5 specifically: do **not** add `@vercel/blob` or any image-storage dependency — menu screenshots are processed transiently in-request and discarded.)
13. **AI-extracted menu data must reach `vendorMenuItems` only through the existing menu-write validation.** The AI proposes; the vendor confirms; each confirmed row is replayed through the same Zod validation a manual edit uses. Never fork or bypass that validation, even for a batch endpoint.
14. **Phase C.5 touches menu data only.** It must not read from or write to routing, cutoff, charging, payout, or order-generation. Menu screenshots are never persisted.

---

## Build Order Reminder
A → B → C → **C.5** → **D (carefully)** → D.5 → **E (carefully)** → F → G → H.
D (routing) and E (charging/payouts) carry almost all the risk. If anything is shaky, it's there. D.5 (monthly list) is what makes "choose once a month" real and feeds scheduled orders into E. C.5 (AI menu onboarding) is a low-risk, menu-only convenience that extends C — it is isolated from all money/routing paths and gated behind vendor confirmation.
