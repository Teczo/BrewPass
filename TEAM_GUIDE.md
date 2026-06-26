# BrewPass for Teams — Office Coffee Guide

> Coffee for your whole team, on one company card. No seats, no monthly
> per-person fee — you pay only for the coffees that are actually delivered.

This guide covers everything about **office (team) coffee** on BrewPass: how a
team admin sets up a company, how staff join with a code, how members get and
track their coffee, how billing works, and the optional money-saving Vendor
Packs. It is separate from the personal subscriber experience — for that, see
the main [USER_GUIDE](./USER_GUIDE.md).

All prices are in **Malaysian Ringgit (MYR)**. All times are
**Asia/Kuala_Lumpur (KL, UTC+8)**.

---

## 1. The Big Idea

Office coffee on BrewPass is built around three principles:

1. **No seats, no subscription per head.** You are **not** billed per employee or
   per month. The company is charged **per delivered office coffee** on a single
   **company card** — exactly like personal coffee, but on the company's card
   instead of the member's. If a coffee isn't made and delivered, the company
   isn't charged for it.
2. **Personal and office coffee never collide.** A staff member can have their
   own personal BrewPass plan *and* belong to your company at the same time.
   Joining your company **never touches their personal account** — not their
   plan, not their preferences, not their card. A member can even receive a
   personal coffee and an office coffee on the **same day**; they're billed to
   **different cards**, so there's no conflict.
3. **You decide how much autonomy members get.** As the owner you choose whether
   everyone gets the same coffee or each person picks their own, whether members
   may edit their office coffee at all, and whether they may skip a day. These
   rules are enforced on the server — not just hidden in the app.

---

## 2. Roles in a Team

| Role | Who | What they do |
|------|-----|--------------|
| **Team admin / owner** | The person who creates the company and holds the company card | Sets office defaults and autonomy rules, shares the join code, sees the whole team's coffee, buys Vendor Packs, pays the bill. |
| **Member** | Any staff member who redeems the join code | Gets office coffee on the company's schedule, tracks it, and — where the owner allows — sets their own drink or skips a day. |

> The owner can also be a member (they can drink office coffee too). **Billing
> ownership and membership are independent** — being on the team doesn't make you
> pay, and paying doesn't force you to drink.

There are **no per-member roles to manage** and no email lists to maintain.
Membership is a relationship created when someone redeems your code — it is
*not* a change to their personal account role.

---

## 3. Setting Up Your Team (Owner)

Everything below lives at **Dashboard → Office coffee** (`/dashboard/corporate`).

