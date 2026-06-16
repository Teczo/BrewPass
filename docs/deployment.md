# BrewPass — Production Deployment Guide (v2 Marketplace)

This guide covers the **v2 multi-vendor marketplace** (including the **v2.1**
courier + AI-menu additions). It supersedes the single-vendor v1 guide: v2
adds a vendor portal, an order-routing engine, a standardized menu taxonomy,
the AI vendor recommender, monthly lists, and **Stripe Connect** payouts;
v2.1 adds **courier-integrated delivery + in-app tracking** (§6b) and
**AI-assisted menu onboarding** (folded into §9b). If you ran the v1
deployment already, the new pieces are §4b (Connect), §6b (courier),
§9b (Anthropic), the third cron in §2, and the first-run **migrations** in
§10 — skim those and skip the rest. All of v2.1 is optional and degrades to
the v2 behaviour when unconfigured.

One Vercel project hosts everything (frontend pages, API routes, cron
jobs). Every other service is SaaS you configure once and connect via
environment variables.

Architecture recap:

| Concern                          | Service              | Where configured              |
| -------------------------------- | -------------------- | ----------------------------- |
| Frontend + backend               | Vercel (Next.js)     | §2                            |
| Database                         | MongoDB Atlas        | §1                            |
| Auth (user/vendor/admin)         | Auth0                | §3                            |
| Subscriptions + card             | Stripe               | §4                            |
| Vendor payouts                   | Stripe **Connect**   | §4b                           |
| Push notifications               | Firebase (FCM)       | §5                            |
| Geocoding, routing + map         | Google Maps Platform | §6                            |
| Courier delivery (optional)      | Lalamove             | §6b                           |
| SMS (optional)                   | Twilio               | §7                            |
| Email (optional)                 | Resend               | §8                            |
| Error monitoring                 | Sentry               | §9                            |
| AI recommender + menu onboarding | Anthropic            | §9b                           |
| Scheduled jobs                   | Vercel Cron          | automatic from vercel.json    |
| Weather                          | Open-Meteo           | nothing — keyless             |
| File storage                     | Vercel Blob          | not used yet; add when needed |

Work top to bottom. §1–§3 are required for the app to boot and log in.
§4 + §4b enable billing and payouts (the marketplace can't move money
without both). The rest can be added incrementally — every integration
degrades gracefully when unconfigured (the AI recommender even falls back
to a deterministic scorer, see §9b).

---

## 0. Merge the branch

Vercel deploys production from `main`. Merge the v2 marketplace branch
(`v2-marketplace` → `main`) before the production deploy. v2 is an additive
refactor over v1; the Phase A migration in §10 is what diverges the data.

## 1. MongoDB Atlas (database)

1. https://cloud.mongodb.com → create a project → **Build a Database** →
   M0 (free) → region **Singapore (ap-southeast-1)** — closest to KL.
2. **Database Access** → Add New Database User → password auth, role
   "Read and write to any database". Save the password.
3. **Network Access** → Add IP → **0.0.0.0/0** ("allow from anywhere").
   Vercel functions have no fixed IPs; access is protected by the
   credential. (Tighten later with the Vercel↔Atlas integration or
   private endpoints on a paid tier.)
4. **Connect → Drivers** → copy the connection string.

Env vars produced:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=brewpass
```

v2 adds several collections (`vendors`, `optionTaxonomy`, `vendorMenuItems`,
`monthlyLists`, `vendorPayouts`, `commissionConfig`, `ratings`,
`deliveries`, `preferenceSignals`, …). You don't create them by hand —
they're provisioned with their indexes by **Set up DB indexes** in §10.

## 2. Vercel (frontend + backend + cron)

1. https://vercel.com/new → import the `Teczo/BrewPass` GitHub repo.
   Framework is auto-detected (Next.js). Don't deploy yet — add env
   vars first (Project → Settings → Environment Variables, target
   "Production"). Paste everything from `.env.example` that you have so
   far; you'll add the rest as you complete the sections below.
2. Generate the two secrets you own:
   ```bash
   openssl rand -hex 32   # AUTH0_SECRET
   openssl rand -hex 32   # CRON_SECRET (different value)
   ```
3. Deploy. Note your production URL (e.g. `https://brewpass.vercel.app`
   or a custom domain — add the domain under Settings → Domains first
   if you have one, and use it consistently everywhere below).
