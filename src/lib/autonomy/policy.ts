import type { DomainSignal } from "@/lib/ingest/domains";

/**
 * How much the sync is allowed to do on its own, and why.
 *
 * Pure: no database, no clock, no environment read at decision time — the mode
 * and the budget are passed in. That is what lets the whole policy be tested
 * against fixtures, and it mirrors `career-status.ts`, which is kept pure so
 * the client can share the exact rules the API enforces.
 *
 * The doctrine this replaces was "propose before create". The doctrine it
 * replaces it *with* is narrower, not looser:
 *
 * > Act only where you can prove it and undo it. A write the sync makes on its
 * > own must be journaled, attributable to a message, reversible, and inside
 * > the run's budget. Everything else still proposes.
 *
 * The brain owns **policy** — how much to act, why, and how to take it back.
 * It does not classify (rules first, model second is unchanged) and it does not
 * rank (`/api/today` still sorts by real dates in SQL). Both of those would be
 * decisions that cannot be shown and cannot be reversed, and everything here
 * leans on the fact that an automated decision can be both.
 */

/** What the owner experiences, not what the code does. */
export type Tier =
  /** Ask. An inbox item, exactly as today. */
  | "ask"
  /** Act and tell. Written, journaled, in the digest with an undo. */
  | "act_tell"
  /** Act and log. Written, journaled, visible only if looked for. */
  | "act_log"
  /** Never, at any confidence. */
  | "never";

export type AutomationMode = "off" | "assist" | "auto";

export interface TierDecision {
  tier: Tier;
  /** One sentence, shown to the owner verbatim. Never a code. */
  reason: string;
}

/**
 * The bar a deterministic career signal already clears today.
 * `AUTO_APPLY_MIN_CONFIDENCE * 0.9` — kept as the literal it evaluates to so
 * this module stays free of ingest imports, with the test pinning the two
 * together.
 */
export const CAREER_AUTO_BAR = 0.81;

/**
 * The `fromReceiptSender` confidence in `domains.ts`, deliberately.
 *
 * It means "only mail from a billing-shaped sender may auto-apply" — the same
 * structural signal `fromLMS` gives school. Generic "this message mentions $40"
 * scores 0.72 and stays a question forever.
 */
export const MONEY_AUTO_BAR = 0.88;

/** The `fromLMS` confidence. A `.edu` sender alone (0.75) is not enough. */
export const SCHOOL_AUTO_BAR = 0.9;

/**
 * The largest charge that may appear in the ledger without being approved.
 *
 * A guess, and the owner's to change. It is a ceiling rather than a percentage
 * because the cost of a phantom charge is absolute, not relative to anything
 * the app knows.
 */
export const AUTO_APPLY_MAX_AMOUNT = 100;

/**
 * How many rows one sync may write unattended.
 *
 * Past this, everything in the run drops to `ask`. A mailbox backfill, a cursor
 * rewind or a classifier regression then produces a long inbox instead of a
 * hundred silent ledger rows — a bounded blast radius is the difference between
 * a bad afternoon and a corrupted ledger.
 */
export const AUTO_APPLY_MAX_PER_RUN = 10;

export function parseMode(raw: string | undefined): AutomationMode {
  const value = raw?.trim().toLowerCase();
  if (value === "off" || value === "auto") return value;
  // Anything unset or unrecognised means today's behaviour. Nobody is opted
  // into autonomy by upgrading, and a typo in the variable never widens it.
  return "assist";
}

export interface CareerContext {
  method: "deterministic" | "ai";
  /** signal.confidence x match.confidence, as the pipeline already computes. */
  combined: number;
  ambiguous: boolean;
  /** False when the message matched no existing application. */
  hasMatch: boolean;
}

export interface RunContext {
  mode: AutomationMode;
  /** Rows already written unattended in this run. */
  actionsSoFar: number;
  maxPerRun?: number;
}

const ASK = (reason: string): TierDecision => ({ tier: "ask", reason });

/**
 * A career status change on an application that already exists.
 *
 * This is `act_log` rather than `act_tell` because the mistake is cheap and
 * self-correcting: `application_events` is append-only, the timeline explains
 * the card, and `applyEvent()` refuses regressions, terminal reopens and
 * anything older than a correction made by hand. This tier is what the app
 * already does today — the journal just makes it visible.
 */
export function decideCareerTier(ctx: CareerContext, run: RunContext): TierDecision {
  if (run.mode === "off") return ASK("Automation is off");
  if (!ctx.hasMatch) {
    // An application is an identity, not a fact. A wrong one becomes a
    // permanent candidate that every future message is matched against, so its
    // errors compound rather than sit still.
    return { tier: "never", reason: "Creating an application is always your call" };
  }
  if (ctx.ambiguous) return ASK("More than one application could be this one");
  if (ctx.method !== "deterministic") {
    // A model's confidence is not calibrated against this mailbox, cannot be
    // regression-tested against the fixtures, and can change under you when the
    // provider updates a model.
    return ASK("Read by a model, so it needs a look");
  }
  if (ctx.combined < CAREER_AUTO_BAR) {
    return ASK(`Only ${Math.round(ctx.combined * 100)}% sure this is the right application`);
  }
  if (overBudget(run)) return ASK(budgetReason(run));
  return { tier: "act_log", reason: "Recruiting mail matched one application" };
}

