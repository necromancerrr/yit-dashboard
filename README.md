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
volume at `/app/db`.

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

All four variables are required. `DATABASE_URL` in particular is not optional
on Vercel — without it the build fails on purpose (see `src/lib/db.ts`) rather
than falling back to a local SQLite file that the serverless filesystem would
throw away between requests.

#### Deploying from the command line

If you'd rather not click through the dashboard, the same thing from a
terminal — run this from the repo root, on a machine that's logged into
Vercel:

```bash
npm i -g vercel
vercel login
vercel link                      # create/attach the project

# one line per secret; paste the value when prompted
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel env add AUTH_SECRET production        # openssl rand -base64 32
vercel env add APP_PASSWORD_HASH production  # node scripts/hash-password.mjs "your password"

vercel --prod
```

Repeat the `env add` lines with `preview` instead of `production` if you also
want preview deployments (branch pushes) to work — they get a separate
environment and will otherwise fail the build on the missing `DATABASE_URL`.

#### If the deploy still fails

- **Build error mentioning `DATABASE_URL`** — the variable isn't set for the
  environment being built. Check `vercel env ls`; note that Preview and
  Production are separate.
- **`AUTH_SECRET env var must be set...`** — same cause, for `AUTH_SECRET`.
  It has to be at least 16 characters.
- **Login page rejects your password** — `APP_PASSWORD_HASH` takes precedence
  over `APP_PASSWORD`. If both are set, only the hash is checked.
- **Environment variables changed but nothing improved** — Vercel bakes env
  vars in at build time, so you need a fresh deploy (`vercel --prod`, or
  "Redeploy" in the dashboard) after editing them.

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
    types.ts               # shared types
  proxy.ts                 # route protection (Next.js 16's proxy.js, formerly middleware)
scripts/hash-password.mjs  # generate APP_PASSWORD_HASH
```

## Extending it

Everything lives in six SQLite tables (`gym_logs`, `leetcode_logs`,
`interviews`, `school_tasks`, `finance_transactions`, `checklist_items`) —
see `src/lib/db.ts` for the schema. Add a column or table there, add a route
in `src/app/api/`, and a page/component to surface it; the pattern is the
same across every section.