4. Set `APP_BASE_URL=https://<your-domain>` (no trailing slash) and
   redeploy. Connect onboarding links (§4b) are built from this value,
   so it must be correct.
5. **Cron jobs** register automatically from `vercel.json` — there are now
   **three**:
   - `/api/cron/generate-orders` at 12:00 UTC (= 20:00 KL, night-before):
     creates tomorrow's vendor-assigned orders from confirmed monthly
     lists / subscriptions, then sends night-before notifications.
   - `/api/cron/cutoff` at 22:00 UTC (= 06:00 KL): locks each order,
     **charges the user for that one coffee into the platform balance**,
     and decrements quota — exactly once per order.
   - `/api/cron/payouts` at 15:00 UTC (= 23:00 KL): sweeps each vendor's
     **delivered, charged, unpaid** orders into transfers to their
     connected account (delivery-gated; see §4b).
     Vercel calls all three with `Authorization: Bearer $CRON_SECRET`.
     Plan note: the cron routes request `maxDuration = 300`, which needs
     the Pro plan (or Fluid compute) once you have real volume. For early
     testing, Hobby works.
6. Smoke test: `https://<domain>/api/health` should return
   `{"ok":true,"db":"up"}`. If `db: "down"`, re-check §1 credentials.

## 3. Auth0 (login — user, vendor, admin)

1. https://manage.auth0.com → create a tenant (region: Australia or
   Japan — closest options to MY).
2. Applications → **Create Application** → "BrewPass" → **Regular Web
   Application** → settings:
   - **Allowed Callback URLs**: `https://<domain>/auth/callback`
   - **Allowed Logout URLs**: `https://<domain>`
   - (For local dev add `http://localhost:3000/auth/callback` and
     `http://localhost:3000` too.)
3. Copy from the application's Settings tab:

```
AUTH0_DOMAIN=<tenant>.au.auth0.com        # no https://
AUTH0_CLIENT_ID=...
AUTH0_CLIENT_SECRET=...
AUTH0_SECRET=<the openssl value from §2>
APP_BASE_URL=https://<domain>
```

4. Redeploy, open the site, click **Log in / Sign up**, create your own
   account, and complete onboarding. This creates your User document.

Roles (`individual` | `vendor` | `admin`) live on the User document, not
in Auth0 — no Auth0 rules/actions are required. Admins are set once (below);
the **vendor** role is granted automatically when an admin approves a
vendor application (§10), and portal access is scoped to that vendor.

### Bootstrap the first admin (one-time)

In Atlas: Browse Collections → `brewpass.users` → find your document →
edit `role` from `"individual"` to `"admin"`. Then open
`https://<domain>/admin` and run the one-time setup in §10.

## 4. Stripe — subscriptions & per-day charging

Use **test mode** first; repeat with live keys when ready.

1. https://dashboard.stripe.com → Developers → API keys:

