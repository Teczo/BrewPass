# BrewPass — Complete User Guide

> Your daily coffee, delivered on schedule. Subscribe once — we handle the rest.

BrewPass is a **subscription coffee marketplace**. Subscribers tell us their "usual"
coffee once; every working day a customized coffee is made by a local coffee
business and delivered to them at their chosen place and time. The night before,
they're reminded and can tweak or skip — otherwise it's handled automatically.

This guide explains what the app is, who uses it, how it works end to end, what
everything costs, and every feature available to each party.

---

## 1. What BrewPass Is

BrewPass started as a single-vendor coffee subscription (one operator making all
the coffee) and is now a **multi-vendor marketplace** that connects:

- **Subscribers** who want a personalized coffee every day with zero daily effort, and
- **Coffee businesses (vendors)** who want a steady stream of pre-planned daily orders,

with **BrewPass as the platform operator** in the middle handling routing,
payments, payouts, and quality.

The core promise: **choose once, drink daily.** A subscriber sets a preference (or
plans a whole month), and the platform automatically generates, routes, charges,
and arranges delivery of one coffee per scheduled day — reassigning to another
vendor if their first choice is unavailable, so the daily coffee always shows up.

All prices are in **Malaysian Ringgit (MYR)**. All times are **Asia/Kuala_Lumpur
(KL, UTC+8)**.

---

## 2. The Parties Involved

BrewPass has **four** parties, each with their own portal/role:

| Party | Who they are | What they do |
|-------|--------------|--------------|
| **Subscriber** | An individual coffee drinker (or a student, or a corporate team member) | Sets coffee preferences, delivery locations, schedule; gets a coffee per scheduled day; can modify/skip each day; rates deliveries. |
| **Vendor** | An existing coffee business (café/roaster) | Applies to join, publishes a menu mapped to the platform taxonomy, sets prices & capacity, accepts/prepares/delivers daily orders, gets paid after delivery. |
| **Platform Operator (Admin)** | The BrewPass team | Approves/suspends vendors, sets commission, monitors routing health, handles disputes/refunds, manages users and roles. |
| **Vendor #1** | BrewPass's own original coffee operation | Just another vendor on the platform — no special-casing. It is the first vendor onboarded by the marketplace migration. |

> Authentication for all parties is via **Auth0**. Roles (individual, student,
> corporate, vendor, admin) determine which portal a logged-in user can access.

---

## 3. Pricing

### 3.1 Subscriber plans (monthly, MYR)

| Plan | Price / month | Coffees included | Best for |
|------|---------------|------------------|----------|
| **Lite** | RM149 | 12 | ~3 mornings a week |
| **Weekday** | RM199 | 22 | Every working day |
| **Premium** | RM299 | 31 | A coffee every single day |
| **Student** | RM149 | 22 | Verified students (Weekday volume at the Lite price) |
| **Corporate** | RM199 per seat | 22 per member | Whole teams (one bill, per-member quota) |

- **Lite, Weekday, Premium** are open to anyone on the billing page.
- **Student** is unlocked only after an **admin verifies** the student — it then
  appears as an option.
- **Corporate** is purchased through the team flow (not the personal billing page).

### 3.2 Add-ons (charged per order, on top of the coffee)

Optional extras a subscriber can attach to a day's order. They are **never** part
of the coffee quota and are charged separately to the saved card at cutoff.
(Add-ons are not available on corporate plans.)

| Add-on | Price | Type |
|--------|-------|------|
| Butter Croissant | RM8.00 | Pastry |
| Pain au Chocolat | RM9.00 | Pastry |
| Banana Bread | RM7.00 | Pastry |
| Chocolate Chip Cookie | RM5.00 | Pastry |
| Iced Matcha Latte | RM12.00 | Drink |
| Spanish Latte | RM11.00 | Drink |

### 3.3 Vendor commission

- The platform retains a **commission** on each delivered order. The **default
  rate is 20%** (configurable by admins).
- Admins can set a **per-vendor override** (e.g., a strategic vendor at 15%).
- Commission is **snapshotted at the moment the customer is charged**, so a
  vendor's net for an order can never change retroactively.
- Example: a RM10.00 coffee at 20% → RM2.00 platform commission, **RM8.00 to the
  vendor** (rounding always favors the vendor; commission + net = exactly gross).

> All money is stored internally in integer **sen** (1 MYR = 100 sen) to avoid
> rounding errors.

---

