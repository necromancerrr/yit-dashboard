@AGENTS.md

# yit-dashboard

A single-user system that maintains a model of your life: a Career pipeline fed
by email, a derived Inbox, Today's ranked attention list, Health and Growth
tracking, School deadlines, and Money (cash flow plus live-priced crypto).
Full-stack Next.js with a real SQLite/libSQL database — every row the UI shows
is persisted and editable, and every AI feature is optional.

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
npm run typecheck            # tsc --noEmit
npm test                     # node:test via tsx (tests/*.test.ts)
node scripts/hash-password.mjs "pw"   # prints a bcrypt APP_PASSWORD_HASH
```

Before considering a change done, run `npm run lint`, `npm run typecheck`, and
`npm test` (see **Tests** at the bottom). `npm run build` is the final check —
it exercises the route bundling that typecheck alone does not.

The database file (`db/local.db`) and its tables are created lazily on the
first request — there is no migrate step to run.

## Layout

```
src/
  app/
    layout.tsx            # root: metadata from getBrandName(), globals.css
    login/page.tsx        # public sign-in page
    offline/page.tsx      # public fallback shown when nothing is cached
    icon.tsx apple-icon.tsx icon-192/ icon-512/ manifest.ts   # generated PWA assets
    (app)/                # authenticated group: sidebar + ToastProvider
      layout.tsx
      page.tsx            # Today — ranked attention list, reads /api/today
      career/               # application pipeline + career/[id] timeline
      inbox/                # derived review queue (confirm / dismiss)
      money/                # page.tsx + TransactionsPanel + RecurringPanel + CryptoPanel
      health/ growth/ school/ checklist/
      security/             # manage passkeys (WebAuthn devices)
      setup/                # what is configured, and what it costs when it is not
    api/
      auth/login  auth/logout
      auth/passkey/         # WebAuthn: login/ + register/ ceremonies, list, delete
      gym/ leetcode/ interviews/ school/ finance/ checklist/   # route.ts + [id]/route.ts
      finance/recurring/route.ts # derived subscriptions (read-only)
      applications/       # route.ts + [id]/route.ts + [id]/events/route.ts
      inbox/              # route.ts + [id]/route.ts (confirm / dismiss)
      today/route.ts      # ranked attention list for the Today page
      ingest/sync/route.ts # pull new mail and run the ingestion pipeline
      integrations/route.ts # connection state for external accounts
      summary/route.ts    # aggregate numbers + heatmap (now read by Growth)
      export/route.ts     # every table as one downloadable JSON file
      setup/route.ts      # configuration report; never returns a secret
      share/              # (app-level /share) OS share-sheet target
  components/             # Nav, Heatmap, StatCard, Modal, PageHeader, EmptyState, Logo,
                          #   ToastProvider, LockGuard, OfflineBanner, CommandPalette
  lib/
    db.ts                 # libSQL client (global singleton) + SCHEMA + ensureDb()
    auth.ts               # password verify, JWT sign/verify, cookie options
    api-helpers.ts        # handleRoute / withDb / jsonError / todayISO
    date.ts               # local-calendar date helpers — use these, never toISOString()
    checklist.ts          # daily rollover for recurring habits
    webauthn.ts           # passkey relying-party + challenge cookie helpers
    useWebAuthnSupport.ts # useSyncExternalStore probe for browser support
    useWebAuthnAutofillSupport.ts # same pattern, for conditional-UI support
    passkey-errors.ts     # WebAuthnError -> message, or null to stay silent
    fetcher.ts            # SWR fetcher + apiPost / apiPatch / apiDelete
    identity.ts           # display/brand name from NEXT_PUBLIC_DISPLAY_NAME
    types.ts              # row interfaces mirroring the SQL schema
    career-status.ts      # pipeline vocabulary + transition rules (pure, client-safe)
    career.ts             # applyEvent() — the only writer of applications.status
    inbox.ts              # derives inbox items from existing data (no email needed)
    search.ts             # LIKE scan across every table (server-only)
    search-types.ts       # client-safe search shapes + section labels
    palette.ts            # command-palette destinations + matcher (pure)
    autonomy/             # how much the sync may do on its own
      policy.ts           #   decideTier() — pure, no DB, no clock
      journal.ts          #   the only writer of automation_actions; undo
      digest-types.ts     #   client-safe shapes (journal imports node:fs)
    recurring.ts          # subscription detection from finance rows (pure)
    money-period.ts       # period windows + period-over-period totals (pure)
    setup-status.ts       # configuration checks; never returns a secret
    quick-add.ts          # reads a typed line with the ingestion rules
    ai/                   # AIProvider interface + registry; server-only, optional
    ingest/               # mail -> classify -> match -> propose/apply
      normalize.ts        #   pure string work (forwards, senders, companies)
      text.ts             #   shared text readers: extractDate/extractAmount, vocabulary
      classify.ts         #   deterministic rules; null means "ask the model"
      match.ts            #   which application a message belongs to
      pipeline.ts         #   orchestration + dedupe (the only db writer here)
      gmail.ts            #   Gmail REST client; metadata only, never bodies
    quick-add.ts          # parses a typed line into a school/money proposal
    useUndoableDelete.ts  # optimistic delete with a 5s undo window
    offline.ts            # offline envelope + connectivity store (pairs with public/sw.js)
  proxy.ts                # auth gate (Next.js 16 renamed middleware.ts → proxy.ts)