```
STRIPE_SECRET_KEY=sk_test_...          # later sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

2. Developers → **Webhooks** → Add endpoint:
   - URL: `https://<domain>/api/webhooks/stripe`
   - Events:
     - `checkout.session.completed` — saves the card on file (SetupIntent)
     - `customer.subscription.created`, `customer.subscription.updated`,
       `customer.subscription.deleted`
     - `invoice.paid`, `invoice.payment_failed`
     - `account.updated` — Connect onboarding/capability changes (§4b)
     - `charge.dispute.created` — triggers refund + transfer reversal (§4b)
   - **Also enable "Listen to events on Connected accounts"** on this
     endpoint so `account.updated` for vendors' Express accounts reaches
     it. (Alternatively add a second Connect-scoped endpoint at the same
     URL — the handler is the same.)
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET=whsec_...`
3. **No product setup needed** — subscription products/prices self-provision
   on first checkout via lookup keys, in MYR at the confirmed prices.

**Charging model (v2 — important).** The user is **not** charged the month
upfront. At signup the card is validated and saved via a Stripe SetupIntent
(Checkout in `setup` mode → `checkout.session.completed`); no charge yet.
Then **each day's cutoff charges the user for that one coffee** into the
**platform balance** and locks the order. Charging is fully automatic — the
user does nothing daily. Any "monthly" feel is a statement/summary, never an
upfront charge.

4. Test: subscribe with card `4242 4242 4242 4242` (any future expiry/CVC).
   Confirm the plan shows "Active", the card is saved, and the webhook
   deliveries show 200s. Then run the cutoff cron (see §11) and verify a
   per-day PaymentIntent was created against the saved card.
5. Going live: Stripe Malaysia account activation (business details), swap
   to live keys, and create a **second** webhook endpoint in live mode
   (signing secrets differ per mode). Enable Connect (§4b) in live too.

## 4b. Stripe Connect — vendor payouts (critical)

Vendors are onboarded as Stripe **Express connected accounts**. Stripe
collects and holds all bank/KYC data — BrewPass never stores payout details.

1. In the Stripe Dashboard, enable **Connect** (Connect → Get started).
   Choose the platform profile; Express accounts are created by the app.
   No extra env var is needed beyond `STRIPE_SECRET_KEY` (the same key
   creates connected accounts and transfers).
2. Set the Connect branding/business name so vendors see "BrewPass" on the
   Stripe-hosted onboarding pages.
3. Vendors onboard themselves from the vendor portal (`/vendor/profile` →
   "Connect payouts"). The app:
   - creates an Express account (country `MY`, `transfers` capability) and
     returns a Stripe-hosted onboarding link (built from `APP_BASE_URL`),
   - mirrors the account's `charges_enabled` / `payouts_enabled` flags from
     the `account.updated` webhook — this is the "can this vendor be paid?"
     gate.

**Money flow (hold then release).** The user is charged at cutoff into the
**platform balance** (§4). The vendor's share is transferred to their
connected account **only after delivery is confirmed**, net of commission —
the Grab/Uber model. Separate charges and transfers are used (not card auth
holds). **No delivery → no transfer**, regardless of payout cadence.

- **Payout cadence** is the vendor's choice in their portal: `per_order`
  (transfer per completed delivery) or `daily_batch` (default — one sweep of
  the day's delivered funds, via the payouts cron in §2).
- **Commission** = platform default + optional per-vendor override, set in
  `/admin` (Commission panel). Retained by the platform on each transfer.
- **Refunds / disputes:** a failed/no-show delivery → no transfer; refund or
  credit the user. A delivered-then-disputed charge (`charge.dispute.created`)
  → refund the user **and reverse the vendor transfer**. All transfer/refund
  actions are idempotency-keyed.

Test Connect end-to-end in test mode: onboard a test vendor (Stripe provides
test KYC values), let an order reach `delivered`, then run the payouts cron
(§11) and confirm a transfer appears on the connected account.

## 5. Firebase (FCM push)

1. https://console.firebase.google.com → create project "brewpass".
2. **Server credentials** (used by the nightly notification job):
   Project settings → Service accounts → **Generate new private key**.
   From the downloaded JSON:

```
FIREBASE_PROJECT_ID=<project_id>
FIREBASE_CLIENT_EMAIL=<client_email>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

In Vercel, paste the private key as-is with literal `\n` sequences —
the code converts them.

3. **Client config** (for the mobile apps / future web push): Project
   settings → Your apps → add a Web app → copy the
   `NEXT_PUBLIC_FIREBASE_*` values; Cloud Messaging tab → Web Push
   certificates → generate → `NEXT_PUBLIC_FIREBASE_VAPID_KEY`.
4. Tokens are registered automatically by the native apps
   (`/api/me/fcm-token`); nothing else to wire. Native app setup
   (google-services.json, APNs key) is in `docs/mobile.md`.

## 6. Google Maps Platform (geocoding + routing distance)

