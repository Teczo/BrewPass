# BrewPass — Product Brief (for designers)

A condensed, design-oriented brief. For exhaustive behavior see
[`USER_GUIDE.md`](../../USER_GUIDE.md).

## One sentence

BrewPass is a **daily-coffee subscription marketplace**: subscribers set their
coffee, schedule, and delivery spot once, and a personalized coffee is made by a
local café and delivered to them every day — automatically, with no daily
decisions.

## The core insight (drives every design choice)

The pain it removes is **the daily choosing and paying**, not the coffee itself.
So the product is built to be **invisible day-to-day**:

- You plan once (or let AI plan), confirm, and forget.
- Charging happens silently at a daily cutoff — there is **no daily checkout**.
- The night before, you *can* peek at tomorrow's coffee and tweak or skip it —
  but you never *have* to.

The emotional target for the subscriber app is **calm and effortless**, not
"engaging." Good design here means the user rarely needs to open the app.

## The marketplace (v2)

Originally one café; now a **two-sided marketplace**:

- **Subscribers** want a customized coffee daily without thinking about it.
- **Vendors** (coffee businesses) fulfill orders and get paid after delivery.
- **The platform operator** (admin) runs routing, commission, payouts, quality.

The operator's own café is simply **Vendor #1** — no special-case UI.

A **routing engine** decides which vendor makes each subscriber's coffee each
day (their chosen preferred vendor when available; otherwise AI-routed to the
best nearby vendor). Because preferences reference a **standardized taxonomy**
(canonical drinks/sizes/milks/strength), an order is portable across vendors.

## The three apps and their personalities

| App | Who | Emotional target | Density | Primary device |
| --- | --- | ---------------- | ------- | -------------- |
| **Subscriber app** | Everyday coffee drinkers | Calm, warm, effortless, a little delightful | Low — one clear thing per screen | **Mobile-first** (also runs in Capacitor as a native app) |
| **Vendor portal** | Café owners/baristas, mid-shift | Fast, legible at a glance, operational | Medium-high — a working board | Tablet / desktop behind the counter, but must survive on phone |
| **Admin dashboard** | Platform operator | In-control, trustworthy, dense but scannable | High — tables, metrics, controls | Desktop |

They share one brand and component DNA but are tuned very differently. Don't make
the vendor board as airy as the subscriber app, and don't make the subscriber app
as dense as admin.

## Personas

- **Aisha, the subscriber.** Busy professional in KL. Wants her flat white at her
  desk at 9am every weekday and never wants to think about it. Opens the app
  maybe twice a month — to plan, or to skip a day she's travelling.
- **Daniel, the vendor.** Runs a small café. Mid-morning rush; needs to see
  "what do I make next, for whom, and is the rider here" without squinting.
  Checks earnings/payouts weekly.
- **Priya, the operator (admin).** Runs the platform. Watches today's order
  health, approves new vendors, sets commission, handles failures and disputes.

## What subscribers get (feature surface)

- 3-step onboarding (profile → preferences → locations).
- Personal plans: **Lite RM149/12**, **Weekday RM199/22**, **Premium
  RM299/31**, **Student RM149/22** (verified). (Office coffee is **not** a
  personal plan tier — it's a separate corporate flow billed per delivery, see
  "corporate teams" below.)
- Add-ons (pastries/drinks) charged per order on top of the coffee.
- A **"usual"** drink + weekly schedule + delivery locations.
- **Vendor choice**: pick a preferred café, or answer a short questionnaire and
  let AI recommend one. Editable, takes effect only after confirm.
- **Monthly list**: AI proposes a coffee + vendor for every delivery day; the
  user reviews the whole month, edits any day, confirms once.
- Per-day editing until that day's cutoff; skip days; live delivery tracking
  when a coffee is out for delivery; post-delivery rating; opt-in health summary.
- **Join a company** with a code to also receive office coffee — without
  touching their personal account. A person can be **both** a personal
  subscriber and an office member at once; the two never override each other,
  and they may even get a personal *and* an office coffee on the same day
  (charged to different cards). Any same-day overlap is surfaced as an
  **advisory, non-blocking** notice (default: keep both) — never a daily prompt.

## What corporate teams get (Phase J)

A company is run by a **billing owner**, with staff as members. There are **no
seats and no per-seat subscription** — the company pays **per delivered office
coffee on one company card** (charge-then-deliver, same as personal).