public/sw.js              # service worker — NOT bundled, cannot import from src/
scripts/hash-password.mjs
```

## How the pieces fit

### Auth
`src/proxy.ts` runs on every non-static request. Public paths are `/login`,
`/api/auth/login`, `/manifest.webmanifest`, `/sw.js`, `/offline`, and anything
under `/icon*` / `/apple-icon*` (browsers fetch icons before auth). Everything else requires a
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

**Conditional UI.** The login page also starts a *conditional* request on mount
(`startAuthentication({ optionsJSON, useBrowserAutofill: true })`), so the
passkey is offered in the password field's autofill popup without pressing
anything. It is a progressive enhancement and must stay one: it runs only where
`browserSupportsWebAuthnAutofill()` says yes, the explicit button remains the
fallback, and a request that ends without a credential is *silent* — being
superseded is its normal ending, not a failure. The `webauthn` token in
`autoComplete` is what makes the browser list passkeys there (the library
refuses to start without such an input) and is added only when conditional UI
exists, since a browser that does not know the token may discard the whole
attribute and lose ordinary password autofill. `WebAuthnAbortService` is the
library singleton that guarantees one live ceremony: the button's call cancels
the conditional one automatically.

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

Seventeen tables. The originals — `gym_logs`, `leetcode_logs`, `interviews`,
`school_tasks`, `finance_transactions`, `checklist_items`,
`checklist_completions`, `passkeys` — plus `shared_images`, `crypto_holdings`
and the Yit OS set: `applications`, `application_events`, `inbox_items`, `external_events`,
`integrations`, `schema_migrations`, `automation_actions`.
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

`/api/today` lists each unfinished recurring habit as its own row carrying a
`checklistItemId`, and Today renders those with a checkbox rather than a rank
number. **The id, not the kind, is what makes a row actionable** — nothing
re-derives "is this a habit?", and a row without one can never be given a
checkbox by accident. Past `HABITS_LISTED` (3) the rest collapse into one
countable row, so a long habit list cannot bury the week's deadlines; the tick
is optimistic and reverts on failure, because a habit you believe is done and
is not is worse than one you know is outstanding.

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
| `ANTHROPIC_API_KEY` | no | Anthropic provider; the only one with vision on by default |
| `DEEPSEEK_API_KEY` | no | enables AI-backed text features through the default DeepSeek provider |
| `AI_PROVIDER` | no | text AI provider: defaults to `deepseek`; use `none` to disable or `anthropic` for the legacy provider |
| `AI_MODEL` | no | text AI model override; DeepSeek defaults to `deepseek-v4-flash` |
| `DEEPSEEK_VISION_MODEL` | no | opt-in vision model for DeepSeek; without it screenshot import is off for that provider |
| `AUTOMATION_MODE` | no | `off` \| `assist` (default — today's behaviour) \| `auto`. Anything unrecognised means `assist` |
| `APP_TIMEZONE` | no | IANA zone the day rolls over in (streaks, "today", checklist reset). Not `TZ` — reserved on Vercel |
| `DATABASE_URL` | no | libSQL/Turso URL; defaults to local file |
| `DATABASE_AUTH_TOKEN` | no | Turso token |

**The Setup page (`/setup`) reports all of this from inside the app** — which
variable is missing, and what it costs. It never returns a key or any prefix of
one; `tests/setup-status.test.ts` enforces that. Prefer sending someone there
over asking them to read this table.

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
5. Copy a page from `src/app/(app)/school/page.tsx` into `(app)/<name>/page.tsx`.
6. Add the nav entry to `NAV_ITEMS` in `src/components/Nav.tsx` (with a
   `group`), a destination in `src/lib/palette.ts`, and a `--cat-<name>` color
   token in `globals.css`. `tests/nav.test.ts` and `tests/palette.test.ts` fail
   if you miss the last two.

### Navigation: everything is reachable from a phone

The bottom bar carries four tabs plus **More**, and the sheet behind More
renders `overflowItems` — defined as the *complement* of the bar, never a
second hand-written list. Before this, six of eleven destinations plus Export
and Sign out existed only in the desktop sidebar: reachable by typing a URL and
no other way. That stayed invisible precisely because the sidebar was complete.

The sidebar groups items (`Each day` / `Your life` / `System`) and scrolls, so
a short window clips nothing. The More sheet stores *which page it was opened
on* rather than a boolean — navigating then closes it by derivation during
render, because closing it from an effect is a `setState` in an effect body and
the React Compiler lint rejects that outright.

Not every feature deserves a nav entry. Crypto and recurring charges are panels
inside Money (`money/CryptoPanel.tsx`, `money/RecurringPanel.tsx`), because each
is a *facet* of money rather than a peer of it. Prefer a panel in an existing
section over a new top-level entry.

### Derived panels are read-only

`RecurringPanel` has no add button, and that is deliberate rather than
unfinished. Every row is computed from `finance_transactions`, so a panel that
also accepted edits would have two sources of truth and would quietly stop
being true the first time you forgot to maintain the hand-entered half. If a
panel derives its rows, it renders them and nothing else.


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

### Autonomy: act only where you can prove it and undo it

This **supersedes "propose before create"** for the narrow set of writes that
clear the bar in `src/lib/autonomy/policy.ts`. The replacement doctrine is
narrower, not looser:

> A write the sync makes on its own must be **journaled**, attributable to a
> message, **reversible**, and inside the run's **budget**. Everything else
> still proposes.

`policy.ts` is pure — no database, no clock, and the mode and budget are passed
in — for the same reason `career-status.ts` is: the whole policy is testable
against fixtures, and the UI can show the same sentence the pipeline enforced.
Four tiers, named for what you experience: `ask`, `act_tell` (written, in the
digest, with an undo), `act_log` (written, visible if looked for), `never`.

`AUTOMATION_MODE` gates it — `off`, `assist` (the default, and exactly today's
behaviour), `auto`. **Anything unrecognised parses as `assist`**, so a typo can
never widen what the app may do, and nobody is opted into autonomy by
upgrading.

**The never-list is not threshold-based, so it cannot be tuned into allowing
something.** Creating a career application (an application is an *identity*, and
a wrong one becomes a permanent candidate every future message is matched
against), anything a model read, an ambiguous match, income of any size, a
school task with no date the message actually stated, a course that fell back to
the generic label, and anything past the run budget.

`src/lib/autonomy/journal.ts` is the only writer of `automation_actions`, and
undo is **durable** — a receipt auto-applied in March is still undoable in June,
because the journal is permanent and the moment you notice a wrong row is not
something the app gets to schedule. Undo has three outcomes and the middle one
is the point: `reverted`, `kept_edited` (you already changed the row, so it is
left exactly as you left it — undo must never cost an edit you made
deliberately), and `gone`.

Career reversal **appends** a corrective manual event rather than deleting one:
`application_events` stays append-only, because a timeline explaining a status
you later corrected is the whole point of the log.

Rules worth keeping when extending this:

- **Journal the written fields, not the row.** The fingerprint is computed over
  exactly what was written, so a bumped `updated_at` is not mistaken for an
  edit and a real edit is never destroyed.
- **The budget is the run's, not a domain's.** `AUTO_APPLY_MAX_PER_RUN` (10)
  bounds the blast radius of a backfill, a cursor rewind, or a classifier
  regression: past it, everything becomes questions. Nothing is lost — a long
  inbox is a recoverable afternoon, a hundred silent ledger rows is not.
- **Silence is never consent.** `reviewed_at` is set only by an explicit "looks
  right" or an undo. A row nobody looked at is not evidence of anything, so a
  system being ignored must become *less* autonomous, not more. This is why the
  trust ledger (Stage 3, `docs/inbox-autonomy.md`) is deliberately not built
  yet.
- **Every automated row carries its provenance.** `source` and
  `external_event_id` on `school_tasks` and `finance_transactions`, rendered as
  a small `<FromEmail>` marker. A machine write that looks identical to yours is
  the failure that costs the most trust: you find a transaction you do not
  remember and cannot tell whether you forgot it or the machine invented it.
- The brain owns **policy** — how much to act, why, and how to take it back. It
  does not classify (rules first, model second is unchanged) and it does not
  rank (`/api/today` still sorts by real dates in SQL). A ranking cannot be
  reversed, only re-rolled, and everything here leans on decisions that can be
  shown and undone.

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

`getVisionProvider()` is the entry point for image work. `AI_PROVIDER` picks one
provider for everything, but vision is the one capability a provider can simply
lack — so image operations fall back to a vision-capable provider while every
text feature stays on the configured (cheaper) one. `AI_PROVIDER=none` is still
honoured absolutely; an explicit opt-out is never overridden.

`AIProvider` declares `supportsVision` alongside its operations.
`extractFromScreenshot()` powers `/api/import/screenshot`; DeepSeek's chat
models are text-only, so that provider reports `supportsVision: false` unless
`DEEPSEEK_VISION_MODEL` names a vision-capable model. The flag is declared
rather than discovered so the route can say *why* import is unavailable — "no
provider", "provider can't see", and "unreadable screenshot" have three
different fixes and must not collapse into one error.

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

**Ingestion proposes before it creates.** A message about a company with no
application becomes an Inbox item carrying the proposed company, role and
status. Confirming that item creates the Career row; the sync itself never
invents an application without a user click — and that one, uniquely, is on the
never-list rather than merely below a threshold (see **Autonomy** above).

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

## Everyday ingestion (beyond Career)

Ingestion originally asked one question — *"what does this say about a job
application?"* — and discarded everything else. Most of what actually arrives
each day is a receipt or a course deadline, and both already have a table.

`src/lib/ingest/domains.ts` runs **after** the career classifier declines, and
routes a message to a `LifeDomain` (`school` | `money`) with a domain-shaped
payload. It follows the same contracts as the career path:

- **Rules first, model second.** `classifyDomain()` returns `null` to mean
  "needs judgement" rather than guessing. Career keeps its own path untouched.
- **Propose before create — unless policy says otherwise.** Under the default
  `AUTOMATION_MODE=assist` nothing is written to `school_tasks` or
  `finance_transactions` by the sync: the proposal lands in the Inbox and
  *confirming* it creates the row, in `api/inbox/[id]/route.ts`. Under
  `AUTOMATION_MODE=auto`, a receipt from a billing sender under $100 (or an LMS
  message with a date it actually stated) is written directly, journaled, and
  undoable from the digest. See **Autonomy** above.
- **Dedupe by situation.** Keys are `school:<course>:<title>:<due>` and
  `money:<merchant>:<amount>:<date>` — the same receipt re-derives to the same
  key and updates in place, so a resent email never stacks a second copy.
- **Never compute a date.** `extractDate()` reads only dates written in the
  text; "due Friday" and "in two weeks" deliberately return `null`. A wrong
  deadline is worse than none, because you plan around it without questioning.
- **No amount, no transaction.** A money proposal without a number is dropped
  rather than guessed.

`inbox_items` carries `domain` + `proposed_payload` (JSON) rather than a column
per domain. The payload is re-validated with Zod on confirm — it originated in
an email, and the schema is what stands between a malformed proposal and your
ledger. Both columns are added via `ensureColumn()`, not `SCHEMA`: an
`ALTER TABLE` inside `SCHEMA` would throw on the second boot.

### Quick add reads typed text with the ingestion rules

The box on Today (`src/app/(app)/QuickAdd.tsx`, parser in `src/lib/quick-add.ts`)
turns `coffee $4.50` or `CSE143 pset due 4/2` into the same proposals email
ingestion produces. It does **not** reimplement the readers: `extractDate`,
`extractAmount` and the shared vocabulary live in `src/lib/ingest/text.ts` —
pure, client-safe, and imported by both `domains.ts` and `quick-add.ts`, so a
line you type and a receipt you are sent can never be read by two rulesets that
have drifted apart. `domains.ts` re-exports the readers, so existing importers
are unaffected.

The same two refusals hold: a relative date ("due Friday") yields a task with
no due date rather than a computed one, and a line with no `$` amount is never
proposed as money. The preview is derived during render — there is no effect
mirroring the parse into state — and confirming POSTs to the ordinary
`/api/school` and `/api/finance` routes. No new insert path, and no model call:
this is deterministic parsing, which is the point.
## Money totals always name their period

`src/lib/money-period.ts`. The cards on Cash flow used to total every row the
list had loaded — up to the route's 300-row default, reaching back however far
that went — while the empty state promised a "monthly picture". A figure with
no period attached is not a *wrong* figure; it is one you cannot act on, since
you cannot tell whether spending is up without knowing up since when.

So the period is explicit (This month / Last 30 days / All time), the
transaction list follows the same control — cards for this month above a ledger
going back years reads as a bug even when both halves are correct — and every
figure is paired with the same figure for the period before it.

Rules that are easy to get wrong here:

- **Months compare to months**, not to fixed 30-day blocks. February against
  January is the comparison a person means, even though one is three days
  shorter. The 30-day window includes today, so the two windows are equal
  length and share no boundary day.
- **`percentChange` returns `null` against zero.** "+100%" or "+∞" for a first
  month is a made-up number wearing the clothes of a measurement; the UI says
  "nothing in last month" instead.
- **Up is not universally good.** More income is progress, more spending is
  not, so `Comparison` takes `moreIsBetter` — colouring both green would make
  the row meaningless.
- The panel requests `?limit=5000` deliberately: totals over a truncated ledger
  are silently wrong, and "All time" would quietly mean "the most recent 300".

## Recurring charges

`src/lib/recurring.ts` finds subscriptions in transactions you already logged.
Nothing is fetched from a bank and nothing new is stored — `GET
/api/finance/recurring` reads two years of rows, calls `detectRecurring()`, and
returns the findings. It is a scan over a few hundred rows.

`detectRecurring(transactions, today)` is pure: no database, no clock. `today`
is a parameter precisely so the behaviour can be pinned in tests
(`tests/recurring.test.ts`), and every rule in it exists to *reject* something:

- **Three occurrences minimum.** Two points fit any line.
- **Consistent gaps** (within 25% of the median) — weekly groceries have gaps
  of 3, 9, 5; a subscription has 30, 31, 30.
- **Consistent amounts** (within 20%) — prices rise and usage-based bills
  drift, but a category swinging 20 → 140 is not a commitment.
- **Nothing more often than every five days.** That is a habit, not a bill.
- **Income is excluded.** A salary would otherwise be the single most confident
  "recurring charge" in the list.
- **Silence for two cadences means cancelled.** A list that still bills you for
  something you quit last year is one you stop reading.

The bias is deliberate and one-directional: a miss costs nothing, a false
positive costs the owner's trust in the whole list, and an untrusted list is
the same as no list. Loosen a threshold only with a fixture that proves the
looser rule still rejects groceries.

The headline figure is annual cost, not the per-charge amount — `$11.99` is
nothing and `$141 a year` is a decision — and the list sorts by it, so the most
expensive commitment is the first thing read.

## Command palette (⌘K)

`src/components/CommandPalette.tsx`, mounted once in the authenticated layout.
It jumps to a section or finds a row, and it does **not** write anything —
quick add lives on Today where the proposal is previewed first, and Enter on a
half-typed line is far too cheap for something that lands in your ledger. Any
palette action must stay read-only for that reason.

Destinations come from `src/lib/palette.ts` (pure, so `tests/palette.test.ts`
can check the matching without a DOM) and are listed *before* search results,
because a section is a place you know exists and should never rank below a
transaction that happens to contain the word. Matching is substring, not fuzzy:
a confident jump to the wrong page is worse than an empty list.

Two things worth knowing before touching it:

- **It reads the lock first.** `LockGuard` puts the app in an `inert` subtree,
  which stops clicks and focus but *not* a listener bound to the document — so
  without `useIsLocked()` the shortcut would open a searchable window onto the
  database on top of the lock screen. Anything else bound to the document owes
  the same check.
- **The cursor is clamped during render**, not corrected in an effect. The list
  shrinks between keystrokes, and an effect would leave the highlight on a row
  that no longer exists for a frame.

`tests/palette.test.ts` also asserts every `NAV_ITEMS` entry has a palette
destination — the two lists are maintained by hand in different files, and a
section added to one and forgotten in the other is invisible until someone goes
looking.

## Offline (PWA)

`public/sw.js` is a hand-written service worker — no Workbox, no next-pwa. It
lives in `public/` so it is served from the origin root and therefore scopes to
`/` without a `Service-Worker-Allowed` header. Being unbundled, **it cannot
import from `src/`**: the two strings it shares with the app live in
`src/lib/offline.ts` and are pinned by `tests/offline.test.ts`.

**One rule governs everything here: a cached response is never handed back as
though it were live.** The three strategies fall out of it.

- **App shell / hashed assets — cache-first.** `/_next/static/*` and the icon
  routes are content-hashed or immutable, so a hit cannot be the wrong version.
- **Navigations — network-first**, then the cached shell for that path, then
  `/offline`. Never cache-first: the proxy redirects an unauthenticated page
  request to `/login`, and a cached shell served over that would show a
  signed-out user a page that cannot load. Caching documents is safe *only*
  because every page is a client component whose data comes from `/api` — the
  HTML holds no user data.
- **API GETs — network-first, and a cache hit is returned only labelled.** The
  worker injects an `offline: { stale, cachedAt, redacted }` envelope into the
  JSON body. It is in the body, not a header, so it travels through SWR into
  the component that renders the numbers instead of being easy to forget.

Two guards protect money and deadlines specifically:

- `/api/crypto` is in `LIVE_PRICE_ROUTES` — never cached, never served stale.
  Offline it returns 503 and `CryptoPanel` says why. A day-old portfolio value
  shown as current is worse than nothing, because you act on it.
- `/api/today` is cacheable but carries `netWorthSnapshot`, a live-priced
  number. `LIVE_PRICE_FIELDS` nulls it and names it in `redacted`, which is why
  `TodayData.netWorthSnapshot` is `number | null`. **Adding a price-derived
  field to a cacheable route means adding it there too.**

`OfflineBanner` (in the `(app)` layout) is the other half of that bargain: it
names both that you are offline and when the data on screen was saved. Do not
serve stale data on a screen it does not cover.

**Writes are never queued.** A POST/PATCH/DELETE offline fails at the network,
`src/lib/fetcher.ts` turns it into "this change was not saved", and the pages
already render that. A queue would report "saved" for something the server has
not seen, and these writes are not independent facts — `applyEvent()` orders
career events against server state and checklist ticks resolve against the
server's today. Non-GET requests are not intercepted at all, which is also what
keeps an OS share-target POST working.

**Updates are prompted, not automatic.** `skipWaiting()` on install would swap
caches under an open page whose hashed chunks then vanish. Instead the new
worker waits, `ServiceWorkerManager` offers "Reload", and that posts
`SKIP_WAITING` and reloads on `controllerchange`. `clients.claim()` in activate
covers only the first install, where there is no old page to break; the client
re-checks with `registration.update()` on every focus so a phone PWA that never
closes still upgrades. Bump `VERSION` in `sw.js` to retire every cache it owns.

The worker only registers in production builds — test it with
`npm run build && npm start`, not `npm run dev`.

Note `experimental.useOffline` (and `useOffline` from `next/offline`) is
deliberately **not** enabled. That flag makes failed navigations hang pending a
retry, and a failed router fetch is exactly what triggers the full navigation
this worker can answer from its shell cache. `src/lib/offline.ts` uses the
repo's `useSyncExternalStore` pattern instead, fed by both the browser's
online/offline events and actual fetch failures.

## Conventions skill

`.claude/skills/yit-conventions/SKILL.md` collects the non-obvious rules this
repo enforces — the `setState`-in-an-effect lint, the date helpers, the
`ensureColumn` vs `SCHEMA` vs `runOnce` split, the vendor-SDK ban, and
propose-before-create. Every entry exists because it was broken here at least
once. Load it before writing code rather than rediscovering them.

## Tests

`npm test` runs `node:test` through `tsx` (which resolves the `@/` alias).

Two tests guard things that drift silently rather than failing loudly, by
reading source files:

- `tests/export.test.ts` — every table in `SCHEMA` is either in `/api/export`
  or in that test's named exclusion list. A table missed in the export still
  downloads a file that *looks* complete, and you find out when you need it.
- `tests/palette.test.ts` — every `NAV_ITEMS` entry has a command-palette
  destination.

Reading source is crude; it is also the only thing that fails when two
hand-maintained lists in different files fall out of step.

- `tests/fixtures/emails.ts` — realistic recruiting mail. Add a fixture here
  when you meet a template the rules get wrong; it is the regression suite for
  classification.
- `tests/domains.test.ts` and `tests/quick-add.test.ts` pin the shared text
  readers from both sides — mail and typed input. A rule changed for one must
  keep the other green.
- `tests/pipeline.test.ts` runs the real pipeline against a temporary SQLite
  file. `DATABASE_URL` is set *before* importing `@/lib/db`, since that module
  resolves it once at load, and `AI_PROVIDER=none` keeps the tests
  deterministic.
- `tests/offline.test.ts` loads `public/sw.js` in a `node:vm` sandbox and
  asserts its routing *policy* — what may be served from cache and what may
  not. The caching mechanics need a real browser and a real network drop; the
  policy is a pure decision and belongs under test.
