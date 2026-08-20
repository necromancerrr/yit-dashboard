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
- `APP_TIMEZONE` — your timezone (e.g. `America/New_York`). This decides when the day
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
volume at `/app/db`. Set `APP_TIMEZONE` too, and pass
`NEXT_PUBLIC_DISPLAY_NAME` as a *build argument* — it is compiled into the
bundle, so setting it only at run time won't change the name on screen.

**Railway** specifically: create a new project from this GitHub repo, add a
volume mounted at `/app/db`, and set `AUTH_SECRET` + `APP_PASSWORD` (or
`APP_PASSWORD_HASH`) as environment variables. Railway detects the Dockerfile
automatically.

### Option B — Vercel (serverless) + Turso

Vercel's filesystem is ephemeral, so a local SQLite file won't persist there.
Use [Turso](https://turso.tech) (free tier, SQLite-compatible, built on the
same libSQL client this app already uses — **no code changes**).

**1. Create the database**

```bash
turso db create yit-dashboard
turso db show yit-dashboard --url      # -> DATABASE_URL
turso db tokens create yit-dashboard   # -> DATABASE_AUTH_TOKEN
```

There is no migration step to run: the tables are created on the first
request that touches the database.

**2. Import the repo into Vercel and set these environment variables**

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | from `turso db show` | starts `libsql://` |
| `DATABASE_AUTH_TOKEN` | from `turso db tokens create` | |
| `AUTH_SECRET` | `openssl rand -base64 32` | 16+ chars, or the app refuses to start |
| `APP_PASSWORD_HASH` | `node scripts/hash-password.mjs "pw"` | preferred once internet-facing |
| `NEXT_PUBLIC_DISPLAY_NAME` | e.g. `Yit` | **see the warning below** |
| `APP_TIMEZONE` | e.g. `America/New_York` | **not** `TZ` — see below |

**3. Deploy.**

#### Three things that will bite you

**`NEXT_PUBLIC_DISPLAY_NAME` is baked in at build time.** Anything prefixed
`NEXT_PUBLIC_` is substituted into the JavaScript bundle by `next build`, not
read at run time. Set it *before* your first deploy, and **redeploy** after
changing it — editing the variable alone will appear to do nothing.

**Set `APP_TIMEZONE`, not `TZ`.** Gym streaks, the activity heatmap, and the
daily checklist reset all depend on when "today" ends. `TZ` is the usual way
to tell a server that — but **Vercel reserves the name `TZ` and rejects it**,
and runs every function in UTC regardless. So the app reads its own
`APP_TIMEZONE` variable and resolves the date against that zone explicitly,
which works on any host. Leave it unset and the machine's own timezone is
used, which is what you want locally and in Docker.

**Passkeys are bound to the exact domain.** WebAuthn ties every credential to
the hostname it was created on, which is what makes it phishing-proof — and
also means a passkey registered on a `*-git-branch.vercel.app` preview URL
will **not** work on your production domain. Register your devices on the
domain you actually use. If you later add a custom domain, re-register them
there. Passkeys also require HTTPS, which Vercel gives you automatically.

### Putting it on your phone

Once deployed, open the site on your phone:

- **iPhone** — Safari → Share → *Add to Home Screen*
- **Android** — Chrome → ⋮ → *Install app*

It launches without browser chrome, with its own icon. Then sign in with your
password once, go to **Security → Add this device**, and after that you can
sign in with Face ID / Touch ID / your fingerprint. Keep the password safe: it
is the way back in if you lose every registered device.

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

Everything lives in eight SQLite tables (`gym_logs`, `leetcode_logs`,
`interviews`, `school_tasks`, `finance_transactions`, `checklist_items`,
`checklist_completions` — the per-day log behind the heatmap — and `passkeys`
for biometric sign-in). See `src/lib/db.ts` for the schema. Add a column or
table there, add a route in `src/app/api/`, and a page/component to surface
it; the pattern is the same across every section.

Note that the SQL is written in SQLite's dialect (`AUTOINCREMENT`,
`datetime('now')`, `INSERT OR IGNORE`, `?` placeholders). That is what makes
Turso a drop-in and what a move to Postgres would have to translate — roughly
60 query sites across the API routes.
