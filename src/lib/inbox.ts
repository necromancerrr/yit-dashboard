import { db } from "@/lib/db";
import { shiftISODate, todayISO } from "@/lib/date";
import { isTerminal } from "@/lib/career-status";

/**
 * The Yit OS inbox: things the system noticed on its own.
 *
 * Everything generated here is derived from data already in the database. No
 * email connection is required, and nothing is invented — a "stale
 * application" item exists because an application genuinely has no event in N
 * days, and the item says exactly that. When ingestion arrives it becomes a
 * second producer writing into the same table, not a replacement for this one.
 */

/** An application with no activity for this long is worth a nudge. */
const STALE_AFTER_DAYS = 14;

/** How far ahead a dated commitment starts competing for attention. */
const DEADLINE_HORIZON_DAYS = 7;

interface DerivedItem {
  kind: string;
  title: string;
  detail: string | null;
  severity: "info" | "attention" | "urgent";
  applicationId: number | null;
  dedupeKey: string;
}

/**
 * Recompute derived items and upsert them.
 *
 * `dedupe_key` carries the *situation*, not the moment of noticing — so a
 * still-stale application re-derives to the same key and updates its existing
 * row rather than adding a second one. That is what keeps the inbox from
 * turning into a nag: one open item per real thing, however many times the
 * sweep runs.
 *
 * A dismissed item stays dismissed, because the key still matches. It comes
 * back only when the underlying situation genuinely changes (a different week
 * bucket, a new status), which is a new key.
 */
export async function refreshDerivedInbox(today: string = todayISO()): Promise<void> {
  const horizon = shiftISODate(today, DEADLINE_HORIZON_DAYS);
  const staleBefore = shiftISODate(today, -STALE_AFTER_DAYS);

  const [stale, deadlines, schoolDue] = await Promise.all([
    db.execute({
      sql: `SELECT id, company, role, status, last_activity_date
            FROM applications
            WHERE status NOT IN ('Rejected', 'Withdrawn', 'Offer')
              AND COALESCE(last_activity_date, applied_date) IS NOT NULL
              AND COALESCE(last_activity_date, applied_date) < ?`,
      args: [staleBefore],
    }),
    db.execute({
      sql: `SELECT id, company, role, next_action_date, next_action_label
            FROM applications
            WHERE next_action_date IS NOT NULL
              AND next_action_date >= ?
              AND next_action_date <= ?
              AND status NOT IN ('Rejected', 'Withdrawn')`,
      args: [today, horizon],
    }),
    db.execute({
      sql: `SELECT id, course, title, due_date
            FROM school_tasks
            WHERE status != 'Done' AND due_date IS NOT NULL
              AND due_date >= ? AND due_date <= ?`,
      args: [today, horizon],
    }),
  ]);

  const derived: DerivedItem[] = [];

  for (const row of stale.rows) {
    const last = (row.last_activity_date as string | null) ?? "";
    const days = daysBetween(last, today);
    const company = row.company as string;
    derived.push({
      kind: "stale_application",
      title: `${company} hasn't moved in ${days} days`,
      detail: `Still ${row.status as string}${row.role ? ` · ${row.role as string}` : ""}. Worth a follow-up.`,
      severity: "info",
      applicationId: Number(row.id),
      // Bucketed by week so a long-stale application nudges again occasionally
      // instead of once and never, without nagging every single day.
      dedupeKey: `stale:${row.id}:${Math.floor(days / 7)}`,
    });
  }

  for (const row of deadlines.rows) {
    const due = row.next_action_date as string;
    const days = daysBetween(today, due);
    derived.push({
      kind: "career_deadline",
      title: `${row.company as string} ${(row.next_action_label as string | null) ?? "deadline"} ${relativeDay(days)}`,
      detail: row.role ? (row.role as string) : null,
      severity: days <= 2 ? "urgent" : "attention",
      applicationId: Number(row.id),
      dedupeKey: `career_deadline:${row.id}:${due}`,
    });
  }

  for (const row of schoolDue.rows) {
    const due = row.due_date as string;
    const days = daysBetween(today, due);
    derived.push({
      kind: "school_deadline",
      title: `${row.title as string} due ${relativeDay(days)}`,
      detail: row.course as string,
      severity: days <= 1 ? "urgent" : "attention",
      applicationId: null,
      dedupeKey: `school_deadline:${row.id}:${due}`,
    });
  }

  for (const item of derived) {
    await db.execute({
      sql: `INSERT INTO inbox_items (kind, title, detail, severity, application_id, dedupe_key)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedupe_key) DO UPDATE SET
              title = excluded.title,
              detail = excluded.detail,
              severity = excluded.severity`,
      args: [
        item.kind,
        item.title,
        item.detail,
        item.severity,
        item.applicationId,
        item.dedupeKey,
      ],
    });
  }

  // Retire open items whose situation has resolved — a deadline that passed, an
  // application that has since moved. Leaving them would make the inbox a list
  // of things that used to matter.
  const liveKeys = derived.map((d) => d.dedupeKey);
  const placeholders = liveKeys.map(() => "?").join(", ");
  await db.execute({
    sql: `UPDATE inbox_items
          SET state = 'dismissed', resolved_at = datetime('now')
          WHERE state = 'open'
            AND kind IN ('stale_application', 'career_deadline', 'school_deadline')
            ${liveKeys.length ? `AND dedupe_key NOT IN (${placeholders})` : ""}`,
    args: liveKeys,
  });
}

function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function relativeDay(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export { STALE_AFTER_DAYS, DEADLINE_HORIZON_DAYS, daysBetween, relativeDay, isTerminal };
