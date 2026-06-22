# BrewPass — Design System (current state + direction)

Two parts: **(A)** what's in the code today (so a redesign knows the baseline and
what to replace), and **(B)** the brand direction to evolve toward. The current
UI is essentially Next.js/Tailwind defaults — functional but unbranded. Treat
section A as inventory, section B as the brief.

---

## A. Current state (the baseline being replaced)

**Framework:** Next.js App Router + React 19 + TypeScript (strict) + **Tailwind
CSS v4** (config-less, `@import "tailwindcss"` in `globals.css`). Also wrapped in
**Capacitor** for iOS/Android.

**Type:** `next/font/google` **Geist** (sans) + **Geist Mono**. Body currently
falls back to Arial/Helvetica in `globals.css` — inconsistent, worth fixing.

**Color usage today** (raw Tailwind palette, no design tokens):

- **Primary / brand:** `amber-800` (buttons, links, accents), hover `amber-700`,
  text `amber-900`, soft backgrounds `amber-50`/`amber-100`, borders `amber-200`.
  This coffee-amber is the one piece of real brand identity present.
- **Neutrals:** `neutral-50…900` for text, borders, surfaces. `neutral-500` for
  secondary text, `neutral-200`/`300` for borders.
- **Semantic:** green (`green-100/700/800`) = delivered/success; red
  (`red-50/100/200/700/800`) = failed/danger; amber = in-progress/warning;
  neutral = skipped/inactive.

**Patterns today:**
- Cards: `rounded-md border border-neutral-200 p-4`.
- Status: pill `rounded-full px-2 py-0.5 text-xs font-medium` with semantic colors.
- Layout: centered `main` with `max-w-3xl` (subscriber) / `max-w-6xl` (vendor,
  admin), `flex flex-col gap-6 p-6`.
- Buttons: `rounded-md bg-amber-800 px-4 py-2 text-sm font-medium text-white`.
- Links: `text-sm text-amber-800 hover:underline`.
- No dark-mode handling beyond a default `prefers-color-scheme` block (unused).
- No shared Button/Card/Badge primitives — styles are inlined per page.

**Gaps to close in a redesign:**
1. No design tokens (colors/spacing/radii/typography) — everything is ad hoc.
2. No reusable primitives (Button, Card, Badge, Field, Table, Tabs, Sheet).
3. No real typographic scale or brand voice in the type.
4. Subscriber app isn't yet tuned as a mobile-first native app.
5. The three apps look identical in weight; they shouldn't.

---

## B. Brand & visual direction (the brief)

> **BrewPass should feel like a really good neighborhood café, run by software
> that never makes a mistake.** Warm and human on the subscriber side; precise
> and operational on the vendor/admin side. One family, three temperatures.

### Brand keywords
Warm · effortless · trustworthy · local · precise. Avoid: cold/corporate,
loud/gamified, fussy/overdesigned.

### Color
- **Keep the coffee-amber** as the brand anchor (today's `amber-800`-ish). Build a
  proper ramp around an espresso/amber primary plus a warm-neutral surface family
  (think paper/cream rather than pure cold gray) so the subscriber app feels cozy.
- A small **accent** (a fresh green or terracotta) for highlights and the "alive"
  moments (delivery in motion, confirmation).
- **Semantic set** (keep current meaning): success/delivered = green, danger/failed
  = red, warning/in-progress = amber, neutral/skipped = gray. Make these tokens,
  used identically across all three apps so a "failed" looks the same everywhere.
- Decide a clear stance on **dark mode** (the operational vendor board and admin
  may benefit; subscriber app likely light-first). Whatever you choose, drive it
  from tokens, not per-page classes.

### Typography
- Resolve the Geist-vs-Arial inconsistency: pick one sans for UI and commit.
- A warmer display face for subscriber hero moments is welcome (landing, "Hi,
  {name} ☕", monthly-list confirmation). Vendor/admin stay neutral and legible.
- Establish a real scale (display / h1 / h2 / body / small / mono-for-figures).
  Money and metrics read well in tabular/mono figures.

### Density per app (don't make them uniform)
- **Subscriber:** generous spacing, large touch targets, one primary action per
  screen, bottom-sheet/modal editing, mobile-first. Calm.
- **Vendor:** medium density, big legible order cards, strong status color, fast
  scanning. A working board, not a brochure.
- **Admin:** high density, real data tables with good rhythm, sticky headers,
  scannable metrics, triage colors. A control room.

### Components to standardize (cover the whole inventory)
Button (primary/secondary/ghost/danger), Card, Badge/StatusPill (with the
semantic set), Field/Input/Select/Toggle, Stepper, Stat tile, Data table
(sortable, dense), Tabs, Modal/Sheet, Map card, Empty state, Toast/Alert,
Money/figure display, Calendar/agenda (for the monthly list).

### Money, figures, time (display rules — bake into components)
- Currency **MYR**, integer **sen** under the hood, always rendered **`RM12.00`**.
- Times shown in **Asia/Kuala_Lumpur**. Surface the **daily cutoff** (default
  6:00 AM) clearly wherever editing closes or charging/locking happens.
- Percentages for quality metrics (rating to 1 decimal + ★; acceptance/on-time as %).

### Iconography & imagery
- Coffee-forward but restrained. A small, friendly icon set; avoid clip-art beans
  everywhere. Vendor logos / menu-item images are real content (Vercel Blob) —
  design slots for them.

### Motion
- Subscriber: subtle, reassuring (confirm checkmarks, the delivery tracker coming
  alive). Vendor/admin: minimal, functional. Never animation for its own sake.

### Accessibility & platform
- Mobile-first for subscriber; thumb-reachable primary actions; respect safe
  areas (notch/home indicator) since it runs in Capacitor.
- WCAG AA contrast on all semantic colors — especially the status pills.
- Don't rely on color alone for status (pair with label/icon).

---

## How to apply this with an AI design tool

1. Ask it to first produce **design tokens** (color ramps, type scale, spacing,
   radii) from section B, then the **core primitives** (Button/Card/Badge/Field/
   Table), then redesign screens from `02-screen-inventory.md` using those.
2. Redesign **one app at a time** so each app's density target stays intact.
3. Hold it to the **display rules** (RM formatting, KL time, cutoff prominence,
   delivery-gated payouts) and the guardrails in `01-product-brief.md`.
</content>
