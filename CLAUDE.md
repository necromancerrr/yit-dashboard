@AGENTS.md

# yit-dashboard

A single-user personal progress dashboard: gym logs, LeetCode practice,
interview pipeline, school deadlines, money, and a daily checklist, plus a
GitHub-style activity heatmap on the overview page. Full-stack Next.js with a
real SQLite/libSQL database — every row the UI shows is persisted and editable.

Read `README.md` for setup and deployment prose; this file is the map of *how
the code is organized and what conventions to follow when changing it*.

## Stack

| Piece | Choice |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) — **see `AGENTS.md`: this version differs from training data, check `node_modules/next/dist/docs/` before writing framework code** |
| Language | TypeScript, `strict: true`, path alias `@/*` → `./src/*` |
| UI | React 19, Tailwind CSS v4 (`@import "tailwindcss"` in `globals.css`, no `tailwind.config`) |
| Icons | `lucide-react` |
| Data fetching | SWR on the client; no server-side data fetching in pages |
| Database | `@libsql/client` — local SQLite file by default, hosted Turso via env |
| Validation | Zod v4 on every write route |
| Auth | Single shared password → signed JWT (`jose`) in an httpOnly cookie |

## Commands

```bash
npm install
cp .env.example .env.local   # then fill AUTH_SECRET + APP_PASSWORD
npm run dev                  # next dev (Turbopack) on :3000
npm run build                # next build
npm run start                # serve the production build
npm run lint                 # eslint (flat config, eslint-config-next)
node scripts/hash-password.mjs "pw"   # prints a bcrypt APP_PASSWORD_HASH
```

There is **no test suite and no typecheck script**. Before considering a change
done, run `npm run lint` and `npm run build` (the build is what surfaces type
errors).

The database file (`db/local.db`) and its tables are created lazily on the
first request — there is no migrate step to run.

## Layout

```
src/
  app/
    layout.tsx            # root: metadata from getBrandName(), globals.css
    login/page.tsx        # public sign-in page
    icon.tsx apple-icon.tsx icon-192/ icon-512/ manifest.ts   # generated PWA assets
    (app)/                # authenticated group: sidebar + ToastProvider
      layout.tsx
      page.tsx            # overview — stat cards + heatmap, reads /api/summary
      gym/ leetcode/ interviews/ school/ finance/ checklist/   # one page.tsx each
      security/             # manage passkeys (WebAuthn devices)
    api/
      auth/login  auth/logout
      auth/passkey/         # WebAuthn: login/ + register/ ceremonies, list, delete
      gym/ leetcode/ interviews/ school/ finance/ checklist/   # route.ts + [id]/route.ts
      applications/       # route.ts + [id]/route.ts + [id]/events/route.ts
      inbox/              # route.ts + [id]/route.ts (confirm / dismiss)
      today/route.ts      # ranked attention list for the Today page
      ingest/sync/route.ts # pull new mail and run the ingestion pipeline
      integrations/route.ts # connection state for external accounts
      summary/route.ts    # aggregate numbers + heatmap (now read by Growth)
      export/route.ts     # every table as one downloadable JSON file
  components/             # Nav, Heatmap, StatCard, Modal, PageHeader, EmptyState, Logo, ToastProvider
  lib/
    db.ts                 # libSQL client (global singleton) + SCHEMA + ensureDb()
    auth.ts               # password verify, JWT sign/verify, cookie options
    api-helpers.ts        # handleRoute / withDb / jsonError / todayISO
    date.ts               # local-calendar date helpers — use these, never toISOString()
    checklist.ts          # daily rollover for recurring habits
    webauthn.ts           # passkey relying-party + challenge cookie helpers
    useWebAuthnSupport.ts # useSyncExternalStore probe for browser support
    fetcher.ts            # SWR fetcher + apiPost / apiPatch / apiDelete
    identity.ts           # display/brand name from NEXT_PUBLIC_DISPLAY_NAME
    types.ts              # row interfaces mirroring the SQL schema
    career-status.ts      # pipeline vocabulary + transition rules (pure, client-safe)
    career.ts             # applyEvent() — the only writer of applications.status
    inbox.ts              # derives inbox items from existing data (no email needed)
    ai/                   # AIProvider interface + registry; server-only, optional
    ingest/               # mail -> classify -> match -> propose/apply
      normalize.ts        #   pure string work (forwards, senders, companies)
      classify.ts         #   deterministic rules; null means "ask the model"
      match.ts            #   which application a message belongs to
      pipeline.ts         #   orchestration + dedupe (the only db writer here)
      gmail.ts            #   Gmail REST client; metadata only, never bodies
    useUndoableDelete.ts  # optimistic delete with a 5s undo window
  proxy.ts                # auth gate (Next.js 16 renamed middleware.ts → proxy.ts)
scripts/hash-password.mjs
```

