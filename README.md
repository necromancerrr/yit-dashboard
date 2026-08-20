# Yit's Dashboard

A personal progress dashboard: gym streaks, LeetCode practice, interview
pipeline, school deadlines, money, and a daily checklist — with a GitHub-style
activity heatmap. Full-stack Next.js app with a real database, so every
checkmark, log, and dollar you add is saved and interactive (not a static
mockup).

## Stack

- **Next.js 16** (App Router, TypeScript, Turbopack)
- **Tailwind CSS v4** for styling
- **SQLite / libSQL** (`@libsql/client`) for storage — works as a plain local
  file with zero setup, and swaps to [Turso](https://turso.tech) (hosted
  libSQL) with just an env var change if you deploy somewhere serverless
- **Single-user password auth** via a signed, httpOnly session cookie (JWT)
- **SWR** on the client for fetching + revalidation, so the UI updates as
  soon as you add or check something off

## Running it locally

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`:

- `AUTH_SECRET` — any random string, 16+ characters (`openssl rand -base64 32`)
- `APP_PASSWORD` — the password you'll type in to sign in (quick start)
- `TZ` — your timezone (e.g. `America/New_York`). This decides when the day
  rolls over for gym streaks, the heatmap, and the daily checklist reset;
  without it the app follows the machine's timezone, which is UTC on most
  hosts.

Then:

```bash
npm run dev
```

Open http://localhost:3000 — the database (a SQLite file at `db/local.db`)
and its tables are created automatically on first request.

## Deploying it

The app needs somewhere to *persist* the SQLite file, so where you deploy
matters more than with a typical static Next.js app. Two good options:

### Option A — Docker, anywhere with a persistent volume (recommended)

Works on Railway, Fly.io, Render, a VPS, or your own machine. The included
`Dockerfile` builds a minimal standalone image; `docker-compose.yml` wires up
a named volume so the database survives restarts and redeploys.

```bash
cp .env.example .env   # fill in AUTH_SECRET and APP_PASSWORD (or APP_PASSWORD_HASH)
docker compose up -d --build
```

The app will be on http://localhost:3000. For a real deployment, point your
platform's "deploy from Dockerfile" flow at this repo and attach a persistent
volume at `/app/db`. Set `TZ` too, and pass
`NEXT_PUBLIC_DISPLAY_NAME` as a *build argument* — it is compiled into the
bundle, so setting it only at run time won't change the name on screen.

**Railway** specifically: create a new project from this GitHub repo, add a
volume mounted at `/app/db`, and set `AUTH_SECRET` + `APP_PASSWORD` (or
`APP_PASSWORD_HASH`) as environment variables. Railway detects the Dockerfile
automatically.

### Option B — Vercel (serverless) + Turso

Vercel's filesystem is ephemeral, so a local SQLite file won't persist there.
Instead, use [Turso](https://turso.tech) (free tier, SQLite-compatible,
built on the same libSQL client this app already uses — no code changes):

1. `turso db create yit-dashboard`
2. `turso db show yit-dashboard --url` → set as `DATABASE_URL`
3. `turso db tokens create yit-dashboard` → set as `DATABASE_AUTH_TOKEN`
4. Import the repo into Vercel, add `DATABASE_URL`, `DATABASE_AUTH_TOKEN`,
   `AUTH_SECRET`, and `APP_PASSWORD` (or `APP_PASSWORD_HASH`) as environment
   variables, and deploy.

## Pushing this to GitHub

This project is already a git repo with an initial commit. To publish it:

```bash
gh repo create yit-dashboard --private --source=. --remote=origin --push
# or, without the GitHub CLI:
git remote add origin https://github.com/<your-username>/yit-dashboard.git
git push -u origin main
```

## Security notes

- Set a real `AUTH_SECRET` before deploying anywhere reachable from the
  internet — the app refuses to start without one.
- Prefer `APP_PASSWORD_HASH` over plain `APP_PASSWORD` once this is
  internet-facing: `node scripts/hash-password.mjs "your password"` prints a
  bcrypt hash to use instead of storing the plaintext password in an env var.
- This is intentionally single-user (one shared password, no accounts) —
  it's a personal dashboard, not a multi-tenant app.

## Project structure

```
src/
  app/
    login/                # sign-in page
    (app)/                # everything behind auth, shares the sidebar/nav
      page.tsx            # overview: stat cards + activity heatmap
      gym/ leetcode/ interviews/ school/ finance/ checklist/
    api/                  # REST-ish route handlers, one folder per resource
  components/              # Nav, Heatmap, StatCard, Modal, etc.
  lib/
    db.ts                 # libSQL client + schema migration (runs lazily)
    auth.ts                # session cookie + password verification
    date.ts               # local-calendar date helpers (not UTC)
    types.ts               # shared types
  proxy.ts                 # route protection (Next.js 16's proxy.js, formerly middleware)
scripts/hash-password.mjs  # generate APP_PASSWORD_HASH
```

## Extending it

Everything lives in seven SQLite tables (`gym_logs`, `leetcode_logs`,
`interviews`, `school_tasks`, `finance_transactions`, `checklist_items`, and
`checklist_completions`, the per-day log behind the heatmap) —
see `src/lib/db.ts` for the schema. Add a column or table there, add a route
in `src/app/api/`, and a page/component to surface it; the pattern is the
same across every section.
