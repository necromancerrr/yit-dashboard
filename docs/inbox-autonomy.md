# Inbox autonomy — a design for not pressing yes and no

> **Status: design only — nothing here is implemented.**
> It is blocked on the owner's answers in the closing section, most of all
> how often the digest would actually be read. Autonomy with unread
> oversight is just unaudited automation, so an honest "rarely" changes
> what should ship.


**Status:** design only. Nothing in this document is implemented. No schema, route,
or pipeline change accompanies it.

**The ask, verbatim:** *"create a system design-ish for the inbox sync feature, and i
dont want to press yes and no for everything, automate it and actually make a central
system brain like and make it like that helps to make my life better."*

---

## 1. The tension, stated plainly

`CLAUDE.md` states a doctrine in three places, and it is load-bearing:

> **Ingestion proposes before it creates.** … the sync itself never invents an
> application without a user click.
> **Propose before create.** Nothing is written to `school_tasks` or
> `finance_transactions` by the sync.

The owner is asking to stop clicking. These are in direct conflict, and the naive
resolution — turn the confirmation off and write everything through — is wrong for a
reason specific to this app rather than a general one:

- **A misread receipt becomes a wrong number in a ledger that is read as truth.**
  `/api/today` sums `finance_transactions` for the month and puts the result on the
  home screen. A phantom `$1,299.00` does not announce itself; it just makes the
  month look worse, and the owner adjusts their behaviour to a fiction.
- **A wrong deadline gets planned around and never questioned.** This is already
  written into `extractDate()`'s comment — *"a wrong deadline is worse than no
  deadline"* — and auto-apply would move that risk from "a proposal you can decline"
  to "a row on the School page that looks like something you entered."
- **The guard rails are asymmetric.** `applyEvent()` refuses regressions, terminal
  reopens, and evidence older than a manual correction. `school_tasks` and
  `finance_transactions` have *no* equivalent — they are plain `INSERT`s with no
  history, no provenance column, and no way to tell an auto-created row from one the
  owner typed.

So the resolution is not "confirm or don't." It is: **what earns the right to act
unattended, how does the system prove afterwards what it did, and how does the owner
take the right back?** That is graduated autonomy, and this repo already contains the
seed of it — `AUTO_APPLY_MIN_CONFIDENCE = 0.9` in `src/lib/ingest/classify.ts`, plus
the `signal.method === "deterministic"` requirement in `pipeline.ts`. Deterministic
career signals already write straight through. Everything below extends that one
existing idea rather than introducing a new one.

**The design principle that replaces "propose before create":**

> Nothing acts unattended unless it is **reversible**, **provenanced**, and
> **bounded**. Reversible: there is a recorded way to take it back. Provenanced: the
> row can name the email that caused it. Bounded: a single sync cannot do unlimited
> damage before anyone looks.

Doctrine change, written out so it can be pasted into `CLAUDE.md` when Stage 2 lands:

> ~~Propose before create.~~ **Act only where you can prove it and undo it.** A write
> the sync makes on its own must be journaled, attributable to a message, reversible
> from the digest, and inside the run's action budget. Everything else still proposes.

---

## 2. What earns autonomy — a tier model

Four tiers. A decision function maps every ingest outcome to exactly one. The tiers
are named after what the owner experiences, not after what the code does.

| Tier | Name | What happens | Owner experience |
| --- | --- | --- | --- |
| **T0** | Ask | Inbox item, `state='open'` | Same as today: confirm/dismiss |
| **T1** | Act & tell | Row written, journaled, appears in the digest with an Undo | "Here's what I did" |
| **T2** | Act & log | Row written, journaled, shown only in the full activity list | Invisible unless looked for |
| **T3** | Never | Refused regardless of confidence — see §5 | Always a question, or nothing |

T2 is not "more trusted than T1 so we hide it." T2 is for classes of write where a
mistake is *cheap and self-correcting* — the only current candidate is a career
`status_change` on an existing application, because `application_events` is
append-only and the timeline explains the card. T1 is for writes to tables with no
history: money and school.

### The score

