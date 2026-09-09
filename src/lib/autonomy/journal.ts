import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { applyEvent } from "@/lib/career";
import { recordConfirmation, recordCorrection, type RuleDomain } from "@/lib/autonomy/trust";
import type { Tier } from "@/lib/autonomy/policy";
import type {
  UndoResult,
  DigestAction,
  Digest,
} from "@/lib/autonomy/digest-types";
import type { ApplicationStatus } from "@/lib/types";

/**
 * The record of everything the sync did on its own, and the only way to undo it.
 *
 * Without this, an automatic write is indistinguishable from one you made and
 * forgot: no way to see what happened while you were away, no way to take it
 * back, and no way to tell whether the automation is worth keeping. The journal
 * is what makes acting unattended defensible rather than merely convenient.
 *
 * Undo here is **durable**, unlike `useUndoableDelete`'s five seconds. A receipt
 * auto-applied in March is still undoable in June: the journal is permanent and
 * costs a few kilobytes, while the moment you notice a wrong row is not
 * something the app gets to schedule.
 *
 * The only writer of `automation_actions`.
 */

export type { UndoResult, DigestAction, Digest } from "@/lib/autonomy/digest-types";

export interface JournalEntry {
  runId: string;
  domain: "career" | "school" | "money";
  tier: Tier;
  action: string;
  targetTable: string;
  targetId: number;
  externalEventId: number | null;
  /**
   * The sender domain that authorised this, so undo can demote the rule
   * without a join back through external_events.
   */
  scopeKey?: string | null;
  /** What was done, in the owner's terms: "-$18.40 Spotify". */
  summary: string;
  /** Why it was allowed to happen unattended. Shown verbatim. */
  because: string;
  /** Exactly the fields written, for the edit check on undo. */
  payload: Record<string, unknown>;
  score?: number | null;
}

/**
 * A stable hash of the written fields.
 *
 * Keys are sorted so a reordered object is the same row, and the payload is the
 * *written* values rather than the whole row — an `updated_at` that moved on its
 * own must not read as an edit you made.
 */
export function fingerprint(payload: Record<string, unknown>): string {
  const sorted = Object.keys(payload)
    .sort()
    .map((k) => [k, payload[k]] as const);
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 32);
}

