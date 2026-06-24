# BrewPass — Screen Inventory

Every screen across the three apps: route, who sees it, purpose, the data it
shows, its important states, and the components it's built from. This is the map
an AI designer should redesign against — **keep these states and data; don't
invent features.**

Routes are Next.js App Router pages under `src/app`. Reusable UI lives in
`src/components`. Auth/role gating is noted per screen.

Legend: 🟢 subscriber · 🟠 vendor · 🔵 admin · ⚪ shared/unauth

---

## ⚪ Shared / entry

### `/` — Landing
- **Purpose:** marketing splash + entry point.
- **Logged out:** "Log in / Sign up" CTA. **Logged in:** "Go to dashboard."
- **Content today:** title "BrewPass", tagline "Your daily coffee, delivered on
  schedule. Subscribe once — we handle the rest."
- **Redesign note:** this is the only true marketing surface. It can carry the
  most personality / hero treatment. Everything else is app chrome.

### `/cafe` — Legacy café portal (deprecated)
- v1 leftover; vendors now use `/vendor`. Low design priority — can redirect.

---

## 🟢 Subscriber app

### `/onboarding` — Step 1: Profile
- **Purpose:** capture name/phone after first login. Step 1 of 3.
- **Components:** `step-indicator`, `profile-form`.
- **States:** new user (empty) vs returning (prefilled). Validation errors.

### `/onboarding/preferences` — Step 2: Your usual
- **Purpose:** define the default drink + weekly schedule.
- **Drink spec (taxonomy-based):** drink (Flat White, Latte, Cappuccino,
  Americano, Long Black, Mocha, Espresso, Cold Brew…), size (Small/Regular/Large),
  milk (Fresh/Oat/Almond/Soy/None), sugar level, strength (Mild/Regular/Strong/Double).
- **Schedule:** days of week (Mon–Sun) + delivery time.
- **Components:** `preferences-form`, `step-indicator`.
- **Key UX:** this is choosing from a **platform taxonomy**, not one café's menu.

### `/onboarding/locations` — Step 3: Locations
- **Purpose:** add delivery addresses (label + address, geocoded).
- **Feature:** "Use my current location" (native geolocation on mobile).
- **Components:** `locations-manager`, `step-indicator`.

### `/dashboard` — Subscriber home (the main screen)
- **Purpose:** the one screen a subscriber lands on. The whole "calm" promise
  lives here. Gated: redirects vendors→`/vendor`; incomplete onboarding→`/onboarding`.
- **Sections (in order):**
  1. **Header** — "Hi, {firstName} ☕", email · role, Log out.
  2. **Subscription strip** — plan name, active/paused, "X of Y coffees left this
     period", Manage link. *Empty state:* "No active plan yet → See plans."
  3. **Upcoming order card** (`upcoming-order`) — tomorrow's (or today's) coffee:
     drink spec, location, status, edit/skip controls (until cutoff), add-ons.
  4. **Live delivery tracker** (`delivery-tracker`) — only when status is
     `out_for_delivery`; map + ETA.
  4b. **Office coffee** (members of a company only): `office-coffee-tracker` —
     a compact "arriving ~9:05 · Flat White · Level 12" view of today's office
     coffee (map optional), shown **alongside** the personal coffee, never
     replacing it. `overlap-notice` — an **advisory, dismissible** banner when a
     member has both a personal and an office coffee the same day, offering a
     one-tap "cancel one" with a remember-my-choice option (default: keep both).
  5. **"Plan your month" promo** → `/dashboard/monthly`.
  6. **Health card** (`health-card`) — opt-in 7-day coffee summary.
  7. **Two-up: "Your usual"** (drink summary + "Choose your vendor →") and
     **"Locations"**.
  8. **Recent orders** — last 5, each with a status pill and a star-rating control
     for delivered ones (`rate-order`).
  9. **Profile** summary + edit.
- **Status pills:** Scheduled, Confirmed, Preparing, On its way, Delivered,
  Skipped, Failed (color-coded: green=delivered, red=failed, neutral=skipped,
  amber=in-progress).