- **Owner dashboard** (`/dashboard/corporate`): save the **company card**,
  generate/share/rotate a **join code**, set **office defaults** (drink,
  schedule, location), and see a **member roster** (joined? office coffee set?
  today's/tomorrow's selection, want vs skip, delivery status).
- **Owner autonomy toggles** (server-enforced, not just UI): **selection mode**
  `bundle` (owner picks one office coffee for everyone) vs `individual` (each
  member picks); **`memberSelfSelect`** (may members choose/edit at all);
  **`memberCanDecline`** (may members skip a day).
- **Members** join by code from the same screen, keeping their personal account
  fully intact, get their **own office preference**, and a lightweight **office
  coffee tracker** (compact "arriving ~9:05 · Flat White · Level 12", map
  optional).
- **Vendor packs** (Phase K): when a vendor offers a discounted **pack**, the
  owner can buy it for the team (pack + individual top-ups, assign members)
  instead of per-member coffees — surfaced as an **optional savings nudge**,
  never a forced comparison.

## What vendors get

- Apply → admin review → active. Then a portal with:
  - **Today's fulfillment board** (confirmed orders to make, with delivery state).
  - **Tomorrow's scheduled orders** (locks at the morning cutoff).
  - **Menu**: map offerings onto the platform taxonomy, set prices/availability
    (incl. AI menu extraction from an uploaded menu).
  - **Capacity**: daily caps, per-item sold-out toggles, accepting cutoff.
  - **Earnings & payouts**: delivery-gated payouts, statements, payout cadence
    (per-order vs daily batch), Stripe Connect onboarding.
  - **Profile & hours**: address, service area, operating hours, status controls.
  - **Quality scorecard**: rating, acceptance rate, on-time rate (can auto-pause).
  - **Promotions** (Phase K): create time-boxed **packs** (discounted N-coffee
    bundles offices buy), **buy-N-get-M**, and **time-window discounts** for
    quiet hours — plus platform-**suggested** campaigns (suggestions only; the
    vendor always decides).

## What admin gets

- Today's order health: totals, confirmed/delivered/failed, failures list.
- **Routing health**: reassignment rate, failure reasons, quality-suspended vendors.
- **Commission** default + per-vendor overrides.
- **Vendors** table: approve/reject/suspend, staff, today's load, quality, commission.
- **Users** table: roles, student verification.
- One-time setup/migration buttons (indexes, taxonomy seed, phase migrations).

## Money, time, locale

- Currency **MYR**, stored as integer **sen**, rendered `RM12.00`.
- All timestamps stored UTC; **display in Asia/Kuala_Lumpur**.
- The **daily cutoff** (default 6:00 AM KL) is the moment orders lock and charge.

## Design guardrails (don't break these)

1. **No daily checkout/approval for subscribers.** The product's promise is that
   the daily run is automatic. Design confirmation + pre-cutoff editing, not a
   daily cart.
2. **One monthly confirmation, then forget.** The monthly list is the big
   subscriber moment — make reviewing a whole month feel light, not like a
   31-row spreadsheet chore.
3. **Cutoff is a first-class concept.** Show clearly when editing closes and when
   things lock/charge. Subscriber, vendor, and admin all revolve around it.
4. **Taxonomy, not vendor menus, for preferences.** A subscriber picks "Flat
   White / Large / Oat / Strong," which any vendor can fulfill. Don't design the
   preference UI as browsing one café's menu.
5. **Vendor = Vendor #N.** No special "house café" UI. Every vendor screen works
   for any vendor.
6. **Delivery-gated payouts.** Vendors are paid only after delivery. Earnings UI
   must make "held vs released" legible — never imply instant payout at order time.
7. **Mobile-first subscriber app.** It ships as a native app via Capacitor.
   Thumb-reachable actions, bottom-sheet patterns welcome.
8. **Trust at money moments.** Charging, payouts, refunds, and disputes must read
   as precise and trustworthy across all three apps.
9. **Personal and office coffee never override each other.** Joining a company
   doesn't change a person's personal account; personal coffee bills the
   member's card and office coffee bills the company card — never crossed. Any
   same-day overlap is **advisory** (default keep both), never a mandatory daily
   choice. Don't design a corporate flow that mutates or hides the personal one.
10. **Promotions are optional savings, never forced shopping.** The team admin's
    default stays one-tap "buy the usual"; packs/campaigns are optional nudges.
    Keep **"Vendor Pack"** (a vendor-priced product) and **`bundle` selection
    mode** (owner picks one drink for everyone) visually and verbally distinct.
</content>
