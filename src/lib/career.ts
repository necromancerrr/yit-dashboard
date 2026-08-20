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
 *
 * The two writes go out as one batch in write mode, so they commit or roll
 * back together. Issued separately, a failure between them would leave a
 * status with no event explaining it, or an event the status never reflected —
 * exactly the drift the event log exists to make impossible.
 */
export async function applyEvent(input: ApplyEventInput): Promise<{
  applied: boolean;
  reason: string;
}> {
  const source = input.source ?? "manual";
  const occurredOn = input.occurredOn ?? todayISO();

  const current = await db.execute({
    sql: `SELECT a.status,
                 (SELECT MAX(e.occurred_on)
                    FROM application_events e
                   WHERE e.application_id = a.id
                     AND e.kind = 'status_change'
                     AND e.source = 'manual') AS last_manual_status_on
            FROM applications a
           WHERE a.id = ?`,
    args: [input.applicationId],
  });
  if (current.rows.length === 0) {
    return { applied: false, reason: "Application not found" };
  }

  const currentStatus = current.rows[0].status as string;
  // Read from the log rather than a flag on the row: the log already records
  // when you last decided a status by hand, and it cannot fall out of sync
  // with itself. Note this counts only 'status_change' — a 'created' event is
  // you filing an application, not correcting one.
  const lastManualStatusOn = current.rows[0].last_manual_status_on as string | null;

  const wantsStatusChange =
    input.kind === "status_change" && !!input.toStatus && input.toStatus !== currentStatus;

  if (wantsStatusChange) {
    const decision = evaluateTransition(currentStatus, input.toStatus!, {
      source,
      lastManualStatusOn,
      occurredOn,
    });
    if (!decision.accepted) return { applied: false, reason: decision.reason };
  }

  const insertEvent = {
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
  };

  // status_locked is no longer a gate — precedence comes from the log above —
  // but it is still worth recording that you have set this status by hand, and
  // it is part of the export.
  const updateApplication = wantsStatusChange
    ? {
        sql: `UPDATE applications
              SET status = ?,
                  status_locked = CASE WHEN ? = 'manual' THEN 1 ELSE status_locked END,
                  last_activity_date = ?,
                  updated_at = datetime('now')
              WHERE id = ?`,
        args: [input.toStatus!, source, occurredOn, input.applicationId],
      }
    : {
        sql: `UPDATE applications
              SET last_activity_date = ?, updated_at = datetime('now')
              WHERE id = ?`,
        args: [occurredOn, input.applicationId],
      };

  await db.batch([insertEvent, updateApplication], "write");

  return { applied: true, reason: "Recorded" };
}
