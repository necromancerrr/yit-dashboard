---
name: yit-conventions
description: The non-obvious rules this repository enforces. Load before writing or reviewing code in yit-dashboard — these are the mistakes that repeatedly reached review, each one caught by lint, a test, or production behaviour rather than by reading the code.
---

# Conventions that bite

Every rule here exists because someone broke it in this repo. They are not
style preferences; each one has a failure attached.

## React

**Never call `setState` synchronously inside a `useEffect` body.** The React
Compiler lint rules reject it, and three separate agents hit this. When the
value lives *outside* React and does not exist during server rendering —
`navigator`, `sessionStorage`, a media query — the answer is
`useSyncExternalStore` with a server snapshot, not state plus an effect.

Reference: `src/lib/useWebAuthnSupport.ts`, `src/components/LockGuard.tsx`.

**Prefer a value derived during render** over state mirrored from somewhere
else. `src/app/(app)/money/CryptoPanel.tsx` derives its share-error message
straight from the URL rather than syncing it into state. The same rule covers
*clamping*: `CommandPalette` clamps its keyboard cursor during render, because
the result list shrinks between keystrokes and an effect would leave the
highlight on a row that no longer exists for a frame.

**`useSearchParams()` needs a Suspense boundary above it, or `next build`
fails outright** — not a warning, a failed export of that route. Adding it to
`(app)/money/page.tsx` broke the build until the tab body was moved into a
child under `<Suspense>`. Keep the page header outside the boundary so there is
nothing to see while it resolves.

**`inert` does not stop a listener bound to the document.** `LockGuard` renders
the app in an inert subtree while locked, which blocks clicks and focus and
nothing else — a global keyboard shortcut would happily open its own panel,
full of your data, on top of the lock screen. Anything bound to `document` must
call `useIsLocked()` first (`src/components/CommandPalette.tsx`).

## Dates

**Never `new Date().toISOString().slice(0, 10)`.** That is the date in UTC, not
the user's day; it silently files evening entries under tomorrow. Use
`src/lib/date.ts` (`todayISO`, `toISODate`, `daysAgoISO`, `shiftISODate`,
`parseISODate`).

Day arithmetic goes through `shiftISODate()`, which steps whole calendar days
in UTC space so a daylight-saving boundary stays exactly one day wide.

**`APP_TIMEZONE`, never `TZ`** — Vercel reserves `TZ` and rejects it.

**Reading a date out of text takes a direction.** `extractDate(text, on,
"future" | "past")` in `src/lib/ingest/text.ts`. A deadline rolls forward, a
receipt reads backward. Getting this wrong filed a September receipt under the
following year, where it vanished from every month you would look for it in.

**Never compute a date.** "Due Friday" must return null. A wrong deadline is
worse than no deadline because you plan around it without questioning it.

## Database

`SCHEMA` in `src/lib/db.ts` **re-executes on every boot**, so everything in it
must be idempotent.

- Adding a column: `ensureColumn()`. An `ALTER TABLE` inside `SCHEMA` throws
  "duplicate column" on the second boot.
- Backfilling data: `runOnce()`, keyed in `schema_migrations`. Re-running a
  backfill resurrects rows the user deleted.
- New table or index: `CREATE ... IF NOT EXISTS` in `SCHEMA` is fine.

Mirror any change in `src/lib/types.ts` and `/api/export`.

## AI

**No feature code may import a vendor SDK.** Go through `src/lib/ai/`
(`getAIProvider()` for text, `getVisionProvider()` for images). This was
violated exactly once, by `/api/import/screenshot`, and that is why screenshot
import could not follow `AI_PROVIDER` like everything else.

**Structured or nothing.** Operations return Zod-validated shapes. Free-form
prose is never parsed into the database.

**Propose before create.** Anything a model produced is shown for review; an
ordinary POST is what saves it. Ingestion, screenshot import, and quick add all
follow this.

**Rules first, model second.** Deterministic classifiers return `null` to mean
"needs judgement", and that null is the only thing that triggers a model call.
Rules are free, offline, identical every run, and testable.

## Derived data

**A panel that derives its rows renders them and nothing else.** No add button,
no inline edit. `money/RecurringPanel.tsx` is computed from
`finance_transactions`; letting it also accept writes would give it two sources
of truth, and it would quietly stop being true the first time the
hand-maintained half was forgotten.

**Detectors are pure, and take `today` as a parameter.** `src/lib/recurring.ts`
and `src/lib/money-period.ts` touch no database and read no clock, which is the
only reason their behaviour can be pinned against fixed dates. A comparison
against the wrong previous month is invisible *and* wrong.

**Every total names its period.** The Money cards used to sum whatever the list
had loaded. A figure with no window attached is not wrong, it is unusable — you
cannot tell if spending is up without knowing up since when.

**Never state a percentage against zero.** `percentChange` returns `null`
rather than "+100%" for a first month; a made-up number wearing the clothes of
a measurement is worse than a blank.

## Autonomy

**A capability is gated on evidence, not on shape.** `decideMoneyTier` requires
both a receipt-shaped sender *and* a trust record: looking like a receipt says
nothing about whether this sender has ever been read correctly. When adding a
new automatic action, ask what would make it *earn* the right — a structural
signal alone is never enough.

**Silence is never consent.** `confirms` and `reviewed_at` move only on an
explicit act. Never increment trust from "nobody complained" — a system being
ignored must become less autonomous, not more.

**A client component may not import a module that touches the database.**
`journal.ts` and `trust.ts` pull `node:fs` in through libSQL, so their shapes
live in `digest-types.ts` and `rule-types.ts`. The build fails outright, not at
runtime. Same pattern as `search-types.ts`.

**Duplicating a constant or a helper across modules is drift.** `db.ts`'s trust
seed imports `senderDomain()` and `TRUST_PROMOTION` rather than copying them:
two notions of "the sender domain" would credit senders the lookup never finds.
Check for an import path before writing a second copy — the pure modules
(`policy.ts`, `normalize.ts`, `career-status.ts`) reach nothing that imports
`db`, so importing them anywhere is safe.

## Two hand-maintained lists need a test between them

When the same fact lives in two files, add a test that reads both and fails on
drift. It is crude and it is the only thing that catches this class of bug:

- `tests/export.test.ts` — every table in `SCHEMA` is in `/api/export` or in a
  named exclusion list. A table missed there still downloads a file that
  *looks* complete; you find out when you need it.
- `tests/palette.test.ts` — every `NAV_ITEMS` entry has a palette destination.

## Values

**`null` is not `0`.** "We do not know" and "it is zero" are different facts. A
crypto holding with no price shows *"No price"* and is excluded from the total
with a count, because rendering `$0` reads as *"you own nothing"*.

**Never surface a raw platform error when you can say something actionable**,
and never fail silently. `src/lib/passkey-errors.ts` exists because swallowing
`NotAllowedError` made a working feature look broken.

## Styling

No raw hex in components. Use the CSS custom properties in
`src/app/globals.css` (`--ink-*`, `--surface*`, `--cat-*`, status colours).
Component classes live in `@layer components`.

Keep the existing accessibility: `aria-label` on icon-only buttons,
`role="dialog"` + focus move + Escape in modals, `aria-current="page"` in nav.

## Before claiming done

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

All four. `npm run build` catches route-bundling problems typecheck alone does
not. If a check fails in a way that looks unrelated to your change, suspect a
stale `.next/` or a scratch worktree before blaming the code — both have
produced false failures here.

State plainly what you could *not* verify. A real passkey prompt, a live model
call, and a running service worker are all unverifiable in a sandbox; saying so
is worth more than implying coverage that does not exist.
