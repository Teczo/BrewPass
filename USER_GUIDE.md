# BrewPass — Complete User Guide

> Your daily coffee, delivered on schedule. Subscribe once — we handle the rest.

BrewPass is a **subscription coffee marketplace with integrated courier delivery**.
Subscribers tell us their "usual" coffee once; every working day a customized coffee
is made by a local coffee business and delivered to them by a dispatched courier at
their chosen place and time — tracked live inside the app. The night before, they're
reminded and can tweak or skip — otherwise it's handled automatically.

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
dispatches a courier, and delivers one coffee per scheduled day — reassigning to
another vendor if their first choice is unavailable, so the daily coffee always
shows up.

The product is **convenience, not low price**: the subscriber pays once (card on
file), plans drinks once, and never browses, books, or pays for delivery
separately. Delivery is dispatched by the platform and **its cost is baked into the
plan price** — there is no separate delivery charge.

All prices are in **Malaysian Ringgit (MYR)**. All times are **Asia/Kuala_Lumpur
(KL, UTC+8)**.

---

## 2. The Parties Involved

BrewPass has **four** parties, each with their own portal/role:

| Party | Who they are | What they do |
|-------|--------------|--------------|
| **Subscriber** | An individual coffee drinker, or a student, or a member of a company team | Sets coffee preferences, delivery locations, schedule; gets a coffee per scheduled day; can modify/skip each day; rates deliveries. |
| **Vendor** | An existing coffee business (café/roaster) | Applies to join, publishes a menu mapped to the platform taxonomy, sets prices & capacity, accepts/prepares/delivers daily orders, gets paid after delivery. |
| **Platform Operator (Admin)** | The BrewPass team | Approves/suspends vendors, sets commission, monitors routing health, handles disputes/refunds, manages users and roles. |
| **Vendor #1** | BrewPass's own original coffee operation | Just another vendor on the platform — no special-casing. It is the first vendor onboarded by the marketplace migration. |

> Authentication for all parties is via **Auth0**. Roles (individual, student,
> vendor, admin) determine which portal a logged-in user can access. **Team
> (office) coffee is a relationship, not a role** — joining a company never
> changes a user's personal role, plan, or preferences. See the dedicated
> [Team Guide](./TEAM_GUIDE.md).

---

## 3. Pricing

### 3.1 Subscriber plans (monthly, MYR)

| Plan | Price / month | Coffees included | Best for |
|------|---------------|------------------|----------|
| **Lite** | RM149 | 12 | ~3 mornings a week |
| **Weekday** | RM199 | 22 | Every working day |
| **Premium** | RM299 | 31 | A coffee every single day |
| **Student** | RM149 | 22 | Verified students (Weekday volume at the Lite price) |

- **Lite, Weekday, Premium** are open to anyone on the billing page.
- **Student** is unlocked only after an **admin verifies** the student — it then
  appears as an option.
- **Team (office) coffee is not a plan.** A company isn't billed per seat or per
  month — it pays **per delivered office coffee** on a company card
  (charge-then-deliver), entirely separate from these personal plans. See the
  [Team Guide](./TEAM_GUIDE.md).

### 3.2 Add-ons (charged per order, on top of the coffee)

Optional extras a subscriber can attach to a day's order. They are charged
separately to the saved **personal** card at cutoff. (Add-ons are a personal
purchase — they are not available on office/team coffee.)

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

### 3.4 Delivery-inclusive pricing (v2.1)

Delivery is **never billed to the subscriber separately** — its cost is absorbed
into the plan price. The subscriber sees no delivery line item and never pays or
books a courier.

- The **courier fee** the platform pays (typically a few ringgit, by distance) is a
  **platform cost**, recorded internally for margin accounting. It is invisible to
  the subscriber and is **never deducted from the vendor's payout**.
- Because every kilometre of a vendor's service radius is a platform cost,
  **proximity-first routing protects unit economics** — nearer vendors are cheaper
  to deliver from.