Reuse what exists. `pipeline.ts` already computes:

```ts
const combined = signal.confidence * match.confidence;   // career
const trustworthy = signal.method === "deterministic" && combined >= AUTO_APPLY_MIN_CONFIDENCE * 0.9;
```

Generalise it to a single pure function, `decideTier()`, in a new
`src/lib/autonomy/policy.ts` — pure, no DB, testable against fixtures, in the same
spirit as `career-status.ts`:

```
score = signal.confidence            // classifier's own number
      × matchFactor                  // 1.0 career w/ unambiguous match, or n/a
      × trustFactor(sourceKey)       // 1.0 unknown sender … 1.15 established
```

Concrete thresholds, all named constants in `policy.ts`, all tied to values the code
already produces:

| Domain | Condition | Tier |
| --- | --- | --- |
| Career status change | `method==="deterministic"` and `combined ≥ 0.81` (`AUTO_APPLY_MIN_CONFIDENCE * 0.9`, today's bar) | **T2** |
| Career status change | anything else | T0 |
| Career **new application** | any confidence | **T3** (§5) |
| Money | deterministic, `confidence ≥ 0.88` (the `fromReceiptSender` value in `domains.ts`), amount ≤ `AUTO_APPLY_MAX_AMOUNT` (default 100), sender trusted (`trust ≥ 3`) | **T1** |
| Money | deterministic, `confidence ≥ 0.88`, amount ≤ ceiling, sender **untrusted** | T0 → promotes itself after 3 clean confirms |
| Money | `confidence < 0.88` (the generic `0.72` "message states an amount" path), or amount > ceiling, or `type==="income"` | T0 |
| School | `fromLMS` (`confidence 0.9`), **explicit** `dueDate` present, course code parsed (not the `"Course"` fallback) | **T1** |
| School | `.edu` sender (`0.75`), or `dueDate === null`, or course fell back | T0 |
| Anything AI-derived (`method === "ai"`) | any | T0 |

Two of these deserve their reasoning on the record:

- **`type === "income"` is never T1.** `extractAmount()` takes the *largest* dollar
  figure in the text, and the income/expense split is a single regex on words like
  "refund" and "deposit". A misfiled expense understates the month; a phantom
  *income* overstates what the owner has. The error is not symmetric, so the tier
  is not either.
- **The `0.88` money bar is the `fromReceiptSender` constant**, deliberately. It
  means "only mail from a billing-shaped sender auto-applies," which is the same
  structural signal `fromLMS` gives school. Generic "this message mentions $40"
  (0.72) stays a question forever.

### Trust that changes

`trustFactor` comes from a small ledger keyed on the **envelope sender domain**, never
the display name — display names are attacker-controlled and `merchantFrom()` already
prefers `senderName` for the *category*, which is fine for a label and unacceptable as
an authorization key.

Promotion and decay, deliberately arithmetic rather than learned:

- **Confirm** an item from sender `S` in domain `D` → `confirms += 1`.
- **Undo**, or **edit within 48h** of an auto-applied row from `S` → `corrections += 1`,
  and `confirms` resets to `0`. One correction demotes; there is no averaging.
- `trust = confirms` when `corrections === 0`, else `0`.
- **Promotion:** `trust ≥ 3` moves that sender+domain from T0 to T1.
- **Decay, computed on read** (no cron — this repo's convention, cf.
  `rolloverRecurringChecklist()`): a sender with no confirmation and no auto-apply in
  **90 days** drops one confirm per further 30 days. A merchant you stopped using
  should not stay trusted forever; more importantly, a promotion earned under one
  email template should lapse when the template has had a year to change.
- **Silence is not a confirmation.** An auto-applied row the owner never looked at
  does **not** increment `confirms`. Only an explicit confirm, or an explicit
  "looks right" on a digest, does. Otherwise trust bootstraps itself out of
  inattention, which is exactly the drift failure described in §6.

Note what is *not* here: no per-item learned model, no embedding similarity. The trust
ledger is a counter with a decay rule, because it must be explainable in one sentence
on the digest ("Amazon receipts: auto-applied, 7 confirmed, 0 corrections") and because
a counter can be tested.

---

## 3. Data model

All additive, following the repo's three mechanisms and their existing rules.

### 3a. `automation_rules` — the trust ledger (in `SCHEMA`)

New table, so `CREATE TABLE IF NOT EXISTS` in `SCHEMA` is correct and idempotent.

```sql
CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,             -- 'career' | 'school' | 'money'
  scope TEXT NOT NULL,              -- 'sender_domain' | 'course'
  scope_key TEXT NOT NULL,          -- 'amazon.com', 'CSE 143' — lowercased
  confirms INTEGER NOT NULL DEFAULT 0,
  corrections INTEGER NOT NULL DEFAULT 0,
  -- 'ask' | 'auto' | 'never'; 'never' is a hard owner override
  mode TEXT NOT NULL DEFAULT 'ask',
  last_confirmed_at TEXT,
  last_applied_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(domain, scope, scope_key)
);
```

`mode='never'` matters as much as `mode='auto'`: the owner needs a way to say "never
touch anything from this sender" that no amount of accumulated confidence overrides.
That is how autonomy is *taken back* per-source rather than globally.

### 3b. `automation_actions` — the journal (in `SCHEMA`)

This is the undo mechanism and the audit trail, and it is what makes T1/T2 defensible.

```sql
CREATE TABLE IF NOT EXISTS automation_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,             -- one sync = one run; groups the digest
  domain TEXT NOT NULL,
  tier TEXT NOT NULL,               -- 't1' | 't2'
  action TEXT NOT NULL,             -- 'insert_school_task' | 'insert_transaction' | 'career_status'
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  external_event_id INTEGER,        -- the message that caused it
  payload TEXT NOT NULL,            -- JSON: exactly the fields written
  fingerprint TEXT NOT NULL,        -- hash of the written fields, for the edit check
  score REAL,
  rule_id INTEGER,                  -- automation_rules row that authorised it
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT,                 -- owner saw it in a digest
  undone_at TEXT,
  undo_result TEXT                  -- 'reverted' | 'kept_edited' | 'gone'
);
CREATE INDEX IF NOT EXISTS idx_automation_actions_run ON automation_actions(run_id, applied_at);
CREATE INDEX IF NOT EXISTS idx_automation_actions_open ON automation_actions(reviewed_at, applied_at);
```

**Why a journal instead of event-sourcing school and money.** The honest comparison:

| | Event log for school/money | Journal + insert-only autonomy |
| --- | --- | --- |
| Correctness | Total. Every state is explained. | Only *automated* writes are explained. |
| Cost | Rewrites both sections' write paths, both `[id]` routes, `/api/export`, both pages, plus a projection cache and a `applyEvent()`-equivalent per domain. | One table, one helper, no change to existing write paths. |
| What it buys the owner | The ability to explain a hand-typed edit from 2024. | The ability to undo what the machine did. |

The owner's problem is machine writes, not their own edit history. Event-sourcing two
more domains is the technically purer answer and it is not worth its price *yet*; the
journal is the smallest thing that makes autonomy reversible. Recommendation: journal
now, and revisit event-sourcing only if the owner ever asks "why is this number what
it is" about a row they typed themselves.

Career needs no new mechanism — `application_events` is already the journal — but T2
career actions are still *recorded* in `automation_actions` so one digest covers
everything. The journal row points at the `application_events` row; undo appends a
corrective `status_change` with `source: 'manual'` (which `evaluateTransition()`
accepts unconditionally), it never deletes an event.

### 3c. Provenance columns on existing tables (`ensureColumn()`, **not** `SCHEMA`)

`school_tasks` and `finance_transactions` already exist in every deployed database, so
`CREATE TABLE IF NOT EXISTS` will not touch them and a bare `ALTER TABLE` inside
`SCHEMA` throws on the second boot — exactly the reasoning already recorded for
`inbox_items.domain` / `proposed_payload`.

```ts
await ensureColumn("school_tasks", "source", "TEXT");                // null | 'gmail'
await ensureColumn("school_tasks", "external_event_id", "INTEGER");
await ensureColumn("finance_transactions", "source", "TEXT");
await ensureColumn("finance_transactions", "external_event_id", "INTEGER");
```

Two columns, not a whole provenance table, because the UI needs exactly one thing from
them: render a small "from email" marker so an auto-created row is never mistaken for
one the owner typed. That marker is a large part of the trust the feature needs.

Mirror all of this in `src/lib/types.ts` and add both new tables to `/api/export` —
the export is the backup, and an autonomy feature whose audit trail is not in the
backup is not auditable.

### 3d. Backfill (`runOnce()`)

Seed the trust ledger from history that already exists, so the feature is not cold on
day one:

```ts
await runOnce("2026-09-autonomy-seed-trust-from-confirmed-inbox", seedTrustFromConfirmations);
```

It reads `inbox_items` where `state='confirmed'`, joins `external_events` for the
sender, and writes `confirms` per (domain, sender_domain) — capped at 3, so the
backfill can promote a sender to the *edge* of autonomy but the first real auto-apply
still happens under observation. A backfill must be `runOnce()` and not `SCHEMA`
because re-running it would resurrect trust the owner has since revoked, which is
precisely the failure `runOnce()` exists to prevent.

---

## 4. The undo/audit surface — a digest, not a queue

The queue is the thing the owner is complaining about. Replace *the interaction*, not
just the threshold.

**`GET /api/digest`** returns, deterministically from SQL:

```jsonc
{
  "since": "2026-09-05T18:22:00Z",
  "unreviewed": 12,
  "runs": [{
    "run_id": "...", "at": "...",
    "actions": [
      { "id": 41, "domain": "money", "summary": "-$18.40 Spotify",
        "because": "Receipt from billing@spotify.com · 7 confirmed, 0 corrections",
        "undoable": true, "target": { "table": "finance_transactions", "id": 812 } }
    ]
  }],
  "asked": [ /* T0 inbox items, unchanged */ ]
}
```

**Where it appears.** One line at the top of Today: *"Handled 12 things since Friday."*
Tapping opens the Inbox page, which gains a second section — **Done** above
**Needs you**. Not a badge, not a modal: the owner must be able to ignore it for a week
without anything degrading, because the entire point is to stop demanding attention.

**Undo semantics**, `POST /api/digest/[actionId]/undo`:

- Compare the current row against `fingerprint`.
  - **Unchanged** → delete it (money/school), or append a corrective manual event
    (career). `undo_result='reverted'`.
  - **Changed** → the owner already edited it; deleting would destroy their work.
    Leave the row, mark `undo_result='kept_edited'`, and say so: *"You edited this —
    kept your version, and I won't auto-apply from Spotify again."* Either way it
    counts as a **correction** against the rule.
  - **Missing** → `undo_result='gone'`, no-op.
- Undo is **durable**, unlike `useUndoableDelete`'s five seconds. There is no expiry.
  A receipt auto-applied in March is still undoable in June, because the journal is
  permanent and the cost of keeping it is a few kilobytes.

**"Looks right"** — a per-run acknowledgement that sets `reviewed_at` on the batch and
increments `confirms` on the rules involved. This is the only path by which autonomy
*grows*, and it is one tap for a whole run. That is the answer to "I don't want to
press yes and no for everything": the owner presses one button for twelve things, and
only when they feel like it. Nothing is blocked on it.

**Kill switch.** `AUTOMATION_MODE` env: `off` (today's behaviour exactly — everything
proposes), `assist` (T2 only: career, as it already works), `auto` (T1 + T2). Default
for a new install is `assist`, i.e. the current behaviour, so nobody is opted into
autonomy by upgrading. Add it to `.env.example` and the `CLAUDE.md` env table.

---

## 5. What must never auto-apply

Each of these stays T3 at **any** confidence and **any** trust level. Defended, not
merely listed.

1. **Creating a new career application.** An application is an *identity*, not a fact.
   A wrong one is not a wrong value in a field — it becomes a permanent candidate row
   that `matchApplication()` compares every future message against, so it makes
   subsequent matching worse, and its errors compound. The unmatched-email proposal
   already carries the structured fields; keeping it a question costs one tap for a
   genuinely new employer, which happens a handful of times a week at most.
2. **Any AI-derived signal.** `method === "ai"` never auto-applies. A model's
   confidence number is not calibrated against this mailbox, cannot be regression-
   tested against `tests/fixtures/emails.ts`, and can change under you when the
   provider updates a model. This preserves the existing "rules first, model second"
   contract exactly: the model may still *propose*.
3. **Any ambiguous match.** `match.ambiguous === true` is already defined as "only you
   can answer this." Attaching an OA to the wrong role at the same company corrupts a
   timeline the owner trusts, and nothing about the message will ever disambiguate it.
4. **Leaving a terminal career status.** Already enforced by `evaluateTransition()`.
   Autonomy must not add a bypass; a "we're moving forward" after a rejection remains
   far more likely to be a mis-parse than a real reversal.
5. **Deleting or editing any existing row.** Autonomy is **insert-only**, plus the
   already-guarded career status projection. The system may add; it may never
   overwrite something the owner wrote or remove something they kept. This single rule
   is what makes the blast radius of any bug bounded and the journal sufficient for
   undo.
6. **Money above `AUTO_APPLY_MAX_AMOUNT`** (default $100) and **all income**. See §2.
7. **Any date the message did not state.** `extractDate()` and `extractDeadline()`
   already refuse to compute one; autonomy must not soften that, and a school proposal
   with `dueDate === null` may not become a task unattended.
8. **Anything from a sender with `mode='never'`.** An explicit owner opt-out is
   absolute, mirroring how `AI_PROVIDER=none` is honoured absolutely.
9. **Anything past the run's action budget.** A single sync may auto-apply at most
   `AUTO_APPLY_MAX_PER_RUN` rows (default 10); beyond that, everything in the run
   drops to T0. A mailbox backfill, a cursor rewind, or a classifier regression then
   produces a long inbox instead of a hundred silent ledger rows.

---

## 6. Failure modes, and what they cost

| Failure | Cause | Cost to the owner | Mitigation in this design |
| --- | --- | --- | --- |
| Phantom transaction | `extractAmount()` takes the largest `$n` — a promotional "save $500" line in a receipt | Month total wrong; budget decisions made on it | Amount ceiling, receipt-sender-only bar, digest line shows the amount, durable undo |
| Duplicate transaction | Same purchase mailed by both merchant and card issuer; different senders, so `dedupe_key` differs | Double-counted spend | Pre-insert near-duplicate check on (amount, ±2 days) → drop to T0 with "possible duplicate" |
| Wrong deadline on School | Date regex reads a date from a footer | Owner plans around a fiction — the worst outcome in the doc | LMS-only, explicit-date-only, course-code-required; the "from email" marker on the row |
| Trust poisoning | Spoofed display name, or a real merchant sending different mail from the same domain | Autonomy granted to the wrong thing | Trust keyed on sender **domain** only; one correction resets to zero; `mode='never'` |
| Silent drift to full autonomy | Everything reliable for weeks; thresholds feel like friction and get relaxed | The failure the industry writing on autonomy tiers flags most often | Decay on read; `confirms` never increments from silence; the T3 list is not threshold-based and so cannot be relaxed by tuning |
| Digest fatigue | Owner stops reading; unreviewed grows to hundreds | Autonomy without oversight | Unreviewed count is deterministic and visible on Today; trust cannot grow while it sits, so the system gets *less* autonomous when ignored, not more |
| Undo after edit | Owner fixed an auto row, then undoes | Their edit destroyed | Fingerprint check → `kept_edited`, never delete |
| Sync failure mid-run | Exception between insert and journal write | An unattributable row | Row + journal entry go out as one `db.batch([...], "write")`, exactly as `applyEvent()` does |

The one cost with no mitigation, stated honestly: **an auto-applied row that is wrong
and never noticed stays wrong.** Undo helps only someone who looks. Autonomy trades a
small, certain, ongoing cost (clicking) for a small probability of a lasting error.
That trade is the owner's to make, which is why `AUTOMATION_MODE` exists and defaults
to today's behaviour.

---

## 7. The "central brain" — what it actually owns

New directory `src/lib/autonomy/`:

- **`policy.ts`** — pure, no DB, client-safe, mirroring `career-status.ts`.
  `decideTier(signal, match, trust, config) → { tier, reason }`. The whole tier table
  in §2 lives here as constants and one function, so it is unit-testable against
  fixtures and the UI can display the same reason string the pipeline enforced.
- **`trust.ts`** — read/update `automation_rules`, decay computed on read.
- **`journal.ts`** — `record()` and `undo()` over `automation_actions`; the only writer
  of that table.

`pipeline.ts` keeps its structure and calls `decideTier()` where it currently computes
`trustworthy`. `domains.ts` and `classify.ts` do not change at all — classification
stays a separate concern from authorisation, which is what makes both testable.

**The brain owns policy, not perception and not ranking.** Specifically:

- It does **not** classify. Rules first, model second is unchanged.
- It does **not** rank. `/api/today` keeps sorting by real dates in SQL. Nothing here
  changes that, and it should not: if ranking became a model call, the order would be
  irreproducible, untestable, unexplainable ("why is this first?"), non-deterministic
  across refreshes, and — decisively — **not undoable**. Everything else in this
  design leans on the fact that an automated decision can be shown and reversed. A
  ranking cannot be reversed; it can only be re-rolled. Deterministic ranking is what
  lets the AI's contribution stay *phrasing over facts the route computed*, which is
  the existing rule and the right one.
- What the model *may* do, optionally and additively: phrase the digest. *"Three
  receipts and a CSE 143 deadline while you were away."* Over facts `/api/digest`
  already computed, returning `null` on any failure, with the deterministic list
  underneath. Same contract as `summarizeToday()`.

So "central brain" means: **one place that decides how much to act, why, and how to
take it back** — not a component that thinks on the owner's behalf. That distinction
is what keeps the app explainable, and explainability is the actual feature; the
clicking was only ever a symptom.

---

## 8. Implementation order — smallest valuable slice first

Each stage is shippable and useful alone, and each earlier stage de-risks the next.

**Stage 0 — See what already happens.** (no behaviour change)
`automation_actions` + `journal.record()` + `GET /api/digest` (read-only) + the Today
line and the Inbox "Done" section. Career T2 auto-applies *already happen today* and
are currently invisible; this makes them visible. Ship this first regardless of
whether the rest is ever built — it is the only stage with zero risk and it produces
the data that tells the owner whether the rest is a good idea. **Success criterion
before Stage 2: two weeks of digest with the owner disagreeing with nothing.**

**Stage 1 — Undo.** `POST /api/digest/[id]/undo` with the fingerprint check, career
reversal via a corrective manual event. Now every automated action is reversible
before any new one is granted.

**Stage 2 — Money T1, narrow.** `AUTOMATION_MODE=auto`, receipt-senders only,
`confidence ≥ 0.88`, `amount ≤ 100`, expenses only, `≤ 10` per run, provenance columns,
duplicate check. No trust ledger yet — a static allow-list of sender domains in an env
var is enough to prove the mechanism, and being able to defer the ledger is why the
tiers and the trust are separate concepts.

**Stage 3 — Trust ledger.** `automation_rules`, promotion at 3, demotion on any
correction, decay on read, `runOnce()` seed, and a small management panel in the Inbox
page (list of rules with an "always ask" / "never" toggle). This is what turns the
static allow-list into something that grows on its own.

**Stage 4 — School T1.** LMS senders, explicit dates, parsed course codes only. Later
than money deliberately: a wrong deadline is the more expensive error, so it should
run behind the more mature machinery.

**Stage 5 — Polish.** AI digest phrasing (optional), per-run "looks right", weekly
rollup instead of per-sync.

Tests to add alongside, in the existing style: `tests/policy.test.ts` (pure tier
decisions over fixtures — the regression suite for autonomy), plus pipeline tests for
"an auto-applied row is journaled", "undo after an edit keeps the edit", "a correction
demotes the sender", "the run budget forces overflow to proposals". **No existing test
should need to change** — every guarantee in `tests/pipeline.test.ts` holds under
`AUTOMATION_MODE=assist`, which is the default, and the suite already sets
`AI_PROVIDER=none`.

---

## 9. Open questions for the owner

Implementation should not start until these are answered — they change the design, not
just the constants.

1. **What is the money ceiling?** $100 is a guess. What is the largest charge you'd be
   comfortable finding in the ledger without having approved it?
2. **Is a wrong number worse than a missing one?** If a receipt is ambiguous, would you
   rather it be absent from Money (and your total be quietly low), or present and
   possibly wrong? This determines whether borderline money goes to T0 or is dropped.
3. **How often will you actually read the digest?** Daily, weekly, or "when I notice
   the line on Today"? If the honest answer is "rarely", Stage 2 should not ship —
   autonomy with unread oversight is just unaudited automation, and the T1 bar should
   move to T0 permanently.
4. **Three confirms — right number?** It is a judgement, not a derivation. Higher is
   safer and slower to feel automatic.
5. **School: is a wrong deadline recoverable for you?** If a phantom deadline would
   genuinely cost you (studied for the wrong thing, missed the real one), Stage 4
   should be dropped and School should stay confirm-forever. That is a legitimate
   final answer.
6. **Do you want a "quiet hours" bound** — e.g. no auto-apply during exam weeks, when
   attention is lowest and the cost of a wrong deadline is highest?
7. **Should the digest be pushed anywhere** (email, a PWA notification), or is the
   Today line enough? Pushing changes the calculus on how much may be T2.

---

## 10. Research notes — reached vs. blocked

Recorded honestly, per the owner's request, because the value of research is
worthless if its provenance is not.

**Skills.** Searched the skills catalogue for *email ingestion, automation autonomy,
audit log, system design, trust scoring* — **zero results**. Nothing in the available
skill set (they are Artifact/design/document/office-format oriented) applies to this
problem. No skill informed this document.

**GitHub.** This session's GitHub access is scoped to this repository only. I did
**not** browse other repositories, and nothing here is drawn from another codebase.

**Web.** Search worked; page fetching largely did not.

- *Reached (search-result snippets only):* an autonomy-ladder framing that grades
  actions on **reversibility × blast radius × stakes**, with levels running from
  silent-autonomous through **notify-after-with-undo** and confirm-before to
  forbidden. It also names the characteristic failure mode as **gradual drift toward
  full autonomy** because approval prompts feel like friction, and prescribes
  *automatic demotion on risk signals* rather than relying on a human to notice. That
  framing directly shaped §2's tiers (T1 is exactly "notify-after with undo"), §5's
  threshold-independent never-list, and §6's drift row.
- *Reached (snippets):* consumer finance tooling converges on **learn a rule from a
  correction, keyed to the merchant, and show the rule that fired** ("auto-categorized
  by rule: Starbucks → Coffee", with one tap to fix). That is the origin of §4's
  `because` field and §3a's rule scoping — though the decay rule and the
  "silence is not consent" rule are mine, not theirs.
- *Reached (snippets):* Gmail auto-adds events from mail to Calendar by default and
  the control is a global on/off in settings. I read this as a **negative** example:
  a global toggle with no per-source control and no "here's what I added" review is
  the design this document is deliberately not copying.
- **Blocked by the egress proxy** (`EGRESS_BLOCKED`, all `WebFetch`):
  `arxiv.org` (the *Design Patterns for ML-Based Systems with Human-in-the-Loop*
  paper, 2312.00582), `techcommunity.microsoft.com` (Foundry HITL patterns),
  `support.google.com`. I could not read any of these in full.

**Therefore:** everything specific in this document — the four tiers as applied to
*this* schema, every threshold and its tie to an existing constant, the journal-versus-
event-sourcing trade, the fingerprint undo, the trust decay rule, the never-list, the
staging — **is my own reasoning about this codebase, not a citation.** The external
material contributed vocabulary and one useful warning; it contributed no numbers.
