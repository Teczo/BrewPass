# BrewPass

Subscription coffee platform: users subscribe to a monthly plan and get a personalized coffee delivered at a predefined time and place every day. The night before, you're notified of tomorrow's coffee and can modify or skip; otherwise it's auto-processed at the cutoff.

See [CLAUDE.md](./CLAUDE.md) for the full product spec, tech stack, and build phases.

Redesigning the frontend? Start with the [design context pack](./docs/design/README.md) — product brief, screen inventory, design system, and user flows written to be fed into an AI design tool.

## Stack

Next.js (App Router) + TypeScript + Tailwind · MongoDB Atlas · Auth0 · Stripe · FCM · Vercel (hosting + cron) · Sentry

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your keys (MONGODB_URI at minimum)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). `GET /api/health` verifies app + database connectivity.

## Scripts

| Command                | What it does                |
| ---------------------- | --------------------------- |
| `npm run dev`          | Start the dev server        |
| `npm run build`        | Production build            |
| `npm run lint`         | ESLint                      |
| `npm run typecheck`    | TypeScript (strict, noEmit) |
| `npm run format`       | Prettier write              |
| `npm run format:check` | Prettier check              |

## Project layout

- `src/app` — routes (App Router) and API route handlers
- `src/lib/db.ts` — singleton MongoDB client (serverless-safe)
- `src/lib/models` — Zod schemas + TypeScript types for every collection
- `src/lib/collections.ts` — typed collection accessors and index definitions

## Conventions

- All money in integer minor units (sen), currency `MYR`.
- All timestamps stored in UTC; default display timezone `Asia/Kuala_Lumpur`.
- Validate all external input with Zod; never trust client data on subscription/order/payment routes.
- Secrets live in environment variables only — never commit `.env*` (the `.env.example` template is the one exception).

## Deploying to Vercel

Import the repo in Vercel, set every variable from `.env.example` in Project Settings → Environment Variables, and deploy. Sentry source-map upload activates when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are set.