- Vendors are paid a **negotiated marketplace coffee rate** (typically below their
  public retail price) in exchange for guaranteed daily volume. This negotiated rate
  — not the vendor's public menu price — is what feeds the vendor's payout.

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
| **6:00 AM** | Cutoff | Locks each order, charges the card (the member's own card for personal coffee, the company card for office coffee), charges add-ons, and records vendor acceptance. After this, the day's order can't be changed. |
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
   saved card for that coffee — the subscriber's own card for personal coffee, the
   company card for office coffee — charges any add-ons, and records the vendor's
   acceptance. The order is only released to the vendor if the charge succeeds.
5. **Daytime — Fulfillment.** The vendor sees the order on their board and starts
   *preparing.* When they hit "Ready — hand off," the platform **dispatches a
   courier** (Lalamove) to collect from the vendor and deliver to the subscriber.
   The subscriber tracks the driver live in the app. (Vendors who self-deliver use
   the legacy manual path with their own rider.)
6. **On delivery — Payout unlocked.** Only after delivery is **confirmed** — by the
   courier's webhook, or the vendor's "Mark delivered" on the manual path — does the
   vendor's share become payable. A delivery-confirmation SMS goes to the subscriber.
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
    └──(inactive / charge fails after retries)──► failed ──► (customer refunded)
```

Each order has one **delivery record** that runs its own state machine during the
`out_for_delivery` phase: `pending → assigned → picked_up → delivered`, or
`failed`. The machine only advances forward and ignores out-of-order/duplicate
courier events. A `delivered` delivery releases the payout; a `failed` one refunds
the subscriber and pays the vendor nothing.

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

### How subscribers are charged (card-on-file, charge-then-deliver)

At signup the card is **validated and saved but not charged**. Each day at the
6:00 AM cutoff, the subscriber is charged **just for that day's coffee** (plus any
add-ons) into the platform balance — and the order is only released to the vendor
if the charge succeeds. Charging is invisible and automatic; the subscriber does
nothing daily. A monthly statement/summary gives the "one monthly payment" feel
without an upfront charge.

If a charge fails at cutoff, the platform **retries 3 times over ~10 minutes**;
if it still fails, that single day is **skipped and the customer is notified** —
the plan is never paused over one failed day.

> **Office (team) coffee** uses the same charge-then-deliver model, but on the
> **company card** instead of the member's card. Personal and office coffee are
> never cross-charged. See the [Team Guide](./TEAM_GUIDE.md).

**Add-ons** are always charged off-session to the saved personal card at cutoff,
separately from the coffee. If an add-on charge fails, the add-ons are dropped but
the coffee still goes through.

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

## 10. Delivery & Live Tracking (v2.1)

Delivery is a first-class, platform-dispatched step — not a manual stub.

### Courier dispatch

- When a vendor hits **"Ready — hand off,"** the platform requests a real-time quote
  from the courier (vendor → subscriber route) and **dispatches a courier order**.
  The primary courier is **Lalamove** (Malaysia); **Grab** is planned as a second
  adapter behind the same courier abstraction.
- **Self-delivery fallback:** a vendor can keep delivering with their own rider via
  the legacy **manual** path. Each vendor's delivery provider resolves as:
  `manual` (always self-deliver) · unset (use the platform's Lalamove if configured,
  else manual) · `lalamove`/`grab` (use that provider if its adapter is configured,
  else fall back to manual).
- Courier dispatch is server-only and **idempotent** — an order is never
  double-dispatched.

### Delivery lifecycle

The courier's events drive the delivery state machine, mapped from provider
statuses:

| Courier status | Delivery state | Meaning for the subscriber |
|----------------|----------------|----------------------------|
| pending / assigning | (info only) | Finding a driver |
| driver assigned | `assigned` | A driver is on the way to the vendor |
| picked up | `picked_up` | Driver has the coffee, heading to you |
| completed | `delivered` | Delivered — **payout released**, SMS sent |
| canceled / rejected / expired | `failed` | Delivery fell through — **you're refunded** |

The machine only moves forward and ignores duplicate or out-of-order events. Once
`delivered` or `failed`, it's terminal.

### In-app live tracking (subscriber)

While an order is out for delivery, the dashboard shows a **"Track your delivery"**
panel with:

- **Driver details** — name, vehicle plate, and a call button (when provided).
- **Live map** — a map with the driver's live location (refreshed about every 15
  seconds) and your drop-off point, auto-fitted so you can watch the driver approach.
- **Status badge** — *Finding a driver → Driver assigned → Picked up, on the way →
  Delivered* (or *Delivery problem*).
- **Fallback link** — if live location goes stale, a link opens the courier's own
  tracking page.

Tracking is fully **in-app** — the subscriber never leaves BrewPass for the
courier's app or website. Polling stops once the order is delivered or failed.

### Webhooks, payout gating & failures

- Courier status changes arrive at a **signature-verified webhook**
  (`/api/webhooks/courier/[provider]`) and are processed **idempotently** (de-duped
  per provider + courier order + status), so payout is never released twice.
- **Payout stays delivery-gated:** the vendor is paid only when delivery is
  confirmed `delivered` (by webhook on the courier path, or the "Mark delivered"
  button on the manual path). On handoff, funds are merely held.
- **On courier failure/cancellation:** the order is marked `failed`, the subscriber
  is refunded, and the vendor earns nothing. An admin can re-dispatch or manually
  resolve a stuck delivery.

---

## 11. Subscriber Features (full list)

### Onboarding (3 steps)
1. **Profile** — name, phone, role.
2. **Delivery locations** — add at least one address (Home/Office presets or custom
   label), with optional delivery notes; "use my current location" works on web and
   mobile. Multiple locations supported.
3. **Preferences** — set the "usual": drink, size, milk, sugar (0–5), strength;
   delivery **days** (any of Mon–Sun); delivery **time**; and the default location.

### Dashboard
- **Subscription card** — plan, status, and a manage link. Card-on-file plans
  bill per coffee (no quota shown); legacy prepaid plans show quota remaining.
- **Upcoming order card** — tomorrow's drink, location, time, add-ons, status, and a
  smart suggestion banner. Actions before cutoff: **Change, Skip, Unskip**.
- **Live delivery tracking** — while an order is out for delivery, a "Track your
  delivery" panel shows the driver, a live map, and status (see §10).
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
- Subscribe (Stripe Checkout), see renewal date and (on prepaid plans) quota
  progress.
- **Pause / Resume** the plan, **Cancel** (ends at period end) / **Keep my plan**.

### Notifications
- **Push (FCM)** and **email (Resend)** — the night-before reminder.
- **SMS (Twilio)** — delivery status updates, including a delivery-confirmation
  message ("your [drink] has been delivered — enjoy! ☕").
- All notifications are best-effort; a notification failure never blocks an order.

---

## 12. Team (Office) Coffee — Overview

Companies can buy coffee for a whole team on **one company card**. This is a
distinct product from personal plans and has its **own complete guide** — see
**[TEAM_GUIDE.md](./TEAM_GUIDE.md)**. In brief:

- **No seats, no per-person subscription.** The company pays **per delivered
  office coffee** on a saved company card (charge-then-deliver), exactly like
  personal coffee but on the company's card.
- **Join by code.** The owner shares a join code; staff redeem it to join — no
  email management. Joining **never touches a member's personal account**.
- **Personal + office coexist.** A member can hold a personal plan and office
  membership at once, and even get both coffees on the same day (different cards,
  no conflict). A non-blocking notice lets them cancel one if they want.
- **Owner autonomy controls** (server-enforced): one drink for everyone (bundle)
  vs. each member picks their own (individual); whether members may edit their
  office coffee; whether they may skip a day.
- **Vendor Packs (optional savings).** The admin can buy a vendor's discounted
  multi-coffee pack (plus top-ups for a larger team) instead of per-member
  coffees — surfaced as an optional nudge, never forced.

Full setup, member experience, billing, failure handling, and packs are all in
the **[Team Guide](./TEAM_GUIDE.md)**.

---

## 13. Vendor Features (full list)

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
- **AI-assisted menu onboarding (v2.1)** — instead of entering items one by one, a
  vendor can **upload 1–5 menu screenshots/photos** (PNG/JPEG/WebP/GIF, ~5 MB each).
  Claude reads each image and proposes a draft: for every item it returns the raw
  text, the best-matching taxonomy option, a price (if visible), and a confidence
  score. The vendor **reviews and edits** the draft (fix a mapping, set/clear a
  price, remove a row, or save for later), then **confirms** to publish. Confirming
  runs every row through the **same validation** as manual edits; unmapped rows are
  skipped and reported. Uploaded images are processed transiently and **never
  stored**; if the AI is unavailable, the vendor maps the menu manually.
- **Capacity controls** —
  - **Sold out:** mark any of the next 7 days as sold out (routing skips them).
  - **Daily cap:** max orders per day (blank = unlimited).
  - **Per-hour slot caps:** limit deliveries in specific hours.
  - **Order-accept cutoff:** a time of day after which no new same-day re-routes are
    accepted (pre-planned orders bypass this).
- **Order board** — a Kanban view of today's queue:
  *To prepare (confirmed) → In progress (preparing) → Out for delivery → Delivered.*
  Each card shows the drink, size/milk/sugar/strength, add-ons, notes, customer, and
  location. At **"Ready — hand off,"** a courier is dispatched (Lalamove): the card
  then shows **read-only courier status** (driver name once assigned, plus a tracking
  link) and delivery is confirmed by the courier webhook — no manual button. On the
  **self-delivery (manual) path**, the vendor instead assigns a rider name and
  **marks delivered** (releases payout) or **marks failed** (refunds the customer).
  Tomorrow's locked orders are previewed but not yet actionable.
- **Delivery provider** — a vendor can run on the platform courier (Lalamove) or
  opt into **self-delivery (manual)**; left unset, they default to the platform
  courier when it's configured, else manual.
- **Earnings & payouts** — connect Stripe (Express onboarding), see **held**
  (awaiting payout) vs **paid out** totals, the last 20 payout statements (period,
  count, cadence, net, status), and toggle **payout cadence** (daily batch / per
  order).
- **Quality scorecard** — rating score, acceptance rate, on-time rate; a banner if
  quality-suspended.

---

## 14. Quality & Ratings

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

## 15. Admin / Operator Features

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
  already paid). Each order shows its charge, payout, and delivery state, and admins
  can resolve a stuck delivery (re-dispatch or manually mark delivered/failed).
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

## 16. Platform Guarantees (the rules behind the scenes)

- **Never double-charge, double-generate, double-pay, double-refund, or
  double-dispatch** — every cron, charge, transfer, refund, and courier dispatch is
  idempotent, keyed per order + action.
- **Routing, cutoff, charging, payouts, refunds, and courier dispatch are
  server-only** — clients request; the server decides.
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

## 17. Platform & Availability

- **Web app:** Next.js (App Router) on Vercel, with Vercel Cron running the daily
  jobs.
- **Mobile:** the same web build wrapped with **Capacitor** (iOS/Android), adding
  native push notifications and geolocation.
- **Data & services:** MongoDB Atlas (database), Auth0 (auth), Stripe + Stripe
  Connect (payments/payouts), **Lalamove courier API** (delivery dispatch & tracking;
  **Grab** planned as a second adapter), Firebase Cloud Messaging (push), Twilio
  (SMS), Resend (email), Google Maps (geocoding, service-area distance & in-app
  tracking maps), **Anthropic Claude** (AI menu extraction & vendor recommendations),
  Vercel Blob (vendor logos/menu images), Sentry (monitoring).

---

*This guide reflects the current marketplace build. For **team / office coffee**,
see the dedicated [Team Guide](./TEAM_GUIDE.md). For the developer-facing product
spec, build phases, and engineering conventions, see [CLAUDE.md](./CLAUDE.md) and
the [README](./README.md).*