### Step 1 — Create the company
Click **Create a company**, enter your company name. You become the **billing
owner**. (Creating a company doesn't enrol you or anyone else in coffee yet.)

### Step 2 — Add a company card
Under **Office coffee setup → Company card**, click **Add company card**. This
opens Stripe to save a card. **Office coffee can't be generated until a card is
on file** — every delivered office coffee is charged to this card.

You can **Replace card** at any time.

### Step 3 — Set office defaults
Office defaults are the starting point for every member's office coffee:

- **Drink** — drink, size, milk, sugar (0–5), strength (from the platform
  taxonomy, so the order stays portable across vendors).
- **Schedule** — which weekdays office coffee is delivered (any of Mon–Sun) and
  the delivery time.
- **Office location** — where office coffee is delivered. (Add the address under
  **Locations** first if you haven't.)

In **individual** mode each member's office coffee starts from these defaults and
they can tweak it (if you allow it). In **bundle** mode the bundle drink
overrides the default drink for everyone.

### Step 4 — Choose autonomy rules
See §4.

### Step 5 — Share the join code
See §5. Staff redeem it to join.

---

## 4. Autonomy Controls (Owner)

You control how much members manage their own office coffee. All three settings
are **enforced on the server for every member action** — a member can never get
around them in the app.

| Setting | Options | Effect |
|---------|---------|--------|
| **Selection mode** | `individual` (default) / `bundle` | **Individual:** each member's office coffee is their own (starting from office defaults). **Bundle:** you pick **one** office coffee and *everyone* gets it. |
| **Member self-select** | on (default) / off | Whether members may **choose or edit** their own office coffee. Only meaningful in individual mode. Turn it off to lock everyone to the office default. |
| **Member can decline** | on (default) / off | Whether a member (or you, on their behalf) may **skip** a day's office coffee. Turn it off and office coffee always goes out on schedule. |

> **"Bundle" ≠ "Vendor Pack."** *Bundle* is this owner setting — one drink for
> everyone. A *Vendor Pack* (§9) is a vendor's discounted multi-coffee product.
> They're different things.

When in bundle mode, set the **bundle coffee** (drink/size/milk/sugar/strength)
right below the autonomy controls and save it — that's what the whole team gets.

---

## 5. Joining a Team

### The join code (Owner)
Under **Join code**, click **Generate join code** to mint a standing **reusable**
code. From there you can:

- **Copy** it to share with staff (Slack, email, a poster in the kitchen…).
- **Rotate** it — generates a fresh code and deactivates the old one (the company
  always has exactly one live standing code).
- **Revoke** it — turns it off entirely.
- See how many people have **joined** against an optional **redemption cap** (a
  join limit you can set if you want to cap headcount).

There are also **single-use** invite codes for tighter control (one redemption
each), minted alongside the reusable code.

No emails to manage, and you never need to know a member's login.

### Redeeming a code (Member)
A staff member goes to **Dashboard → Office coffee**, finds **Join a company**,
and enters the code:

- If they **already have a BrewPass account**, it's **linked** — their personal
  coffee stays exactly as it was.
- If they **don't**, they sign up first, then link.

Redeeming creates an **active membership** and seeds their office coffee from
your office defaults. Their **personal account is untouched**.

Members see all the offices they belong to under **Your offices**.

---

## 6. The Member Experience

A member with office coffee sees, on their main dashboard:

- **Office coffee tracker** — a compact, at-a-glance list of their office
  coffees: *"Arriving ~9:05 · Flat White · Level 12"*, with a status
  (*Scheduled → Confirmed → Being made → On its way → Delivered*). While a coffee
  is **out for delivery**, an optional **live map** shows the driver — but staff
  who don't want the map never have to open it.
  > **Note on consolidated delivery:** the tracker is designed to be
  > forward-compatible with multi-vendor consolidated delivery (Phase L.1/L.2
  > foundation is built). When an office team eventually receives coffees from
  > multiple vendors in one drop, this view will show the run-level status rather
  > than assuming one delivery = one order. For now every office order is its own
  > individual delivery.
- **Same-day overlap notice** (advisory only) — if a member would get **both** a
  personal coffee and an office coffee on the same day, they're *informed* and
  offered a one-tap **"cancel one."** The **default is to keep both** (they're on
  different cards, so there's no billing conflict). They are **never forced** to
  choose. If someone repeatedly cancels one side, they can set a **standing rule**
  ("on office-coffee days, skip my personal coffee") so they're never asked again.
- **Office coffee** card — a link to **Office coffee** to join a company or, if
  they're an owner, manage the team.

**What a member can do** depends on the owner's autonomy rules:

- Where **self-select** is on, a member may set their own office drink (starting
  from the office defaults) instead of taking the default.
- Where **decline** is on, a member may skip a day's office coffee.
- Either way, edits are allowed **until that day's 6:00 AM cutoff**, like
  everything else on BrewPass.

The "user does nothing daily" promise holds for office coffee too: once set up,
coffee just shows up on schedule with zero daily interaction.

---

## 7. Owner Visibility & Control

The **Team** table on the owner dashboard shows, per member:

- Whether they've **joined** and whether they've **set up** their office coffee.
- **Today's** and **tomorrow's** selection and intent — **Want**, **Skipped**, or
  the live order status — plus the drink.

Where your autonomy rules allow it, you can **toggle want/skip on a member's
behalf** straight from the table (e.g. mark someone "skip" while they're on
leave). If **member can decline** is off, the skip control isn't offered.

---

## 8. Billing — How the Company Pays

Office coffee uses the same **charge-then-deliver** model as personal coffee, but
on the **company card**:

1. **Generation (night before, 8:00 PM KL).** For every eligible active member
   whose office schedule includes tomorrow, the system creates a scheduled office
   order, routes it to a vendor, and snapshots the drink, vendor, and price.
   *Eligibility:* the company has a card on file **and** office defaults
   configured, and the member's office schedule includes that day.
2. **Cutoff (6:00 AM KL).** The **company card** is charged for that day's office
   coffee. **The order is only sent to the vendor if the charge succeeds** —
   vendor handoff is gated on the charge clearing.
3. **Delivery.** The vendor makes it and a courier delivers it (tracked live, as
   for personal coffee).
4. **Payout (delivery-gated).** The vendor is paid only **after** the coffee is
   confirmed delivered. The company's money is held on the platform until then.

### Strict card separation (a hard rule)
- **Personal coffee → the member's own card.**
- **Office coffee → the company card.**
- These are **never** crossed. The member's personal card is **never** charged
  for an office coffee, and the company card is **never** charged for a personal
  coffee — under any circumstance.

### When the company card fails
If a charge fails at cutoff, BrewPass **retries 3 times over ~10 minutes** (about
0, 3, and 10 minutes). If it still fails:

- **Only that day's office coffee** for the affected member(s) is **skipped** —
  the rest of the team is unaffected.
- The **team admin (owner) is notified immediately** (a company-card failure
  affects many people, so you're alerted fast to fix the card), and the affected
  **member(s) are notified** too.
- **Personal coffees are completely unaffected** — they're on personal cards. One
  company-card failure never touches anyone's personal coffee.
- The whole company is **not** frozen over a single failed day.

### When a coffee is charged but not delivered
Because the company is charged **before** delivery, a paid-for office coffee can
still fail to arrive (vendor problem, courier can't reach the office, etc.). When
that happens:

- The company card is **automatically refunded in full** for that coffee.
- The owner (and the affected member) get an **apology + the reason**.
- The vendor was never paid (payout is delivery-gated), so there's nothing to
  claw back.

> No seats, no per-person monthly fee, no prepaid quota. You pay for delivered
> coffees and nothing else.

---

## 9. Vendor Packs (Optional Savings)

A **Vendor Pack** is a vendor's discounted, time-boxed multi-coffee product
(e.g. *"a 10-pack for RM12 less than 10 individual coffees"*). Packs are surfaced
to the team admin as **optional savings nudges** — your default flow is always
the simple one-tap "buy the usual." Packs reward the admin who looks; they never
force comparison shopping.

> Packs are an **office-buying** feature, bought by the team admin for the
> company card.

### Buying a Pack
On the owner dashboard, the **office pack** panel shows packs available from
in-range vendors for a chosen day. To buy:

1. Pick a pack.
2. **Select members** to cover. The first `packSize` members fill the pack; if
   your team is **larger than the pack** (e.g. 12 members, a 10-pack), the extra
   members become normally-routed **top-up** coffees — one purchase, covering
   everyone.
3. Buy. The company card is charged at cutoff for **(pack price + top-ups)**.
   Each underlying coffee is still its own **delivery-gated** order for payout.

### Pack modes
- **Fixed drink** — the same coffee × N (drink is set by the vendor).
- **Buyer's choice** — you pick the drinks from that vendor's menu; the count is
  locked to the pack size.

### The fine print
- **Editable until cutoff.** Assignments can be changed until that day's cutoff.
  Removing a member before cutoff frees their slot.
- **Paid-for-and-skipped slots are fine.** If you don't assign every slot, the
  unassigned ones are simply paid-and-skipped — the discount still beats buying
  per coffee, so this is expected.
- **Packs are vendor-pinned.** A pack is *that vendor's* priced product, so it
  does **not** reroute to another vendor. If the pack's vendor goes offline, that
  day's pack is **skipped and refunded** and you're notified — it won't silently
  switch vendors. (This is the one place coffee isn't auto-rerouted; every
  non-pack order still reroutes normally if a vendor is unavailable.)

---

## 10. Team-Specific Guarantees

- **Membership never overrides a personal account.** Joining or leaving a company
  never changes a member's personal plan, preferences, or role.
- **Personal and office coffee are strictly separate** — different order records,
  different cards, never cross-charged. Both can happen on the same day.
- **Owner autonomy toggles are server-authoritative** — selection mode,
  self-select, and decline are enforced on the server for every member action.
- **Charge-then-deliver on the company card** — billed per delivered office
  coffee; no seats, no prepaid quota; vendor handoff gated on a successful charge.
- **Vendor payout is always delivery-gated**, refunds are automatic on
  undelivered coffee, and every charge/refund is idempotent (never double-charged
  or double-refunded).
- **A company-card failure never touches anyone's personal coffee.**
- **Vendor Packs are optional savings, never forced** — and they're vendor-pinned
  (no silent reroute).

---

## 11. Quick FAQ

**Do I pay a monthly fee per employee?**
No. There are no seats and no per-head subscription. You pay only for office
coffees that are actually delivered, on the company card.

**Can a staff member keep their personal BrewPass plan?**
Yes — fully. Joining your company never touches their personal account. They can
even get a personal *and* an office coffee on the same day (different cards).

**How do people join?**
You share a join code; they enter it in the app. No email management.

**Can I force everyone to get the same coffee?**
Yes — switch selection mode to **bundle** and set the bundle coffee.

**Can I stop members editing or skipping?**
Yes — turn off **member self-select** and/or **member can decline**. Both are
enforced server-side.

**What if the company card fails?**
We retry 3 times over ~10 minutes, then skip just that day for the affected
member(s) and alert you immediately. Personal coffees are never affected.

**What happens if a coffee is paid for but not delivered?**
The company card is automatically refunded in full, with an apology and reason.

---

*This guide reflects the current marketplace build's office/team feature
(Phases J and K). For the personal subscriber experience, vendor details,
routing, and platform internals, see the main [USER_GUIDE](./USER_GUIDE.md). For
the developer-facing product spec and build phases, see
[CLAUDE.md](./CLAUDE.md).*
