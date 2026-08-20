import { db } from "@/lib/db";
import { todayISO } from "@/lib/date";
import { evaluateTransition } from "@/lib/career-status";

/**
 * Database-touching career operations.
 *
 * The pipeline vocabulary and transition rules live in career-status.ts so the
 * client can share them; this module is server-only because it imports db.
 */
export * from "@/lib/career-status";

export interface ApplyEventInput {
  applicationId: number;
  kind: "created" | "status_change" | "note" | "deadline";
  toStatus?: string | null;
  occurredOn?: string;
  detail?: string | null;
  source?: string;
  externalEventId?: number | null;
  confidence?: number | null;
}

/**
 * Append an event and refresh the application's cached status together.
 *
 * `applications.status` is a projection of this log, not an independent field.
 * Writing both here — and nowhere else — is what keeps them from drifting, so
 * the timeline can always account for the status shown on the card.
 */
export async function applyEvent(input: ApplyEventInput): Promise<{
  applied: boolean;
  reason: string;
}> {
  const source = input.source ?? "manual";
  const occurredOn = input.occurredOn ?? todayISO();

  const current = await db.execute({
    sql: "SELECT status, status_locked FROM applications WHERE id = ?",
    args: [input.applicationId],
  });
  if (current.rows.length === 0) {
    return { applied: false, reason: "Application not found" };
  }

  const currentStatus = current.rows[0].status as string;
  const statusLocked = Number(current.rows[0].status_locked) === 1;

  const wantsStatusChange =
    input.kind === "status_change" && !!input.toStatus && input.toStatus !== currentStatus;

  if (wantsStatusChange) {
    const decision = evaluateTransition(currentStatus, input.toStatus!, { statusLocked, source });
    if (!decision.accepted) return { applied: false, reason: decision.reason };
  }

  await db.execute({
    sql: `INSERT INTO application_events
            (application_id, kind, from_status, to_status, occurred_on, detail, source,
             external_event_id, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.applicationId,
      input.kind,
      wantsStatusChange ? currentStatus : null,
      input.toStatus ?? null,
      occurredOn,
      input.detail ?? null,
      source,
      input.externalEventId ?? null,
      input.confidence ?? null,
    ],
  });

  if (wantsStatusChange) {
    await db.execute({
      sql: `UPDATE applications
            SET status = ?,
                status_locked = CASE WHEN ? = 'manual' THEN 1 ELSE status_locked END,
                last_activity_date = ?,
                updated_at = datetime('now')
            WHERE id = ?`,
      args: [input.toStatus!, source, occurredOn, input.applicationId],
    });
  } else {
    await db.execute({
      sql: `UPDATE applications
            SET last_activity_date = ?, updated_at = datetime('now')
            WHERE id = ?`,
      args: [occurredOn, input.applicationId],
    });
  }

  return { applied: true, reason: "Recorded" };
}