## 4. The Coffee Taxonomy (how menus stay portable)

BrewPass defines a **standardized, platform-wide option set** — the "taxonomy."
Subscriber preferences always reference the taxonomy, **never a single vendor's
menu**. That's what makes a subscriber's "usual" portable: if their preferred
vendor is full or closed, the order can be routed to a different vendor and still
make the same drink.

The taxonomy covers:

- **Drinks** — e.g., Flat White, Latte, Cappuccino, Americano, Long Black, Mocha,
  Espresso, Cold Brew.
- **Sizes** — Small, Regular, Large (universal across vendors).
- **Milks** — Fresh milk, Oat, Almond, Soy, None.
- **Strength** — Mild, Regular, Strong, Double (universal across vendors).
- **Sugar** — a 0–5 level.
- **Add-ons** — the pastry/drink extras above.

Each **vendor maps their offerings onto this taxonomy**, setting their own prices
and availability. Sizes and strength are universal; drinks, milks, and add-ons are
vendor-curated.

---

## 5. How It Works End to End (the daily cycle)

The platform runs three scheduled jobs each day (KL time):

| Time (KL) | Job | What happens |
|-----------|-----|--------------|
| **8:00 PM** | Generate orders | Creates tomorrow's order for every eligible subscriber, picks a vendor, snapshots the drink/price/location, and sends the night-before reminder. |
| **6:00 AM** | Cutoff | Locks each order, charges the card (or decrements quota), charges add-ons, and records vendor acceptance. After this, the day's order can't be changed. |
| **11:00 PM** | Payouts | Sweeps held funds from **delivered** orders to vendors (for vendors on the daily-batch cadence). |

### Step by step

1. **8:00 PM — Generation.** For each active subscriber whose schedule includes
   tomorrow (and who hasn't skipped it), the system builds tomorrow's order from
   their saved preference, **routes it to a vendor**, and snapshots everything
   (drink spec, location, vendor, price).
2. **8:00 PM — Reminder.** The subscriber gets a push notification and email:
   *"Tomorrow's coffee is ready to go ☕ — a [drink] to [location] at [time].
   Change or skip before 6:00 AM."* It may include a smart suggestion.
3. **Overnight — Modify window.** Until 6:00 AM, the subscriber can change the
   drink, switch the delivery location, add add-ons, swap the vendor, or skip the
   day entirely. Skipping doesn't consume their quota.
4. **6:00 AM — Cutoff.** The order locks (`confirmed`). The platform charges the
   subscriber's saved card for that coffee (or decrements quota on prepaid plans),
   charges any add-ons, and records the vendor's acceptance.
5. **Daytime — Fulfillment.** The vendor sees the order on their board and moves
   it: *preparing → out for delivery → delivered.* A rider is assigned at handoff.
6. **On delivery — Payout unlocked.** Only after the vendor marks the order
   **delivered** does the vendor's share become payable.
7. **11:00 PM — Payout sweep.** Held funds for delivered orders are transferred to
   the vendor's connected Stripe account, net of commission.
8. **After delivery — Rating.** The subscriber can rate the delivery 1–5 stars,
   feeding the vendor's quality score.

> Every job is **idempotent**: there is exactly one order per (subscriber, date),
> and re-running a job never double-generates, double-charges, or double-pays.

### Order status lifecycle

```
scheduled ──(6 AM cutoff)──► confirmed ──► preparing ──► out_for_delivery ──► delivered
    │                                                                              │
    ├──(user skips before cutoff)──► skipped                          (subscriber can rate)
    └──(no quota / inactive / charge fails)──► failed ──► (customer refunded)
```

---

## 6. The Routing Engine (which vendor makes your coffee)

Routing is **server-decided** — clients never choose. For each order:

1. **Preferred vendor first.** If the subscriber has a confirmed preferred vendor
   and that vendor is eligible today, it gets the order.
2. **Otherwise, auto-route** to the best eligible vendor.

A vendor is **eligible** only if all of these are true:

- Status is `active` (not paused/offline/suspended, and not quality-suspended).
- The delivery address is **within the vendor's service area** (radius around their
  geocoded location).
- The vendor is **open** at the delivery time (per their operating hours).
- The vendor is **under capacity** (daily cap and any per-hour slot cap have room).
- The date isn't marked **sold out** by the vendor.
- The vendor still accepts assignments at that time (before their accept cutoff, if
  set — pre-planned night-before orders bypass this).
- The vendor **can make the drink** (taxonomy menu-coverage check).