- **Redesign note:** the highest-value screen. Should answer "is my coffee
  sorted?" in one glance, with editing one tap away.

### `/dashboard/vendor` — Choose your vendor (hybrid selection)
- **Purpose:** pick a preferred café manually, OR answer a short questionnaire and
  let AI recommend one. User reviews → can edit → confirms (effective only after
  confirm).
- **Questionnaire priorities:** proximity, price, speed, rating, specific drink.
- **Components:** `vendor-selector`.
- **States:** no selection yet · AI recommendation shown (editable) · manual
  browse · confirmed preferred vendor.

### `/dashboard/monthly` — Monthly list planner (the big subscriber moment)
- **Purpose:** AI proposes a coffee + vendor for **every delivery day** in the
  period; user reviews the whole month, edits any day (swap vendor, change drink,
  skip), then **confirms once** → creates scheduled daily orders.
- **Components:** `monthly-list-planner`.
- **States:** `proposed` (editable) vs `confirmed`. Per-day edit. Skip a day.
  Mid-month join (list starts from join date).
- **Redesign note:** reviewing ~31 days must feel light, not like a spreadsheet.
  Calendar/agenda patterns; batch-confirm with easy per-day overrides.

### `/dashboard/billing` — Billing & plans
- **Purpose:** pick/change plan, manage subscription, saved card (Stripe).
- **Components:** `plan-picker`, `subscription-panel`.
- **Plans shown:** Lite/Weekday/Premium/Student (personal plans) with price +
  quota + description. Student requires verification. **Office coffee is not a
  plan here** — it lives in the separate corporate flow (`/dashboard/corporate`),
  billed per delivery, not per seat.
- **States:** no plan (pick) · active · paused · canceled · student-unverified.

### `/dashboard/corporate` — Office coffee (team account)
- **Purpose:** one screen serving **two independent audiences**: a **member**
  joining/seeing companies, and (if the user owns a company) an **owner**
  dashboard. Billed **per delivered office coffee on one company card — no
  seats**.
- **Member side (always shown):** `join-company-panel` — redeem a **join code**
  to link this account to a company (personal account untouched); list the
  offices the user already belongs to.