export interface MoneyContext {
  confidence: number;
  amount: number;
  type: "income" | "expense";
  method: "deterministic" | "ai";
  /** True when another transaction of the same amount is within a couple of days. */
  possibleDuplicate?: boolean;
}

export function decideMoneyTier(ctx: MoneyContext, run: RunContext): TierDecision {
  // `auto` is opt-in. Money is the domain where a wrong row becomes a wrong
  // number on the home screen, so it does not ride along with `assist`.
  if (run.mode !== "auto") return ASK("Receipts are confirmed by you");
  if (ctx.method !== "deterministic") return ASK("Read by a model, so it needs a look");
  if (ctx.type === "income") {
    // extractAmount takes the largest figure in the text and the income/expense
    // split is a regex on words like "refund". A misfiled expense understates
    // the month; a phantom income overstates what you have. The error is not
    // symmetric, so the tier is not either.
    return ASK("Money coming in is always confirmed");
  }
  if (ctx.confidence < MONEY_AUTO_BAR) {
    return ASK("Not from a billing sender, so the amount is a guess");
  }
  if (!(ctx.amount > 0) || ctx.amount > AUTO_APPLY_MAX_AMOUNT) {
    return ASK(`Over the $${AUTO_APPLY_MAX_AMOUNT} auto-apply limit`);
  }
  if (ctx.possibleDuplicate) {
    // The same purchase mailed by both the merchant and the card issuer has
    // different senders, so dedupe_key differs and nothing else would catch it.
    return ASK("Looks like a charge that is already recorded");
  }
  if (overBudget(run)) return ASK(budgetReason(run));
  return { tier: "act_tell", reason: "Receipt from a billing sender, under the limit" };
}

export interface SchoolContext {
  confidence: number;
  method: "deterministic" | "ai";
  /** A date the message actually stated. Never one computed from "Friday". */
  dueDate: string | null;
  /** False when the course fell back to the generic label. */
  courseParsed: boolean;
}

export function decideSchoolTier(ctx: SchoolContext, run: RunContext): TierDecision {
  if (run.mode !== "auto") return ASK("Deadlines are confirmed by you");
  if (ctx.method !== "deterministic") return ASK("Read by a model, so it needs a look");
  if (ctx.confidence < SCHOOL_AUTO_BAR) {
    return ASK("Not from a course platform, so this needs a look");
  }
  if (!ctx.dueDate) {
    // extractDate refuses to compute a date the message did not state, and
    // autonomy must not soften that: you plan around a deadline without
    // questioning it, which is what makes a wrong one worse than none.
    return ASK("No date written in the message");
  }
  if (!ctx.courseParsed) return ASK("Could not tell which course this is for");
  if (overBudget(run)) return ASK(budgetReason(run));
  return { tier: "act_tell", reason: "Course platform message with a stated date" };
}

function limit(run: RunContext): number {
  return run.maxPerRun ?? AUTO_APPLY_MAX_PER_RUN;
}

function overBudget(run: RunContext): boolean {
  return run.actionsSoFar >= limit(run);
}

function budgetReason(run: RunContext): string {
  return `Already handled ${limit(run)} things this sync — the rest are here to check`;
}

/** Convenience for the pipeline: does this tier write a row? */
export function tierActs(tier: Tier): boolean {
  return tier === "act_tell" || tier === "act_log";
}

/**
 * Route a domain signal to its decision.
 *
 * Kept here rather than in the pipeline so every "may this be automatic?"
 * question in the app has exactly one answer, and so the UI can show the same
 * sentence the pipeline enforced.
 */
export function decideDomainTier(
  signal: DomainSignal,
  run: RunContext,
  opts: { method?: "deterministic" | "ai"; possibleDuplicate?: boolean } = {}
): TierDecision {
  const method = opts.method ?? "deterministic";
  if (signal.domain === "money") {
    if (!signal.money) return ASK("No amount in the message");
    return decideMoneyTier(
      {
        confidence: signal.confidence,
        amount: signal.money.amount,
        type: signal.money.type,
        method,
        possibleDuplicate: opts.possibleDuplicate,
      },
      run
    );
  }
  if (!signal.school) return ASK("Nothing to file");
  return decideSchoolTier(
    {
      confidence: signal.confidence,
      method,
      dueDate: signal.school.dueDate,
      courseParsed: signal.school.course.trim().toLowerCase() !== "course",
    },
    run
  );
}