Among eligible vendors, the tiebreak order is:

1. **Nearest** wins (proximity).
2. If equally close, **higher quality score** wins.
3. If still tied, a deterministic ID sort decides.

**Reassignment fallback.** If a vendor declines or no vendor is eligible, the order
is reassigned (or left for the next nightly run to fill). The `assignmentMethod` is
recorded as `user_preferred`, `ai_routed`, or `reassigned`.

---

## 7. Choosing a Vendor (manual or AI)

Subscribers can set a **preferred vendor** in two ways — and either way, **nothing
takes effect until they confirm**:

- **Manual browse.** See active vendors in range, sorted nearest-first, each showing
  distance, star rating, the price of your drink, and whether they can make it.
  Pick one.
- **Ask the assistant (AI).** Answer a short questionnaire rating five priorities
  from 0 (doesn't matter) to 3 (top priority): **proximity, price, speed, rating,
  drink quality.** The assistant (powered by Claude) recommends a vendor with a
  short rationale. If the AI is unavailable, a deterministic priority-weighted
  scorer produces the same kind of recommendation.

Either way, the subscriber **reviews the choice, can edit it, then confirms.** A
confirmed preferred vendor is used by routing whenever available; auto-routing is
the fallback.

---

## 8. The Monthly List (plan a whole month, then forget)

The monthly list is how "choose once a month" becomes real.

1. **Propose.** The subscriber clicks "Build my month." The system pre-assigns a
   drink and vendor for every scheduled delivery day in the month (using preferred
   vendor where set, AI routing otherwise) and shows the whole month as a grid.
2. **Review & edit.** Before confirming, the subscriber can change the drink for any
   day, swap the vendor, or skip individual days — or re-plan the whole month.
3. **Confirm.** On confirmation, the system creates one **scheduled order per
   non-skipped day**, each tagged to the monthly list. From then on, those orders
   flow through the normal nightly cutoff cycle.
4. **Still flexible.** Even after confirming, the subscriber can edit any individual
   upcoming day from the dashboard until that day's 6:00 AM cutoff.

The result: a full month of vendor-assigned, scheduled daily orders with zero daily
interaction required.

---

## 9. Payments, Charging & Payouts

### How subscribers are charged

BrewPass supports two billing modes:

- **Card-on-file (individual & student plans).** At signup the card is **validated
  and saved but not charged**. Each day at the 6:00 AM cutoff, the subscriber is
  charged **just for that day's coffee** (plus any add-ons) into the platform
  balance. Charging is invisible and automatic — the subscriber does nothing daily.
  A monthly statement/summary gives the "one monthly payment" feel without an
  upfront charge.
- **Prepaid quota (corporate & legacy plans).** A recurring monthly subscription
  pays for the plan; each confirmed order **decrements the quota** instead of
  charging per coffee. Quota resets at the start of each billing period.

**Add-ons** are always charged off-session to the saved card at cutoff, separately
from the coffee. If an add-on charge fails, the add-ons are dropped but the coffee
still goes through.

### How vendors are paid (delivery-gated, "hold then release")

- The customer is charged at cutoff into the **platform balance** — the vendor is
  **not** paid yet.
- The vendor's share (gross minus commission) is transferred to their Stripe
  connected account **only after the order is delivered**. No delivery → no payout.
- **Payout cadence is the vendor's choice:**
  - **Daily batch (default):** one sweep per day collects all that vendor's
    delivered, held funds (fewer transfers, lower fees).
  - **Per order:** a transfer fires as soon as each order is delivered.
  - Cadence only changes *how often* funds are swept, never *whether* payout is
    delivery-gated.

### Stripe Connect (vendor onboarding for payouts)

- Vendors onboard as **Stripe Connect Express accounts.** Stripe handles all
  bank/KYC details — **BrewPass never stores payout information.**
- BrewPass only stores the account ID and whether charges/payouts are enabled,
  synced from Stripe webhooks.

### Refunds & disputes

- **Failed delivery / no-show:** the customer is refunded for that day. Since the
  vendor was never paid (delivery-gated), there's nothing to claw back.
- **Delivered then disputed (chargeback):** the customer's charge is refunded and
  the vendor transfer is **reversed** (clawed back from the vendor).
- **Admin manual refund:** refunds the charge and, if the vendor was already paid,
  reverses the transfer.

All payment actions use **idempotency keys**, and all Stripe **webhooks are
signature-verified and de-duplicated** so retried or out-of-order events are safe.

---

## 10. Subscriber Features (full list)

### Onboarding (3 steps)
1. **Profile** — name, phone, role.
2. **Delivery locations** — add at least one address (Home/Office presets or custom
   label), with optional delivery notes; "use my current location" works on web and
   mobile. Multiple locations supported.
3. **Preferences** — set the "usual": drink, size, milk, sugar (0–5), strength;
   delivery **days** (any of Mon–Sun); delivery **time**; and the default location.

### Dashboard
- **Subscription card** — plan, status, quota remaining, manage link.
- **Upcoming order card** — tomorrow's drink, location, time, add-ons, status, and a
  smart suggestion banner. Actions before cutoff: **Change, Skip, Unskip**.
- **Monthly planner** link — plan the whole month at once.
- **Health insights** (opt-in) — rough caffeine & sugar estimates from the last 7
  days of orders (not medical advice).
- **"Your usual"** — view/edit preferences; "choose your vendor" link.
- **Locations** — add/edit/remove delivery addresses.
- **Recent orders** — last few orders with status; **rate** delivered ones (1–5
  stars + optional comment).
- **Profile** — name, phone, role.

### Smart suggestions (advisory only, never auto-applied)
- Learns from the last 90 days of orders. Suggests, for example, the drink you
  usually pick **on rainy days** (tomorrow's weather is fetched from a free weather
  API) or **on that weekday**, or to redirect a day's delivery to the location you
  usually use. Patterns need ≥3 matching past orders and ≥60% dominance to surface.

### Billing & account controls
- Subscribe (Stripe Checkout), see renewal date and quota progress.
- **Pause / Resume** the plan, **Cancel** (ends at period end) / **Keep my plan**.

### Notifications
- **Push (FCM)** and **email (Resend)** — the night-before reminder.
- **SMS (Twilio)** — vendor status updates (preparing, out for delivery, etc.).
- All notifications are best-effort; a notification failure never blocks an order.

---

## 11. Corporate / Team Accounts

For companies buying coffee for a team under one bill.

- **Pricing:** RM199 per seat per month; each member gets their own **22 coffees /
  month** quota.
- **Create:** a user creates a corporate account (company name), becoming the
  billing owner.
- **Subscribe:** the owner picks a seat count (1–500) and checks out; one Stripe
  subscription bills `quantity = seats`.
- **Members:** the owner adds members by email (they must have signed up). Each
  member gets their own subscription record and independent 22/month quota. Members
  can be removed (their access ends immediately).
- **Seats:** adjustable any time (prorated); seat count can't drop below the current
  member count.
- **Member experience:** members use the dashboard like personal subscribers (set
  preferences, locations, modify/skip orders, view history) but **cannot** buy
  add-ons, change the plan, or pause/cancel billing — that's the owner's control.

---

## 12. Vendor Features (full list)

### Becoming a vendor (lifecycle)
- **Apply** (`/vendor/apply`): business name, address (auto-geocoded), hourly
  capacity, service radius (1–100 km), and operating hours → status **pending**.
- **Admin review:** **approve** → status **active** (the applicant gains the vendor
  role and portal access) or **reject** with a reason (the applicant can re-apply).

**Vendor statuses:** `pending`, `rejected`, `active`, `paused` (vendor-controlled
temporary closure), `offline` (vendor-controlled closure), `suspended`
(admin/quality enforcement).

### Vendor portal
- **Profile & hours** — edit business name, address (re-geocoded), service radius,
  operating hours, and operational status (Open / Paused / Offline). *(Capacity is
  set by the BrewPass team; contact support to change it.)*
- **Menu management** — map offerings onto the taxonomy: toggle drinks/milks/add-ons
  on or off, set prices. A vendor with **no published menu** is treated as offering
  the full canonical menu (preserves migrated behavior); once items are published,
  routing only offers what's marked available.
- **Capacity controls** —
  - **Sold out:** mark any of the next 7 days as sold out (routing skips them).
  - **Daily cap:** max orders per day (blank = unlimited).
  - **Per-hour slot caps:** limit deliveries in specific hours.
  - **Order-accept cutoff:** a time of day after which no new same-day re-routes are
    accepted (pre-planned orders bypass this).
- **Order board** — a Kanban view of today's queue:
  *To prepare (confirmed) → In progress (preparing) → Out for delivery → Delivered.*
  Each card shows the drink, size/milk/sugar/strength, add-ons, notes, customer, and
  location. At handoff a **delivery record** is created; the vendor assigns a rider
  and then **marks delivered** (releases payout) or **marks failed** (refunds the
  customer). Tomorrow's locked orders are previewed but not yet actionable.
- **Earnings & payouts** — connect Stripe (Express onboarding), see **held**
  (awaiting payout) vs **paid out** totals, the last 20 payout statements (period,
  count, cadence, net, status), and toggle **payout cadence** (daily batch / per
  order).
- **Quality scorecard** — rating score, acceptance rate, on-time rate; a banner if
  quality-suspended.

---

## 13. Quality & Ratings

Three signals feed each vendor's quality, all computed from raw, never-reset
counters:

- **Rating score** — average of subscriber 1–5 star ratings (one per delivered
  order).
- **Acceptance rate** — accepted ÷ total assignments (declining before cutoff counts
  against it; the default is implicit acceptance).
- **On-time rate** — deliveries within the promised time + a 15-minute grace.

A **composite quality score** (each signal normalized to 0–1, averaged) is used as a
routing tiebreak. **New vendors score a neutral 0.5** so they're never starved for
lack of history.

**Auto-suspension** (one-way; an admin must clear it) triggers when, with enough
samples, a signal falls below threshold:

| Signal | Suspend below | Minimum sample |
|--------|---------------|----------------|
| Rating | 3.0 stars | 5 ratings |
| Acceptance | 60% | 10 assignments |
| On-time | 60% | 10 deliveries |

Suspended vendors receive no new orders until an admin clears the flag.

---

## 14. Admin / Operator Features

The admin portal (`/admin`) lets the BrewPass team run the marketplace:

- **Operations dashboard** — today's orders, confirmed/delivered/failed counts,
  active subscriptions, pending applications, total users; a failures alert listing
  any failed orders with reasons.
- **Routing health** — reassignment rate, failure breakdown by reason, and the list
  of quality-suspended vendors.
- **Commission management** — set the platform default rate and per-vendor
  overrides.
- **Order tools** — for today's orders: **force-skip**, **reassign vendor**,
  **refund quota**, and **refund money** (which also reverses a vendor transfer if
  already paid). Each order shows its charge and payout state.
- **Vendor management** — approve/reject applications, change status
  (active/paused/suspended/offline), clear quality suspensions, set commission,
  manage vendor staff (add/remove portal access by email), and create vendors
  directly.
- **User management** — search users, verify students (unlocking the student plan),
  and set roles (individual, corporate, student, cafe, vendor, admin). Admins can't
  change their own role (prevents lockout).
- **System tools** — run data migrations (Phase A multi-tenancy, Phase C taxonomy)
  and seed/update the option taxonomy; create database indexes.

---

## 15. Platform Guarantees (the rules behind the scenes)

- **Never double-charge, double-generate, double-pay, or double-refund** — every
  cron, charge, transfer, and refund is idempotent, keyed per order + action.
- **Routing, cutoff, charging, payouts, and refunds are server-only** — clients
  request; the server decides.
- **Per-day charging into the platform balance** for card-on-file plans — never a
  full-month upfront charge with mid-month adjustments.
- **Vendor payouts are always delivery-gated** — no delivery, no transfer,
  regardless of cadence.
- **Preferences and monthly lists reference the taxonomy**, keeping orders portable
  across vendors and reassignments.
- **Vendor, drink, and price are snapshotted at confirmation** — live menus and
  preferences are never re-read after a lock.
- **Selections and monthly lists take effect only after the user confirms.**
- **Stripe handles all vendor bank/KYC** — BrewPass never stores payout details, and
  reverses transfers correctly on refund/dispute.

---

## 16. Platform & Availability

- **Web app:** Next.js (App Router) on Vercel, with Vercel Cron running the daily
  jobs.
- **Mobile:** the same web build wrapped with **Capacitor** (iOS/Android), adding
  native push notifications and geolocation.
- **Data & services:** MongoDB Atlas (database), Auth0 (auth), Stripe + Stripe
  Connect (payments/payouts), Firebase Cloud Messaging (push), Twilio (SMS), Resend
  (email), Google Maps (geocoding & service-area distance), Vercel Blob (vendor
  logos/menu images), Sentry (monitoring).

---

*This guide reflects the current marketplace build. For the developer-facing product
spec, build phases, and engineering conventions, see [CLAUDE.md](./CLAUDE.md) and
the [README](./README.md).*