- **Owner side (only if the user owns a company):**
  - `corporate-owner-dashboard` — save/replace the **company card** (Stripe
    SetupIntent, no upfront charge); view/share/rotate/revoke **join codes**
    (reusable or single-use, optional redemption cap); set **office defaults**
    (drink/schedule/location); **autonomy toggles** (`selectionMode`
    bundle/individual, `memberSelfSelect`, `memberCanDecline` — server-enforced);
    and a **member roster** (joined?, office coffee set?, today's/tomorrow's
    selection, want vs skip, delivery status; owner can set the bundle drink and,
    where allowed, toggle want/skip on a member's behalf).
  - `office-pack-panel` — buy a vendor **pack** (+ individual top-ups) for the
    team and assign members (Phase K); optional savings, never forced.
  - If the user owns no company: a "Run coffee for your team" CTA
    (`corporate-panel` → create account).
- **States:** not-a-member/not-an-owner (CTAs only) · member of N companies ·
  owner with/without company card · card saved / card setup canceled (banner) ·
  bundle vs individual selection mode.
- **Redesign note:** keep the **member** and **owner** halves clearly separated,
  and make the no-seats, pay-per-delivery model legible. This replaced the old
  per-seat corporate dashboard.

---

## 🟠 Vendor portal

All `/vendor/*` screens are gated to vendor-linked accounts and branch on vendor
**status**: `pending` (under review), `rejected`, `active`/`paused`/`offline`
(operational), `suspended`. Non-operational statuses render a full-screen
**Notice** instead of the portal.

### `/vendor/apply` — Vendor application
- **Purpose:** a coffee business applies to join. Captures business info,
  location, operating hours, capacity → status `pending`.
- **Components:** `vendor-apply-form`, `operating-hours-field`.

### `/vendor` — Fulfillment board (vendor home)
- **Purpose:** the working screen during a shift.
- **Header:** business name + status chip ("accepting orders"/paused/offline),
  "Today's queue · {date}", "{n} orders scheduled for tomorrow (locks 6:00 AM)",
  and nav: Menu · Capacity · Earnings · Promotions · Profile & hours · Log out.
- **Quality strip** (`VendorQualityStrip`): rating (★ + count), acceptance %,
  on-time %. Red banner if auto-suspended by quality review.
- **Today's board** (`vendor-board`): each confirmed order = customer name, drink
  spec, deliver-by time, and delivery state (provider/rider/tracking) with status
  controls (preparing → out for delivery → delivered) and a decline action.
- **Tomorrow's upcoming** (`vendor-upcoming`): scheduled orders that lock at cutoff.
- **Redesign note:** glanceability under counter lighting. Big targets, clear
  "what's next," obvious delivery status. This is the densest *task* screen.

### `/vendor/menu` — Menu management
- **Purpose:** map the vendor's offerings onto the platform taxonomy; set price,
  availability toggle, optional image per item.
- **Feature:** AI menu extraction — upload a menu, it drafts items to confirm
  (`vendor-menu-onboarding`, `/api/vendor/menu/extract` + draft/confirm).
- **Components:** `vendor-menu-manager`, `vendor-menu-onboarding`.

### `/vendor/capacity` — Capacity & availability
- **Purpose:** daily order cap, per-item "sold out today" toggles, order-accepting
  cutoff. Feeds routing availability.
- **Components:** `vendor-capacity`.

### `/vendor/earnings` — Earnings & payouts
- **Purpose:** earnings view, statements, payout history; choose **payout cadence**
  (`per_order` vs `daily_batch`); Stripe Connect onboarding/status.
- **Components:** `vendor-earnings`.
- **Key UX:** payouts are **delivery-gated** — distinguish held vs released funds.
  Show commission retained. Never imply instant payout.

### `/vendor/promotions` — Promotions (Phase K)
- **Purpose:** create/manage time-boxed campaigns (`VendorPromotion`): **packs**
  (`packSize` + vendor-set `packPrice`; `fixed_drink` = same coffee ×N, or
  `buyer_choice` = buyer picks `packSize` drinks, count locked), **buy-N-get-M**,
  and **time-window discounts** (e.g. 50% off 2–4pm). Each carries a validity
  window and status (`draft`/`active`/`paused`/`expired`).
- **Feature:** **platform-suggested campaigns** — the dashboard analyses the
  vendor's own order data and *suggests* promotions ("Tuesday afternoons are your
  quietest…"). Suggestions only; the vendor always decides.
- **Components:** `vendor-pack-manager`.
- **Key UX:** packs are **vendor-pinned** (an office that buys one is not
  rerouted to another vendor) — make the "your priced product" framing clear.

### `/vendor/profile` — Profile & hours
- **Purpose:** business profile, operating hours, service-area (radius/polygon via
  Maps), status controls (go offline/paused/active).
- **Components:** `vendor-profile-form`, `operating-hours-field`.

---

## 🔵 Admin / operator dashboard

### `/admin` — Operations (single dense page)
- **Gating:** operator accounts only; others see an "no operator access" notice.
- **Header:** "Operations", date · signed-in email, setup/migration buttons
  (`AdminSetupButton`, `AdminMigrateButton`, `AdminSeedTaxonomyButton`), Log out.
- **Stat tiles (6):** Orders today, Confirmed, Delivered, Failed, Active
  subscriptions, Vendor applications, Users.
- **Failures today** — red panel listing failed orders + reasons (only if any).
- **Routing health** — reassignment rate (n/total), failure-reason breakdown,
  quality-suspended vendors.
- **Commission** — default rate + code default (`CommissionPanel`).
- **Today's orders** (`AdminOrdersTable`) — customer, drink, location, vendor,
  status, deliver time, charge/payout status; manual reassign to an active vendor.
- **Vendors** (`AdminVendors`) — name, address, capacity, status, staff, today's
  load, rating/acceptance/on-time, commission override; approve/reject/suspend.
- **Users** (`AdminUsers`, latest 100) — name, email, role, student-verified.
- **Components:** `admin-panels` (tables/panels), `admin-setup-button`.
- **Redesign note:** a control room. Prioritize scanning and triage: failures and
  routing health should jump out; tables need good density, sorting, and clear
  status semantics. Desktop-first.

---

## Backend-only surfaces (no UI to design — Phase I)

For completeness, two Phase I additions have **no screens** and need no design:

- **Versioned `/v1` API** (`/api/v1/*`) — a thin, authenticated HTTP layer over
  the domain services that exposes the stable `externalId` (never raw `_id`).
  Consumed by integrations, not the BrewPass UI.
- **Outbound webhooks** — signed lifecycle events (`order.scheduled`,
  `vendor.assigned`, `order.confirmed`, `order.delivered`, `order.failed`,
  `payout.released`, `refund.issued`) delivered to registered subscribers.
  Subscriptions are managed **via admin API only** (`/api/admin/webhooks`) —
  there is no admin screen for them yet, so a redesign can ignore them.

## Cross-app component library (current)

These are the existing building blocks; a redesign should produce a coherent
component set covering all of them.

| Component | Used in | Role |
| --------- | ------- | ---- |
| `step-indicator` | onboarding | 3-step progress |
| `profile-form`, `preferences-form`, `locations-manager` | onboarding | core capture forms |
| `plan-picker`, `subscription-panel` | billing | plan selection + subscription state |
| `upcoming-order` | dashboard | the daily coffee card + edit/skip |
| `delivery-tracker` | dashboard | live map/ETA when out for delivery |
| `health-card` | dashboard | opt-in consumption summary |
| `rate-order` | dashboard | post-delivery star rating |
| `vendor-selector` | choose-vendor | manual + AI hybrid selection |
| `monthly-list-planner` | monthly | whole-month plan/review/confirm |
| `office-coffee-tracker` | dashboard | compact office-coffee ETA/status for members |
| `overlap-notice` | dashboard | advisory same-day personal/office overlap banner |
| `corporate-panel` | corporate | create-company CTA (legacy seat UI superseded) |
| `join-company-panel` | corporate | redeem a join code · list joined offices |
| `corporate-owner-dashboard` | corporate | company card · join codes · office defaults · autonomy toggles · member roster |
| `office-pack-panel` | corporate | buy a vendor pack + top-ups, assign members |
| `vendor-pack-manager` | vendor promotions | create/manage packs, bundles, time-window discounts + suggestions |
| `vendor-apply-form`, `operating-hours-field` | vendor apply/profile | application + hours |
| `vendor-board`, `vendor-upcoming` | vendor home | today's fulfillment + tomorrow |
| `vendor-menu-manager`, `vendor-menu-onboarding` | vendor menu | taxonomy mapping + AI extract |
| `vendor-capacity` | vendor capacity | caps + sold-out + cutoff |
| `vendor-earnings` | vendor earnings | payouts, cadence, Connect |
| `vendor-profile-form` | vendor profile | profile/hours/service area |
| `admin-panels` (tables/panels), `admin-setup-button` | admin | operator tables + actions |
| `native-bridge` | root layout | Capacitor push/deep-link glue (no UI) |

## Common states every screen should design for

- **Loading** (server-rendered, but data-heavy panels benefit from skeletons).
- **Empty** (no plan, no orders, no vendors, no menu items, fresh account).
- **Error / failure** (failed charge, failed delivery, rejected application).
- **Gated / wrong-role** (non-vendor on `/vendor`, non-admin on `/admin`).
- **Pending / locked** (application under review; order past cutoff = read-only).
- **Success / confirmed** (monthly list confirmed; vendor selected; payout released).
</content>
