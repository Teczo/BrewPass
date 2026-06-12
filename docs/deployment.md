# BrewPass — Production Deployment Guide

One Vercel project hosts everything (frontend pages, API routes, cron
jobs). Every other service is SaaS you configure once and connect via
environment variables. Total cost to start: ~RM0 (free tiers everywhere
except a paid Vercel plan if you want long-running crons — see §2).

Architecture recap:

| Concern            | Service              | Where configured              |
| ------------------ | -------------------- | ----------------------------- |
| Frontend + backend | Vercel (Next.js)     | §2                            |
| Database           | MongoDB Atlas        | §1                            |
| Auth               | Auth0                | §3                            |
| Payments           | Stripe               | §4                            |
| Push notifications | Firebase (FCM)       | §5                            |
| Geocoding          | Google Maps Platform | §6                            |
| SMS (optional)     | Twilio               | §7                            |
| Email (optional)   | Resend               | §8                            |
| Error monitoring   | Sentry               | §9                            |
| Scheduled jobs     | Vercel Cron          | automatic from vercel.json    |
| Weather            | Open-Meteo           | nothing — keyless             |
| File storage       | Vercel Blob          | not used yet; add when needed |

Work top to bottom; only §1–§3 are required for the app to boot and log
in. §4 enables billing. The rest can be added incrementally — every
integration degrades gracefully when unconfigured.

---

## 0. Merge the branch

Vercel should deploy production from `main`. Merge PR #1
(`claude/bold-lamport-tunvpc` → `main`) first.

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
   redeploy.
5. **Cron jobs** register automatically from `vercel.json`:
   - `/api/cron/generate-orders` at 12:00 UTC (= 20:00 KL, night-before)
   - `/api/cron/cutoff` at 22:00 UTC (= 06:00 KL, lock + quota)
     Vercel calls them with `Authorization: Bearer $CRON_SECRET`.
     Plan note: Hobby allows daily crons but caps function duration —
     the cron routes request `maxDuration = 300`, which needs the Pro
     plan (or Fluid compute) once you have real volume. For early
     testing, Hobby works.
6. Smoke test: `https://<domain>/api/health` should return
   `{"ok":true,"db":"up"}`. If `db: "down"`, re-check §1 credentials.

## 3. Auth0 (login)

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

### Bootstrap the first admin (one-time)

In Atlas: Browse Collections → `brewpass.users` → find your document →
edit `role` from `"individual"` to `"admin"`. Then:

1. Open `https://<domain>/admin`.
2. Click **Set up DB indexes** (top right). This creates the unique
   indexes the system's idempotency guarantees depend on — do not skip.
3. From now on, roles, student verification, and café staff are all
   managed from this screen — no more DB edits.

## 4. Stripe (subscriptions & payments)

Use **test mode** first; repeat with live keys when ready.

1. https://dashboard.stripe.com → Developers → API keys:

```
STRIPE_SECRET_KEY=sk_test_...          # later sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

2. Developers → **Webhooks** → Add endpoint:
   - URL: `https://<domain>/api/webhooks/stripe`
   - Events: `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`,
     `invoice.paid`, `invoice.payment_failed`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET=whsec_...`
3. **No product setup needed** — products/prices self-provision on first
   checkout via lookup keys (`brewpass_lite_monthly`, `_weekday_`,
   `_premium_`, `_student_`, `_corporate_seat_`), in MYR at the
   confirmed prices.
4. Redeploy, then test: Dashboard → Billing → subscribe to Lite with
   card `4242 4242 4242 4242`, any future expiry/CVC. Verify the plan
   shows "Active" in the app, the products appeared in Stripe, and the
   webhook deliveries show 200s.
5. **Add-ons (Phase 10)**: pastries/extra drinks picked at the modify
   step are charged **off-session at the 6 AM cutoff** as PaymentIntents
   against the card saved during subscription checkout. No extra Stripe
   configuration is needed — but be aware:
   - A failed add-on charge never blocks the coffee; the add-ons are
     dropped and the order is flagged (`addOnsPaymentStatus: failed`).
   - In live mode, off-session charges can be declined by banks that
     require 3DS; Stripe retries authentication-exempt flows
     automatically where possible. Watch the failed-payments list in
     the Stripe dashboard during the first weeks.
   - Add-ons are disabled for corporate seats (the saved card belongs
     to the company).
6. Going live: Stripe Malaysia account activation (business details),
   swap to live keys, create a **second** webhook endpoint in live mode
   (signing secrets differ per mode).

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

## 6. Google Maps Platform (geocoding)

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

Without this key, adding delivery locations fails — it's effectively
required for onboarding.

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

## 10. Post-deploy verification checklist

Run through in order:

- [ ] `GET /api/health` → `{"ok":true,"db":"up"}`
- [ ] Sign up, onboard (profile → location with geocoding → preferences)
- [ ] `/admin` reachable as admin; **Set up DB indexes** clicked ✓
- [ ] Create your first café in `/admin` (orders won't generate without
      an active café!) and link a staff account
- [ ] Stripe test checkout → plan Active, webhook deliveries 200
- [ ] Cron auth: `curl -H "Authorization: Bearer $CRON_SECRET" \
https://<domain>/api/cron/generate-orders` → JSON summary
      (wrong/missing token must give 401/503)
- [ ] Force a full loop in test: with an active subscription whose
      schedule includes tomorrow, run the generate cron (above), check
      the dashboard shows tomorrow's order, then run
      `/api/cron/cutoff` after 06:00 KL and confirm quota decremented
- [ ] Add-on charge: add a pastry to tomorrow's order, run the cutoff,
      and verify the off-session PaymentIntent succeeded in Stripe
      (test mode uses the card saved at checkout)
- [ ] Sentry: throw a test error, see it in the dashboard

## 11. Ongoing operations

- **Failures**: the `/admin` screen lists today's failed orders with
  reasons; Sentry catches exceptions.
- **Money refunds**: Stripe dashboard (in-app "refund" returns quota
  credit only, by design).
- **New environments** (staging): repeat with a separate Atlas DB,
  Auth0 application, and Stripe test-mode webhook; never share
  webhook secrets between environments.
- **Mobile apps**: `docs/mobile.md` once the web deployment is stable.
