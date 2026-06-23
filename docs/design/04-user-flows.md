# BrewPass — Key User Flows

Step-by-step journeys per persona, so the redesign covers **flows**, not just
isolated screens. Screen names map to `02-screen-inventory.md`. Exact business
rules live in [`USER_GUIDE.md`](../../USER_GUIDE.md).

---

## 🟢 Subscriber

### F1 — First-time signup → first coffee scheduled
1. **Landing `/`** → "Log in / Sign up" (Auth0).
2. **Onboarding step 1 `/onboarding`** — name, phone.
3. **Step 2 `/onboarding/preferences`** — pick the "usual" drink (taxonomy) +
   weekly schedule + time.
4. **Step 3 `/onboarding/locations`** — add delivery address(es).
5. **Billing `/dashboard/billing`** — choose a plan; save card (Stripe SetupIntent,
   **no upfront charge**).
6. **Dashboard `/dashboard`** — sees subscription strip + first upcoming order.
- **Design focus:** make 1→6 feel quick and reassuring; the payoff is "your coffee
  is sorted." Card is validated, not charged — say so.

### F2 — The invisible daily cycle (the core promise)
1. Night before: notification "tomorrow's coffee is {drink} to {location}."
2. User *optionally* opens **Dashboard** → **upcoming-order** card → edit or skip
   **before the cutoff** (default 6:00 AM KL).
3. At cutoff: order locks + charges silently. User does nothing.
4. Morning: status moves Scheduled → Confirmed → Preparing → On its way →
   Delivered. When `out_for_delivery`, the **delivery-tracker** map appears.
5. After delivery: user can **rate** (stars) from Recent orders.
- **Design focus:** the default path is *doing nothing*. Editing/skip must be
  one tap and obviously time-bound by the cutoff.

### F3 — Choose a vendor (manual or AI)
1. From Dashboard "Choose your vendor →" → **`/dashboard/vendor`**.
2. Either browse and pick a preferred café (manual), OR answer the short
   questionnaire (proximity / price / speed / rating / drink) → **AI recommends**.
3. Review the selection → **edit if desired** → **Confirm**.
4. Effective only after confirm; routing uses it when that vendor is available,
   else auto-routes.
- **Design focus:** make AI vs manual feel like two doors to the same calm result;
  confirmation is the commit point.

### F4 — Plan the whole month, then forget
1. Dashboard "Plan your month →" → **`/dashboard/monthly`**.
2. AI proposes a coffee + vendor for **every delivery day**.
3. User reviews the month, **edits any day** (swap vendor, change drink, skip).
4. **Confirm once** → scheduled daily orders are created for the period.
5. Later: user can still edit an individual upcoming day until its own cutoff.
- **Design focus:** reviewing ~31 days must feel light (agenda/calendar, batch
  confirm, easy per-day override) — not a spreadsheet.

### F5 — Manage billing / plan changes
1. **`/dashboard/billing`** → change personal plan, pause, cancel, update card.
2. Student → verification gate. (Office coffee is **not** here — it's the
   corporate flow, F5b–F5d, billed per delivery, not a personal plan.)

### F5b — Join a company by code (member, keeps personal account)
1. **`/dashboard/corporate`** → `join-company-panel` → enter a **join code**.
2. The account is **linked** to the company — personal `role`, subscription, and
   preferences are **untouched**; a `CorporateMembership` is created.
3. Member sets their **office preference** (defaults to the owner's office
   defaults); it's separate from their personal "usual".
- **Design focus:** make "this does not change your personal account" obvious;
  joining is additive, never a takeover.

### F5c — Receive office coffee + same-day overlap (member)
1. Office coffee generates and charges on the **company card** (member does
   nothing daily — same calm promise as personal).
2. On the **Dashboard**, `office-coffee-tracker` shows today's office coffee
   (compact ETA/status) **alongside** the personal coffee.
3. If both a personal and an office coffee land the same day, `overlap-notice`
   appears: **advisory**, dismissible, one-tap "cancel one" + remember-my-choice.
   **Default is keep both** — never a forced choice.
- **Design focus:** two coffees, two cards, zero conflict; the notice is a gentle
  heads-up, not a daily checkout.

### F5d — Run a company (owner)
1. **`/dashboard/corporate`** owner dashboard: save the **company card** (Stripe
   SetupIntent, no upfront charge).
2. Generate/share/rotate a **join code** (reusable or single-use, optional
   redemption cap); set **office defaults** (drink/schedule/location).
3. Set **autonomy toggles** — `selectionMode` bundle vs individual,
   `memberSelfSelect`, `memberCanDecline` (server-enforced).
4. Watch the **member roster** (joined?, office coffee set?, today/tomorrow,
   want vs skip, delivery status); set the bundle drink or, where allowed, toggle
   want/skip for a member.