## How the pieces fit

### Auth
`src/proxy.ts` runs on every non-static request. Public paths are `/login`,
`/api/auth/login`, `/manifest.webmanifest`, and anything under `/icon*` /
`/apple-icon*` (browsers fetch icons before auth). Everything else requires a
valid `dash_session` cookie: unauthenticated API requests get a 401 JSON body,
page requests get redirected to `/login?next=<path>`.

Because the proxy gates all of `/api`, **individual route handlers do not
re-check auth** — don't add per-route auth checks, and don't add a new public
path without updating `PUBLIC_PATHS`/`PUBLIC_PREFIXES` deliberately.

`verifyPassword` prefers `APP_PASSWORD_HASH` (bcrypt) and falls back to plain
`APP_PASSWORD`. `AUTH_SECRET` must be ≥16 chars or `getSecret()` throws.

**Passkeys (WebAuthn).** A second way to mint the *same* `dash_session` cookie,
so nothing downstream of the proxy knows passkeys exist. Each ceremony is two
routes — options (issue a challenge) then verify (check the signature):

- `/api/auth/passkey/login/{options,verify}` — **public**, listed by exact path
  in `PUBLIC_PATHS`. Never widen this to a `/api/auth/passkey` prefix: that
  would expose the register routes and let anyone enrol their own device.
- `/api/auth/passkey/register/{options,verify}` — session-gated, so enrolling a
  device requires already being signed in with the password.
- `GET /api/auth/passkey` + `DELETE /api/auth/passkey/[id]` — manage devices;
  the list deliberately omits `credential_id` and `public_key`.

`src/lib/webauthn.ts` derives `rpID`/`origin` from the request (no env var to
keep in sync across localhost, previews, and production) and holds the
challenge in a 5-minute httpOnly cookie. Only public keys are stored; the
counter is updated on each login for clone detection. Requires HTTPS in
production — WebAuthn refuses to run on a plain LAN address.

### Database
`src/lib/db.ts` exports a module-level `db` client cached on `globalThis` so
dev hot-reloads don't open new connections. The whole schema lives in the
`SCHEMA` template string as `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT
EXISTS` statements, split on `;` and executed once by `ensureDb()` (memoized on
`globalThis.__dashboardDbReady`).

Eight tables: `gym_logs`, `leetcode_logs`, `interviews`, `school_tasks`,
`finance_transactions`, `checklist_items`, `checklist_completions`, `passkeys`.
`snake_case` columns; dates are `TEXT` ISO `YYYY-MM-DD`; booleans are
`INTEGER` 0/1.

`SCHEMA` also ends with an idempotent `INSERT OR IGNORE … SELECT` that
backfills `checklist_completions` from legacy `done_date` values — that is the
pattern to follow for data migrations here, since every statement re-runs on
each boot and must stay safe to repeat.

**Schema changes:** this is additive-only migration. Adding a table or index is
safe; adding a column to an existing table requires an extra `ALTER TABLE`
statement, since `CREATE TABLE IF NOT EXISTS` won't touch a table that already
exists. Mirror any change in `src/lib/types.ts` and in `/api/export`.

`DATABASE_URL` overrides the default `file:<cwd>/db/local.db`; set it (plus
`DATABASE_AUTH_TOKEN`) to point at Turso. Docker sets it to
`file:/app/db/app.db` on a mounted volume.

