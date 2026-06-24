# BrewPass — Design Context Pack

This folder is the **single source of truth you feed to an AI design tool**
(Claude Design, v0, Lovable, etc.) so it understands BrewPass well enough to
redesign the three frontends:

1. **Subscriber app** (`/`, `/onboarding/*`, `/dashboard/*`) — the consumer-facing coffee subscription.
2. **Vendor portal** (`/vendor/*`) — where coffee businesses run their daily fulfillment.
3. **Admin / operator dashboard** (`/admin`) — where the platform operator runs the marketplace.

These are three distinct audiences sharing one codebase and one brand. They
should feel like one product family but are tuned very differently (delight vs.
operational density vs. control-room).

---

## What to feed the AI, and in what order

Paste/upload these, top to bottom. The four design docs here are written to be
self-contained; the product docs add depth if the tool accepts large context.

| Order | Document | Why it matters for design |
| ----- | -------- | ------------------------- |
| 1 | [`01-product-brief.md`](./01-product-brief.md) | What BrewPass is, who uses it, the value, the tone. Start here. |
| 2 | [`02-screen-inventory.md`](./02-screen-inventory.md) | Every screen in all 3 apps: route, purpose, data shown, states, components. The core redesign map. |
| 3 | [`03-design-system.md`](./03-design-system.md) | Current visual tokens + the brand direction to evolve toward. Keeps output coherent. |
| 4 | [`04-user-flows.md`](./04-user-flows.md) | Step-by-step journeys per persona, so flows (not just screens) get designed. |
| 5 | [`../../USER_GUIDE.md`](../../USER_GUIDE.md) | Deep product/business-logic reference (pricing, routing, payouts, taxonomy). Feed when you need exact behavior. |
| 6 | [`../../CLAUDE.md`](../../CLAUDE.md) | The full build spec / product decisions. Optional — most detailed, most verbose. |

**Minimum viable context:** docs 1–3. Add 4 for flows, 5 for exact rules.

---

## A starting prompt for the AI designer

> You are redesigning **BrewPass**, a daily-coffee subscription marketplace
> (Malaysia). I'm attaching a product brief, a screen inventory, a design
> system, and user flows. I want to redesign the **[subscriber app /
> vendor portal / admin dashboard]** — start with the **[screen name]** screen.
> Keep all existing functionality and states from the screen inventory; don't
> invent features. Match the brand direction in the design system. Output
> [React + Tailwind / a high-fidelity mockup]. Currency is MYR shown as
> `RM12.00`; times are Asia/Kuala_Lumpur.

Redesign **one app and one screen at a time** — the three apps have different
density and emotional targets, and trying to do all of them in one pass
produces mush.

---

## Hard constraints the design must respect (do not "design away")

These come from the product spec and are non-negotiable. The full list is in
`01-product-brief.md` §"Design guardrails", but the headline ones:

- **The subscriber does nothing daily.** The whole pitch is "set it once, coffee
  just arrives." Don't design daily approval/checkout flows — design *calm
  confirmation and easy editing before a cutoff*.
- **Money is integer sen, currency MYR**, rendered as `RM12.00`. Never invent
  other currencies or decimal coffee prices.
- **Times are Asia/Kuala_Lumpur**; the daily cutoff (default 6:00 AM) is a
  first-class concept across all three apps.
- **Three roles, three surfaces**: subscriber, vendor, admin. A vendor is just
  "Vendor #1 …N" — the platform operator's own café has no special UI.
- **Personal and office coffee coexist, never override.** A person can be both a
  personal subscriber and a company member; the two bill different cards and can
  both occur the same day. Any overlap notice is **advisory, not a daily prompt**.
- **Promotions are optional savings**, never forced comparison shopping; keep
  "Vendor Pack" (a vendor-priced product) distinct from `bundle` selection mode.
- The stack is **Next.js App Router + React + TypeScript + Tailwind**, also
  wrapped in **Capacitor** for iOS/Android — so the subscriber app must work as
  a **mobile-first** native-feeling app, not just a desktop web page.

---

## Keeping these docs current

If you change screens or flows, update `02-screen-inventory.md` and
`04-user-flows.md` so the next redesign pass starts from reality. These are
living documents, intentionally separate from the frozen product spec.
</content>
</invoke>