1. https://console.cloud.google.com → create/select a project → enable
   the **Geocoding API** (billing account required; $200/month free
   credit covers MVP volume comfortably).
2. Credentials → Create API key. Restrict it:
   - API restriction: Geocoding API only.
   - Application restriction: **None** (it's used server-side only; the
     key never reaches a browser).

```
GOOGLE_MAPS_API_KEY=...
```

In v2 this key is used not just for subscriber delivery locations but also
to geocode **vendor addresses** and to compute **routing distances**
(subscriber ↔ vendor) for the routing engine and the AI recommender. It's
effectively required for vendor onboarding and order routing.

3. **Client map key (v2.1 — for in-app delivery tracking).** The live
   tracking map (§6b) renders in the browser, so it needs a **separate**,
   browser-exposed key. Enable the **Maps JavaScript API**, create a second
   key, and restrict it by **HTTP referrer** (your domain) — never reuse the
   server geocoding key here.

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...
```

If unset, tracking falls back to the courier's hosted tracking link instead
of the embedded map — nothing breaks.

## 6b. Courier delivery — Lalamove (optional, v2.1)

By default vendors **self-deliver** (manual mode): the vendor marks the
order delivered in their portal. v2.1 adds on-demand courier dispatch so a
vendor can hand the coffee to a courier instead, with live in-app tracking.
Lalamove is the implemented adapter; a vendor with no courier configured
stays on the manual path, exactly like the best-effort SMS/email senders.

1. https://developers.lalamove.com → create an app → get the API key/secret
   for the **sandbox** first, then production. Set:

```
LALAMOVE_API_KEY=...
LALAMOVE_API_SECRET=...
LALAMOVE_BASE_URL=https://rest.sandbox.lalamove.com   # prod: https://rest.lalamove.com
LALAMOVE_MARKET=MY
LALAMOVE_SERVICE_TYPE=MOTORCYCLE
LALAMOVE_WEBHOOK_SECRET=                               # falls back to LALAMOVE_API_SECRET
COURIER_PLATFORM_PHONE=+60123456789                    # sender phone on dispatch
```

The adapter is "configured" only when both `LALAMOVE_API_KEY` and
`LALAMOVE_API_SECRET` are set; `BASE_URL`/`MARKET`/`SERVICE_TYPE` have the
defaults shown.

2. **Webhook** (the money-gating delivery signal — treated like the Stripe
   webhook): in the Lalamove dashboard register the status webhook to:
   - URL: `https://<domain>/api/webhooks/courier/lalamove`
   - The handler verifies the signature, is idempotent, and tolerates
     retries/out-of-order events. A `delivered` event **releases the
     (delivery-gated) payout**; a `failed` event **refunds the day**. It
     returns 2xx for events it can't act on and 5xx only for genuine
     failures it wants retried — so the provider keeps the URL enabled.
3. **Per-vendor selection:** a vendor's `courierProvider` (`lalamove` |
   `manual`) is set in their portal. At handoff a courier vendor's order is
   dispatched — re-quoted at dispatch time, with a per-order idempotency key
   so the provider never double-books; manual vendors get the legacy
   pending-delivery flow.
4. **Tracking:** customers track in-app at the order's tracking view, backed
   by `GET /api/orders/:id/tracking`, which refreshes a stale driver
   position from the courier on read and falls back to the hosted link. The
   embedded map needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (§6).
5. **Dispatch-failure policy:** if a courier dispatch fails after its
   retries, the order is failed and the day refunded (no coffee → no
   charge). Admins can re-dispatch or force-deliver a stuck order from
   `/admin` (§12).

Test in sandbox: take a vendor to `courierProvider: lalamove`, push an order
to handoff, confirm a courier order is created, then POST a signed
`delivered` event to the webhook and confirm the payout released; POST a
`failed` event on another order and confirm the refund.

## 7. Twilio (optional — delivery SMS)

1. https://console.twilio.com → get Account SID + Auth Token, buy/claim
   a sender number (or use an alphanumeric sender ID where allowed).

```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...   # or +60 number / sender ID
```

If unset, SMS steps log and skip — nothing breaks.