5. Optionally buy a vendor **pack** for the team (`office-pack-panel`, F13).
- **Design focus:** the owner's core job is "buy the team's coffee with minimal
  friction" — a one-tap default, with controls available but not in the way.

---

## 🟠 Vendor

### F6 — Become a vendor
1. **`/vendor/apply`** — business info, location, hours, capacity → status
   `pending`.
2. Sees **"Application under review"** notice at `/vendor`.
3. Admin approves → status `active` (or rejected, with note → can reapply).
4. First login lands on the **fulfillment board**.

### F7 — Set up to receive orders
1. **`/vendor/menu`** — map offerings onto the taxonomy, set prices/availability
   (optionally upload a menu → **AI extracts** a draft → confirm).
2. **`/vendor/capacity`** — daily cap, sold-out toggles, accepting cutoff.
3. **`/vendor/profile`** — operating hours + service area.
4. **`/vendor/earnings`** — complete **Stripe Connect** onboarding; pick **payout
   cadence** (per-order vs daily batch).
- **Design focus:** a clear readiness checklist — a vendor isn't "live" until menu,
  capacity, hours, and Connect are done.

### F8 — Run a shift (daily)
1. **`/vendor` board** — see today's confirmed orders (customer, drink, deliver-by).
2. Advance each order: Preparing → Out for delivery → Delivered (or **decline**).
3. Watch delivery state (rider/provider/tracking) per order.
4. Glance at tomorrow's scheduled count (locks at the morning cutoff).
5. Watch the **quality strip** (rating / acceptance / on-time); a red banner means
   auto-suspension.
- **Design focus:** glanceable, big targets, obvious "what's next" + delivery state.

### F9 — Get paid
1. **`/vendor/earnings`** — earnings accrue **only after delivery** (delivery-gated).
2. Funds shown as **held → released**; commission retained; payouts per cadence.
3. View statements + payout history.
- **Design focus:** never imply instant payout at order time; held vs released
  must be unmistakable.

### F-promo — Run a promotion (vendor, Phase K)
1. **`/vendor/promotions`** → create a **pack** (`packSize` + `packPrice`,
   `fixed_drink` or `buyer_choice`), **buy-N-get-M**, or **time-window discount**,
   each with a validity window.
2. Optionally act on a **platform-suggested** campaign (e.g. "discount your
   quiet 2–4pm") — a suggestion the vendor accepts or ignores.
3. Activate; offices in range can now buy it (F13). Packs are **vendor-pinned**:
   they don't reroute, so the vendor's price always holds.
- **Design focus:** packs are *this vendor's* priced product; suggestions are
  advisory, never auto-applied.

---

## 🏢 Corporate (cross-persona)

### F13 — Buy a vendor pack for the office (owner, Phase K)
1. **`/dashboard/corporate`** → `office-pack-panel` shows packs from in-range
   vendors as an **optional savings nudge** ("a 10-pack is RM12 cheaper than your
   usual 8 — use it?"). Ignoring it leaves the one-tap "buy the usual".
2. Buy the **pack + individual top-ups** if the team is larger than the pack;
   **assign** members to coffees (or auto-fill). Unassigned slots are
   **paid-for-and-skipped** — still cheaper, and expected.
3. Editable until that day's cutoff; the company card is charged for (pack +
   top-ups) at cutoff; each coffee is a delivery-gated order.
4. If the pack's vendor goes **offline**, the day's pack is **skipped/refunded**
   (not rerouted) and the owner notified.
- **Design focus:** optional savings, never forced comparison shopping; keep
  **"Vendor Pack"** distinct from `bundle` selection mode.

---

## 🔵 Admin / operator

### F10 — Daily operations triage
1. **`/admin`** — scan stat tiles (orders/confirmed/delivered/failed/subs/apps).
2. **Failures today** panel → investigate failed orders + reasons.
3. **Routing health** → reassignment rate, failure reasons, quality-suspended vendors.
4. Manually **reassign** an order to an active vendor if needed.
- **Design focus:** failures and routing health must jump out; triage in seconds.

### F11 — Onboard / govern vendors
1. **Vendors table** → review **pending applications** → approve / reject (with note).
2. Suspend / reactivate vendors; set **commission** override per vendor.
3. Watch each vendor's load + quality (rating / acceptance / on-time).

### F12 — Platform configuration
1. **Commission panel** — set the platform default rate.
2. **Users table** — roles, **student verification**.
3. Setup/migration actions (indexes, taxonomy seed, phase migrations) — operator-only.

---

## Flow-level guardrails

- **Confirmation is the commit point** in F3 and F4 — nothing takes effect until
  the user confirms; both AI and manual paths stay editable pre-confirm.
- **The cutoff bounds editability** in F2/F4 — after it, the day is read-only/charged.
- **Payout follows delivery** in F8/F9 — design must keep that causality visible.
- **Roles route hard** — subscribers, vendors, admins each land in their own app;
  wrong-role access shows a notice, not a broken screen.
</content>