### Dates
**Never use `new Date().toISOString().slice(0, 10)`** — that is the date in
UTC, not the user's day, and it silently files evening entries under tomorrow
(or morning entries under yesterday, east of UTC). Use `src/lib/date.ts`:
`todayISO()`, `toISODate(date)`, `daysAgoISO(n)`, `parseISODate(iso)`. On the
The day is resolved against `APP_TIMEZONE` (an IANA name) when that is set,
and the machine's own timezone otherwise. It deliberately does **not** rely on
`TZ`: Vercel reserves that variable name and always runs functions in UTC, so
an app that trusts the process clock is unfixable there. Day arithmetic goes
through `shiftISODate()`, which steps whole calendar days in UTC space so
daylight-saving boundaries stay exactly one day wide.

### Checklist semantics
`checklist_items.done` / `done_date` are *current* state;
`checklist_completions` is the permanent per-day log the heatmap reads.
Recurring items are daily habits: `rolloverRecurringChecklist()` in
`src/lib/checklist.ts` lazily clears `done` on any recurring item last
completed before today, and is called at the top of `GET /api/checklist` and
`GET /api/summary` (no cron). Non-recurring items are never rolled over.
Ticking an item writes a completion; unticking removes *today's* completion
only, leaving history intact.

### API routes — the per-resource pattern
Every resource follows the same shape; copy an existing one (`api/gym/`) rather
than inventing a new style.

- `route.ts` — `GET` (list, `ORDER BY date DESC, id DESC LIMIT ?`, `limit`
  query param default 100) and `POST` (create, returns 201).
- `[id]/route.ts` — `PATCH` (partial update) and `DELETE`.
- Params are async: `{ params }: { params: Promise<{ id: string }> }`, then
  `const { id } = await params;`.
- Wrap the whole handler in `handleRoute(async () => …)` — it turns `ZodError`
  into a 422 with joined issue messages and anything else into a logged 500.
- Wrap DB work in `withDb(async () => …)` so `ensureDb()` has run.
- Validate the body with a Zod schema defined at module top
  (`createSchema` / `updateSchema`).
- Always parameterize SQL with `args`; PATCH builds its `SET` clause from the
  defined keys of the parsed body (keys come from the schema, never raw input).
- Responses are `{ items: [...] }`, `{ item: {...} }`, `{ ok: true }`, or
  `{ error: "…" }`.