## 8. Resend (optional — email)

1. https://resend.com → add and verify your sending domain (DNS records)
   → create an API key.

```
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=BrewPass <hello@yourdomain.com>
```

If unset, the night-before email is skipped (push/SMS still work).

## 9. Sentry (error monitoring)

1. https://sentry.io → create a Next.js project → copy the DSN.
2. For source-map upload, create an auth token (org-level, scopes:
   `project:releases`, `org:read`).

```
NEXT_PUBLIC_SENTRY_DSN=https://...ingest.sentry.io/...
SENTRY_ORG=<org-slug>
SENTRY_PROJECT=<project-slug>
SENTRY_AUTH_TOKEN=sntrys_...
```

All optional — the app runs without Sentry; with the DSN set, client,
server, and edge errors are captured automatically.

## 9b. Anthropic (optional — AI recommender + menu onboarding)

One key powers two server-only AI features:

- **AI vendor recommender** — the hybrid selection lets a subscriber answer
  a short priorities questionnaire (proximity, price, speed, rating, drink)
  and get a recommended vendor. The recommendation is **advisory** — it
  takes effect only after the user reviews and confirms it.
- **AI-assisted menu onboarding (Phase C.5)** — a vendor uploads a menu
  screenshot (e.g. their Grab/Uber listing) and the model extracts the items
  and maps each onto the platform taxonomy, turning onboarding into a quick
  review. The vendor reviews/edits the draft and confirms before anything is
  published; the screenshot is processed in-request and **never persisted**.

```
ANTHROPIC_API_KEY=sk-ant-...
```

If this key is **unset** (or a call fails): the recommender automatically
falls back to a deterministic, priority-weighted scorer (selection never
blocks on the model), and menu onboarding cleanly reports that AI extraction
is unavailable so the vendor maps their menu manually. So the key is
genuinely optional — set it to enable both AI paths. Both are server-only.

## 10. First-run setup (indexes, migrations, first vendor)

Open `https://<domain>/admin` as the admin you bootstrapped in §3. The
header has three one-click buttons — **run them in this order** (all are
idempotent and safe to re-run):

