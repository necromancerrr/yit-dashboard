import { db } from "@/lib/db";
import { todayISO } from "@/lib/date";
import { senderDomain } from "@/lib/ingest/normalize";
import type { RuleMode } from "@/lib/autonomy/rule-types";
import {
  assessTrust,
  effectiveConfirms,
  requiredConfirms,
  type TrustRecord,
  type TrustVerdict,
} from "@/lib/autonomy/policy";

/**
 * The ledger of what each sender has earned.
 *
 * Reading and writing only. Every judgement about *what the numbers mean* lives
 * in `policy.ts`, which is pure — so the lapse rule, the promotion bar and the
 * cost of a past mistake are all testable without a database, and the UI can
 * show the same sentence the pipeline enforced.
 *
 * One rule governs every write here: **silence is never consent.** `confirms`
 * moves only on an explicit act — confirming a proposal, or acknowledging a
 * digest. A row nobody looked at is not evidence of anything, so a system being
 * ignored becomes *less* autonomous over time rather than more. That is the
 * opposite of the usual drift, and it is deliberate.
 */

export type RuleDomain = "career" | "school" | "money";
export type { RuleMode } from "@/lib/autonomy/rule-types";

export interface AutomationRule extends TrustRecord {
  id: number;
  domain: RuleDomain;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: Record<string, unknown>): AutomationRule {
  return {
    id: Number(row.id),
    domain: String(row.domain) as RuleDomain,
    scopeKey: String(row.scope_key),
    confirms: Number(row.confirms),
    corrections: Number(row.corrections),
    mode: String(row.mode) as RuleMode,
    lastConfirmedAt: (row.last_confirmed_at as string | null) ?? null,
    lastAppliedAt: (row.last_applied_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * The key a rule is filed under.
 *
 * The **envelope sender domain**, lowercased, never the display name. Display
 * names are attacker-controlled; `merchantFrom()` prefers `senderName` for the
 * *category*, which is fine for a label and unacceptable as an authorization
 * key — "Spotify Billing" in the From line costs nothing to type.
 */
export function scopeKeyFor(senderEmail: string | null): string | null {
  return senderDomain(senderEmail);
}

export async function getRule(
  domain: RuleDomain,
  scopeKey: string | null
): Promise<AutomationRule | null> {
  if (!scopeKey) return null;
  const found = await db.execute({
    sql: "SELECT * FROM automation_rules WHERE domain = ? AND scope = 'sender_domain' AND scope_key = ?",
    args: [domain, scopeKey],
  });
  const row = found.rows[0];
  return row ? toRecord(row as unknown as Record<string, unknown>) : null;
}

export async function listRules(): Promise<
  (AutomationRule & { verdict: TrustVerdict })[]
> {
  const today = todayISO();
  const rows = await db.execute(
    "SELECT * FROM automation_rules ORDER BY domain, confirms DESC, scope_key"
  );
  return rows.rows.map((row) => {
    const rule = toRecord(row as unknown as Record<string, unknown>);
    return { ...rule, verdict: assessTrust(rule, today) };
  });
}

/** Create the row if it is missing, so counters can be applied to it. */
async function ensureRule(domain: RuleDomain, scopeKey: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO automation_rules (domain, scope, scope_key)
          VALUES (?, 'sender_domain', ?)
          ON CONFLICT(domain, scope, scope_key) DO NOTHING`,
    args: [domain, scopeKey],
  });
}

/**
 * Record that you explicitly agreed with something this sender produced.
 *
 * The only path by which autonomy grows. Called from confirming an inbox item
 * and from acknowledging a digest run — both are acts, not absences.
 */
export async function recordConfirmation(
  domain: RuleDomain,
  scopeKey: string | null
): Promise<void> {
  if (!scopeKey) return;
  await ensureRule(domain, scopeKey);
  await db.execute({
    sql: `UPDATE automation_rules
             SET confirms = confirms + 1,
                 last_confirmed_at = ?,
                 updated_at = datetime('now')
           WHERE domain = ? AND scope = 'sender_domain' AND scope_key = ?`,
    args: [todayISO(), domain, scopeKey],
  });
}

/**
 * Record that this sender got something wrong.
 *
 * Confirmations reset to zero and the bar to earn trust back rises by one.
 * There is no averaging: a single correction demotes, because the failure being
 * guarded against is a sender that is right often enough to accumulate a good
 * average while still being wrong in a way that costs you.
 *
 * A rule already set to `never` is left alone — that is your decision, and a
 * counter must not quietly rewrite it.
 */
export async function recordCorrection(
  domain: RuleDomain,
  scopeKey: string | null
): Promise<void> {
  if (!scopeKey) return;
  await ensureRule(domain, scopeKey);
  await db.execute({
    sql: `UPDATE automation_rules
             SET corrections = corrections + 1,
                 confirms = 0,
                 mode = CASE WHEN mode = 'never' THEN 'never' ELSE 'ask' END,
                 updated_at = datetime('now')
           WHERE domain = ? AND scope = 'sender_domain' AND scope_key = ?`,
    args: [domain, scopeKey],
  });
}

/** Note that this sender was acted on, so the record does not read as idle. */
export async function noteApplied(
  domain: RuleDomain,
  scopeKey: string | null
): Promise<void> {
  if (!scopeKey) return;
  await ensureRule(domain, scopeKey);
  await db.execute({
    sql: `UPDATE automation_rules
             SET last_applied_at = ?, updated_at = datetime('now')
           WHERE domain = ? AND scope = 'sender_domain' AND scope_key = ?`,
    args: [todayISO(), domain, scopeKey],
  });
}

/**
 * Set a rule by hand.
 *
 * `never` is how autonomy is taken back per source rather than globally, and it
 * is absolute — no accumulated confidence overrules it. `auto` is the mirror
 * image: a deliberate grant that does not wait for the counter, for a sender
 * you already know you trust.
 */
export async function setRuleMode(id: number, mode: RuleMode): Promise<AutomationRule | null> {
  await db.execute({
    sql: "UPDATE automation_rules SET mode = ?, updated_at = datetime('now') WHERE id = ?",
    args: [mode, id],
  });
  const found = await db.execute({ sql: "SELECT * FROM automation_rules WHERE id = ?", args: [id] });
  const row = found.rows[0];
  return row ? toRecord(row as unknown as Record<string, unknown>) : null;
}

/** How this sender stands today, lapse included. */
export async function assess(
  domain: RuleDomain,
  scopeKey: string | null
): Promise<TrustVerdict> {
  return assessTrust(await getRule(domain, scopeKey), todayISO());
}

/**
 * A one-line summary of the ledger, for the Setup page.
 *
 * Turning `AUTOMATION_MODE=auto` on and seeing nothing happen is the failure
 * this exists to prevent: a fresh ledger means *nothing* auto-applies until
 * senders have been confirmed a few times, and that is correct behaviour rather
 * than a broken feature — but only if the app says so.
 */
export async function trustSummary(): Promise<{ trusted: number; learning: number; off: number }> {
  const today = todayISO();
  const rows = await db.execute("SELECT * FROM automation_rules");
  let trusted = 0;
  let learning = 0;
  let off = 0;
  for (const row of rows.rows) {
    const rule = toRecord(row as unknown as Record<string, unknown>);
    if (rule.mode === "never") off += 1;
    else if (rule.mode === "auto" || effectiveConfirms(rule, today) >= requiredConfirms(rule))
      trusted += 1;
    else learning += 1;
  }
  return { trusted, learning, off };
}