`/api/summary` is the one aggregate route: it fans out parallel queries via
`Promise.all`, merges gym/LeetCode/checklist-completion dates into one heatmap
count per day, and computes the gym streak backwards from today (tolerating a
missing entry for today so a rest morning doesn't zero the streak).

### Pages
Section pages are `"use client"` and all follow the same template:

1. `useSWR<{ items: T[] }>("/api/x", fetcher)`.
2. `useUndoableDelete(allItems, { deleteUrl, label, onCommitted: () => mutate() })`
   — render `visibleItems`, call `requestDelete(item)` from the trash button.
   The row disappears immediately and the DELETE fires 5s later unless the
   toast's Undo is clicked. Use this instead of a confirm dialog.
3. Local `useState` form + `<Modal>` for add/edit, `apiPost` / `apiPatch` from
   `lib/fetcher`, `mutate()` after success, error string rendered in
   `var(--critical)`.
4. `<PageHeader title subtitle action>` at the top, `<EmptyState>` when the
   list is empty, `Loading…` while `isLoading`.

### Styling
Dark-only (`color-scheme: dark`). All color goes through CSS custom properties
defined in `src/app/globals.css` — `--page`, `--surface`, `--surface-raised`,
`--border`, `--ink-primary/secondary/muted`, `--accent*`, status colors
(`--good`, `--warning`, `--serious`, `--critical`), fixed per-section category
slots (`--cat-gym`, `--cat-leetcode`, …), and the `--heat-0..5` heatmap ramp.
**Never introduce a raw hex color in a component** — add or reuse a token.

Reusable component classes live in `@layer components` in `globals.css`:
`.card`, `.card-raised`, `.btn` + `.btn-primary/.btn-ghost/.btn-danger`,
`.input`, `.label`, `.badge`, `.dot`, `.icon-btn`. Tailwind utilities handle
layout; tokens are applied via inline `style={{ … }}` where a utility would
need an arbitrary value.

Accessibility conventions already in place and worth preserving: `aria-label`
on every icon-only button, `role="dialog"` + `aria-modal` + focus move + Escape
handling in `Modal`, `aria-current="page"` in `Nav`, and a global
`:focus-visible` outline.

### Personalization
No name is hardcoded. `NEXT_PUBLIC_DISPLAY_NAME` drives `getDisplayName()` /
`getBrandName()` / `getInitial()` in `lib/identity.ts`, used by the root
metadata, `Nav`, the login page, and the generated icons. Keep it that way.

## Environment variables

| Var | Required | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | yes | JWT signing key, ≥16 chars |
| `APP_PASSWORD_HASH` | one of these | bcrypt hash (preferred) |
| `APP_PASSWORD` | one of these | plaintext password (local only) |
| `NEXT_PUBLIC_DISPLAY_NAME` | no | name in UI, defaults to "You" — **inlined at build time**, so Docker passes it as a build arg |
| `ANTHROPIC_API_KEY` | no | enables `/api/import/screenshot` (Claude vision); feature reports unconfigured without it |
| `APP_TIMEZONE` | no | IANA zone the day rolls over in (streaks, "today", checklist reset). Not `TZ` — reserved on Vercel |
| `DATABASE_URL` | no | libSQL/Turso URL; defaults to local file |
| `DATABASE_AUTH_TOKEN` | no | Turso token |

`.env*` is gitignored except `.env.example` — never commit real secrets, and
update `.env.example` when adding a variable.

## Deployment notes

- `next.config.ts` sets `output: "standalone"` **only when not on Vercel**
  (`process.env.VERCEL`) — standalone breaks Vercel's own build tracing. Don't
  make it unconditional.
- `Dockerfile` is a 3-stage build (deps → build → runner) using placeholder
  `AUTH_SECRET`/`APP_PASSWORD` at build time only; real values come at runtime.
  `docker-compose.yml` mounts a named volume at `/app/db`.
- Vercel needs Turso, since its filesystem is ephemeral.
- `NEXT_PUBLIC_*` is baked into the bundle by `next build`. The Dockerfile
  takes `NEXT_PUBLIC_DISPLAY_NAME` as an `ARG` for exactly this reason —
  setting it only at run time has no effect, and changing it needs a rebuild.

## Adding a new section (checklist)

1. Add the table + index to `SCHEMA` in `src/lib/db.ts`.
2. Add the row interface to `src/lib/types.ts`.
3. Copy `src/app/api/gym/` to `src/app/api/<name>/`, adjust table + Zod schemas.
4. Add the table to `/api/export` (and `/api/summary` if it belongs on the
   overview).
5. Copy a page from `src/app/(app)/gym/page.tsx` into `(app)/<name>/page.tsx`.
6. Add the nav entry to `NAV_ITEMS` in `src/components/Nav.tsx` and a
   `--cat-<name>` color token in `globals.css`.


## Yit OS concepts

The dashboard is becoming a system that maintains a model of your life rather
than a set of forms you fill in. Three ideas carry that, and changing them
casually will break the guarantees the rest of the code depends on.

### Applications are an event log, not a row you edit

`applications.status` is a **cached projection** of `application_events`, which
is append-only. `applyEvent()` in `src/lib/career.ts` is the only code that may
write that column, and it appends the event and updates the cache together.

**Never `UPDATE applications SET status`** anywhere else. The point of the log
is that the timeline can always explain the status on the card — including a
status something inferred wrongly and you later corrected.

Transition rules live in `src/lib/career-status.ts` (pure, no DB, so the client
shares the exact definitions the API enforces):

- **User edits always win.** `source: "manual"` is applied unconditionally,
  including moving backwards or reopening a closed application.
- **Inference cannot walk an application backwards.** A late-arriving recruiter
  reminder must not undo real progress — that is what `pipelineRank` is for.
- **A manual decision beats older evidence, not all future evidence.** The
  guard compares the incoming event's date against the date of your last
  hand-made `status_change` in the log, so the email that caused a mistake
  cannot re-apply it — while an application you created yourself still
  advances on its own. `status_locked` records that you edited by hand; it is
  deliberately *not* a permanent switch.
- **Terminal statuses** (`Rejected`, `Withdrawn`) are never left by inference.

### The Inbox is derived, and deduplicated by situation

`refreshDerivedInbox()` recomputes items from data already in the database
(a stale application, a deadline inside the horizon) on read — there is one
user, so the only moment it must be current is when it is looked at.

`inbox_items.dedupe_key` encodes the **situation**, not the moment of noticing.
That is what stops nagging: a still-stale application re-derives to the same
key and updates its row instead of adding another, and a dismissed item stays
dismissed. Any new producer must pick a key with the same property.

### AI is additive and never required

Everything under `src/lib/ai/` is optional. `getAIProvider()` returns `null`
when unconfigured, every operation returns `null` on any failure, and every
caller must already work without it. Provider choice is configuration
(`AI_PROVIDER`); **no feature code may import a vendor SDK directly.**

Two rules for anything added here:

- **Structured or nothing.** Operations return Zod-validated shapes. Free-form
  prose is never parsed into the database. `/api/import/screenshot` is the
  precedent: it *proposes*, and an ordinary POST is what saves.
- **Ranking is deterministic.** `/api/today` sorts by real dates in SQL. The
  model only phrases facts that route already computed, so it cannot invent a
  deadline you do not have.

### Migrations: additive, and backfills run once

`SCHEMA` re-executes on every boot, so everything in it must stay idempotent.
A **backfill** is different — re-running one resurrects rows you deleted — so
backfills go through `runOnce()`, keyed in `schema_migrations`.

The `interviews` table is deliberately still there after the Career migration:
it costs nothing, keeps the export complete, and makes the migration
recoverable. Note that `migrate()` strips `--` comments before splitting on
`;`, because comment prose eventually contains a semicolon.


## Email ingestion

`src/lib/ingest/` turns recruiting mail into Career events. Four rules hold it
together, and each exists because of a specific way this goes wrong.

**Rules first, model second.** `classifyDeterministic()` reads templated
recruiting mail with regexes. It returns `null` to mean *"this needs
judgement"* — that null is the only thing that triggers an AI call. A definite
`isCareerRelated: false` is never escalated. Rules are free, offline, identical
every run, and testable against fixtures; a model is none of those.

**Ingestion never creates applications.** A message about a company with no
application becomes an inbox question. Inferring rows from email would let one
mis-parse invent a job you never applied for.

**Auto-apply is narrow.** Only deterministic signals, above the confidence bar,
with an unambiguous match, are written straight through — and `applyEvent()`
still guards them. Anything AI-derived, ambiguous, or low-confidence becomes a
proposal you confirm. A refusal by the guard is surfaced as an inbox item, not
silently dropped.

**Deduplication happens before classification.** `external_events` has
`UNIQUE(provider, provider_message_id)`, and `ingestMessages()` skips a message
that conflicts before any work is done. Combined with `dedupe_key` on proposals
and the no-op guard in `applyEvent()`, a recruiter who sends the same reminder
four times produces one timeline entry and one inbox item.

Privacy is a fetch-time property, not a storage-time one: Gmail is queried with
`format=metadata`, so bodies never arrive in the first place. Snippets are
clamped by `truncateSnippet()`. `integrations` stores no tokens — credentials
live in the environment, because `/api/export` dumps tables to a file.

## Tests

`npm test` runs `node:test` through `tsx` (which resolves the `@/` alias).

- `tests/fixtures/emails.ts` — realistic recruiting mail. Add a fixture here
  when you meet a template the rules get wrong; it is the regression suite for
  classification.
- `tests/pipeline.test.ts` runs the real pipeline against a temporary SQLite
  file. `DATABASE_URL` is set *before* importing `@/lib/db`, since that module
  resolves it once at load, and `AI_PROVIDER=none` keeps the tests
  deterministic.