1. **Set up DB indexes** — creates every index the app relies on, including
   the unique keys that make order generation, payouts, and webhook
   handling idempotent. Do not skip this. **Re-run it after upgrading to
   v2.1** too: it adds the new `vendorMenuDrafts` and courier-delivery
   indexes (it's idempotent, so re-running is always safe).
2. **Seed menu taxonomy** (Phase C) — seeds the canonical `OptionTaxonomy`
   (drinks, sizes, milks, add-ons, strength) that all subscriber
   preferences and vendor menus reference, and absorbs any legacy v1
   preference values. Vendors map their offerings onto this taxonomy.
3. **Migrate cafés → vendors** (Phase A) — **only if you are upgrading an
   existing v1 database.** Copies each v1 café into `vendors` (same `_id`,
   so order references stay valid) and rekeys orders `cafeId → vendorId`.
   Your own operation becomes **Vendor #1** — no special-casing. The `cafes`
   collection is left as a rollback backup. On a brand-new database there
   are no cafés to migrate, so this is a no-op.

Rollback (both migrations) is a deliberate API call, not a button:
`POST /api/admin/migrations/phase-a` (or `phase-c`) with
`{"direction":"down"}` as admin — use it only together with a rollback to
v1 code.

### Standing up Vendor #1 / new vendors

- **Fresh install (no v1 data):** create the operator's own vendor through
  the normal flow — `/vendor/apply` (business info, address, hours,
  capacity, service-area radius) → approve it in `/admin`. That is Vendor #1.
- **Upgrade:** Phase A already created Vendor #1 from your v1 café.

For each active vendor (including Vendor #1): set up the **menu** at
`/vendor/menu` (map offerings to the taxonomy, prices, availability — or use
**AI menu onboarding** to extract it from a screenshot if §9b is
configured), choose a **delivery mode** (self-deliver vs Lalamove courier,
§6b), and complete **Connect onboarding** (§4b) at `/vendor/profile` so
payouts can flow. Orders won't route to a vendor that is offline, has no
menu coverage for the drink, or is over capacity.

New third-party vendors self-serve: any logged-in user applies at
`/vendor/apply` → an admin approves in `/admin` (this grants the `vendor`
role and portal access) → the vendor configures menu, capacity, hours,
service area, and Connect.

## 11. Post-deploy verification checklist

Run through in order:

- [ ] `GET /api/health` → `{"ok":true,"db":"up"}`
- [ ] Admin one-time setup done: **indexes ✓**, **taxonomy seeded ✓**,
      and (upgrades only) **Phase A migrated ✓**
- [ ] At least one **active vendor** exists with a published menu and
      `payouts_enabled` Connect account (Vendor #1 at minimum)
- [ ] Sign up as a subscriber, onboard (profile → location with geocoding
      → taxonomy-based preferences), and pick a vendor — manual **and** the
      AI recommendation flow (confirm the recommendation is editable before
      it takes effect)
- [ ] Confirm a **monthly list** → individual scheduled daily orders appear
- [ ] Stripe: card saved at signup (no upfront charge); webhook deliveries 200
- [ ] Cron auth: `curl -H "Authorization: Bearer $CRON_SECRET" \
https://<domain>/api/cron/generate-orders` → JSON summary
      (wrong/missing token must give 401/503)
- [ ] Full daily loop in test: run generate-orders, see tomorrow's
      vendor-assigned order on the dashboard, run `/api/cron/cutoff` after
      06:00 KL and confirm the order locked, quota decremented, and a
      **per-day charge** to the platform balance succeeded in Stripe
- [ ] Routing fallback: take the preferred vendor offline (or over capacity)
      and confirm the order **reassigns** to another vendor
- [ ] Payout: mark an order `delivered` (vendor portal `/vendor`), run
      `/api/cron/payouts`, and confirm a transfer (net of commission) hit
      the vendor's connected account — and that an **undelivered** order
      produced **no** transfer
- [ ] Dispute path: trigger a test `charge.dispute.created` and confirm the
      user refund + transfer reversal
- [ ] Courier (if configured): set a vendor to `lalamove`, push an order to
      handoff → a courier order is created; POST a signed `delivered` event
      to `/api/webhooks/courier/lalamove` → payout releases; a `failed`
      event on another order → the day is refunded
- [ ] AI menu onboarding (if `ANTHROPIC_API_KEY` set): upload a menu
      screenshot at `/vendor/menu`, review the extracted draft, confirm, and
      see the items published (and that with the key unset it cleanly tells
      you to map manually)
- [ ] Sentry: throw a test error, see it in the dashboard

## 12. Ongoing operations

- **Routing health**: `/admin` shows reassignment rate, today's failures by
  reason, and quality-suspended vendors.
- **Vendor applications**: approve/reject in `/admin`; approval grants the
  vendor role + portal access.
- **Commission**: set the platform default and per-vendor overrides in the
  `/admin` Commission panel — never hardcode.
- **Payouts**: the payouts cron sweeps delivered funds nightly; vendors see
  earnings/statements/history at `/vendor/earnings`. Payout cadence is the
  vendor's choice (`per_order` vs `daily_batch`).
- **Failures**: `/admin` lists today's failed orders with reasons; Sentry
  catches exceptions.
- **Money refunds / disputes**: handled via Stripe (`charge.dispute.created`
  auto-reverses the vendor transfer); in-app "refund" returns quota credit.
- **New environments** (staging): repeat with a separate Atlas DB, Auth0
  application, Stripe test-mode webhook, and a Connect test platform; never
  share webhook secrets between environments. Re-run the §10 admin setup on
  each new database.
- **Courier delivery**: for courier vendors, delivery is confirmed by the
  signed courier webhook (§6b), which gates payout. When the courier
  completes but the webhook never lands, use the `/admin` order tools to
  **force-deliver** (releases payout once) or **re-dispatch** a stuck order.
- **Mobile apps**: see `docs/mobile.md` once the web deployment is stable —
  the same web build (now including the vendor and tracking UIs) loads in
  the shell.