/** One sync is one run, so a digest can group by "while you were away". */
export function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function record(entry: JournalEntry): Promise<number> {
  const result = await db.execute({
    sql: `INSERT INTO automation_actions
            (run_id, domain, tier, action, target_table, target_id, external_event_id,
             scope_key, summary, because, payload, fingerprint, score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    args: [
      entry.runId,
      entry.domain,
      entry.tier,
      entry.action,
      entry.targetTable,
      entry.targetId,
      entry.externalEventId,
      entry.scopeKey ?? null,
      entry.summary,
      entry.because,
      JSON.stringify(entry.payload),
      fingerprint(entry.payload),
      entry.score ?? null,
    ],
  });
  return Number(result.rows[0].id);
}

function toAction(row: Record<string, unknown>): DigestAction {
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    domain: String(row.domain),
    tier: String(row.tier),
    summary: String(row.summary),
    because: String(row.because),
    appliedAt: String(row.applied_at),
    reviewed: row.reviewed_at !== null,
    edited: row.edited_at !== null && row.edited_at !== undefined,
    undoneAt: (row.undone_at as string | null) ?? null,
    undoResult: (row.undo_result as UndoResult | null) ?? null,
    target: { table: String(row.target_table), id: Number(row.target_id) },
  };
}

/**
 * Notice rows you edited after the sync wrote them.
 *
 * An edit is the most informative correction there is — the machine got it
 * *nearly* right, which is exactly the failure a confidence threshold cannot
 * see — and waiting for an undo would miss it entirely, because fixing a row is
 * the natural thing to do and undoing it afterwards is not.
 *
 * Run on read rather than by a cron, which is this repo's convention (cf.
 * `rolloverRecurringChecklist()`), and recorded with `edited_at` so one edit
 * counts once however many times the digest is opened.
 */
async function reconcileEdits(): Promise<void> {
  const open = await db.execute(
    `SELECT id, domain, scope_key, target_table, target_id, payload, fingerprint
       FROM automation_actions
      WHERE undone_at IS NULL AND edited_at IS NULL
        AND target_table IN ('finance_transactions', 'school_tasks')`
  );

  for (const action of open.rows) {
    const table = String(action.target_table);
    const current = await db.execute({
      sql: `SELECT * FROM ${table === "school_tasks" ? "school_tasks" : "finance_transactions"} WHERE id = ?`,
      args: [Number(action.target_id)],
    });
    const row = current.rows[0];
    // A missing row is a deletion, not an edit. You removing something you did
    // not want is already expressed by it being gone; counting it as a sender
    // mistake would demote on an act that says nothing about the reading.
    if (!row) continue;

    const payload = JSON.parse(String(action.payload)) as Record<string, unknown>;
    const now = fingerprint(writtenFields(payload, row as unknown as Record<string, unknown>));
    if (now === String(action.fingerprint)) continue;

    await db.execute({
      sql: "UPDATE automation_actions SET edited_at = datetime('now') WHERE id = ?",
      args: [Number(action.id)],
    });
    await recordCorrection(
      String(action.domain) as RuleDomain,
      (action.scope_key as string | null) ?? null
    );
  }
}

export async function getDigest(limit = 50): Promise<Digest> {
  await reconcileEdits();

  const [rows, unreviewed] = await Promise.all([
    db.execute({
      sql: `SELECT * FROM automation_actions ORDER BY applied_at DESC, id DESC LIMIT ?`,
      args: [limit],
    }),
    db.execute(
      "SELECT COUNT(*) AS c FROM automation_actions WHERE reviewed_at IS NULL AND undone_at IS NULL"
    ),
  ]);

  const actions = rows.rows.map((r) => toAction(r as unknown as Record<string, unknown>));
  return {
    actions,
    unreviewed: Number(unreviewed.rows[0]?.c ?? 0),
    since: actions.length ? actions[actions.length - 1].appliedAt : null,
  };
}

/**
 * Acknowledge a batch. One tap for a whole run, and only when you feel like it.
 *
 * This is the answer to "I don't want to press yes and no for everything":
 * nothing is *blocked* on it. Reviewing is how you tell the system it got
 * things right; not reviewing costs nothing except that trust stops growing —
 * which is the correct direction. A system that is ignored should become less
 * autonomous, not more.
 */
export async function markReviewed(runId?: string): Promise<number> {
  // Which senders are being agreed with, read before the flag is set so the
  // same rows are not counted twice by a second tap.
  const pending = runId
    ? await db.execute({
        sql: "SELECT domain, scope_key FROM automation_actions WHERE run_id = ? AND reviewed_at IS NULL AND undone_at IS NULL",
        args: [runId],
      })
    : await db.execute(
        "SELECT domain, scope_key FROM automation_actions WHERE reviewed_at IS NULL AND undone_at IS NULL"
      );

  const result = runId
    ? await db.execute({
        sql: "UPDATE automation_actions SET reviewed_at = datetime('now') WHERE run_id = ? AND reviewed_at IS NULL",
        args: [runId],
      })
    : await db.execute(
        "UPDATE automation_actions SET reviewed_at = datetime('now') WHERE reviewed_at IS NULL"
      );

  // "Looks right" is an explicit act, so it is one of the two things that may
  // grow autonomy. One sender is credited once per acknowledgement however many
  // rows it produced: agreeing with a batch is one judgement, not twelve.
  const credited = new Set<string>();
  for (const row of pending.rows) {
    const scopeKey = (row.scope_key as string | null) ?? null;
    if (!scopeKey) continue;
    const key = `${row.domain}:${scopeKey}`;
    if (credited.has(key)) continue;
    credited.add(key);
    await recordConfirmation(String(row.domain) as RuleDomain, scopeKey);
  }

  return result.rowsAffected;
}

/**
 * Take back one automated write.
 *
 * Three outcomes, and the middle one is the point:
 *
 * - **reverted** — the row is exactly as written, so it is removed (or, for
 *   career, corrected with an appended manual event; the log is append-only and
 *   an event is never deleted).
 * - **kept_edited** — you already changed it. Deleting would destroy your work,
 *   so the row stays and the journal records that. Undo must never cost you an
 *   edit you made deliberately.
 * - **gone** — already deleted by hand. Nothing to do.
 */
export async function undoAction(id: number): Promise<{ result: UndoResult; message: string }> {
  const found = await db.execute({
    sql: "SELECT * FROM automation_actions WHERE id = ?",
    args: [id],
  });
  const action = found.rows[0];
  if (!action) throw new Error("No such action");
  if (action.undone_at) {
    return {
      result: (action.undo_result as UndoResult) ?? "gone",
      message: "Already undone.",
    };
  }

  const payload = JSON.parse(String(action.payload)) as Record<string, unknown>;
  const table = String(action.target_table);
  const targetId = Number(action.target_id);

  let result: UndoResult;
  let message: string;

  if (table === "applications") {
    // Career is already event-sourced: reversing means appending a corrective
    // manual event, which evaluateTransition() accepts unconditionally. The
    // original event stays, because the timeline explaining a status you later
    // corrected is the whole point of the log.
    const previous = (payload.fromStatus as ApplicationStatus | null) ?? null;
    if (previous) {
      await applyEvent({
        applicationId: targetId,
        kind: "status_change",
        toStatus: previous,
        occurredOn: String(payload.occurredOn ?? new Date().toISOString().slice(0, 10)),
        detail: "Undone from the digest",
        source: "manual",
      });
      result = "reverted";
      message = `Put back to ${previous}.`;
    } else {
      result = "gone";
      message = "Nothing recorded to go back to.";
    }
  } else {
    const current = await db.execute({
      sql: `SELECT * FROM ${table === "school_tasks" ? "school_tasks" : "finance_transactions"} WHERE id = ?`,
      args: [targetId],
    });
    const row = current.rows[0];
    if (!row) {
      result = "gone";
      message = "That row is already gone.";
    } else if (fingerprint(writtenFields(payload, row as unknown as Record<string, unknown>)) !== String(action.fingerprint)) {
      result = "kept_edited";
      message = "You edited this, so it was kept as you left it.";
    } else {
      await db.execute({
        sql: `DELETE FROM ${table === "school_tasks" ? "school_tasks" : "finance_transactions"} WHERE id = ?`,
        args: [targetId],
      });
      result = "reverted";
      message = "Removed.";
    }
  }

  await db.execute({
    sql: "UPDATE automation_actions SET undone_at = datetime('now'), undo_result = ?, reviewed_at = COALESCE(reviewed_at, datetime('now')) WHERE id = ?",
    args: [result, id],
  });

  // Taking something back is a correction against the sender that authorised
  // it, whether the row was reverted or kept as you edited it: both mean the
  // machine did not get it right. `gone` is not — you deleted the row yourself,
  // which says nothing about whether it was read correctly.
  if (result !== "gone") {
    await recordCorrection(
      String(action.domain) as RuleDomain,
      (action.scope_key as string | null) ?? null
    );
  }

  return { result, message };
}

/**
 * The current values of exactly the fields that were written.
 *
 * Comparing whole rows would call a bumped `updated_at` an edit, and comparing
 * nothing would delete work you did. The written fields are the only honest
 * definition of "unchanged since the sync touched it".
 */
function writtenFields(
  payload: Record<string, unknown>,
  row: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    const value = row[key];
    // SQLite hands numbers back as numbers and text as text, but a value
    // written as a number can come back as a bigint from libSQL.
    out[key] = typeof value === "bigint" ? Number(value) : value ?? null;
  }
  return out;
}
