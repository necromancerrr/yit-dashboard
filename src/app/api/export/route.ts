import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

// Full data export — every table, as one JSON file. This exists so nothing
// you log here is ever locked in: you can always get a complete copy out.
// Three tables are deliberately absent, and adding them would be a mistake:
//
// - `passkeys` holds credential material. An export is a file that ends up in
//   cloud storage and email attachments; login credentials do not belong in
//   one, and the device list route omits them for the same reason.
// - `schema_migrations` is bookkeeping about this database, not data about the
//   owner. Restoring it into a fresh database would suppress backfills that
//   still need to run.
// - `shared_images` is a transient handoff, deleted as it is read. Anything
//   still in it is in flight, not history.
//
// Every other table belongs here. If you add one, add it here too.
export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const [
        gym,
        leetcode,
        interviews,
        school,
        finance,
        checklist,
        completions,
        crypto,
        applications,
        applicationEvents,
        externalEvents,
        inbox,
        integrations,
        automation,
      ] = await Promise.all([
        db.execute("SELECT * FROM gym_logs ORDER BY date"),
        db.execute("SELECT * FROM leetcode_logs ORDER BY date"),
        db.execute("SELECT * FROM interviews ORDER BY id"),
        db.execute("SELECT * FROM school_tasks ORDER BY id"),
        db.execute("SELECT * FROM finance_transactions ORDER BY date"),
        db.execute("SELECT * FROM checklist_items ORDER BY id"),
        db.execute("SELECT * FROM checklist_completions ORDER BY date"),
        db.execute("SELECT * FROM crypto_holdings ORDER BY id"),
        db.execute("SELECT * FROM applications ORDER BY id"),
        db.execute("SELECT * FROM application_events ORDER BY application_id, occurred_on"),
        db.execute("SELECT * FROM external_events ORDER BY id"),
        db.execute("SELECT * FROM inbox_items ORDER BY id"),
        // Deliberately not `SELECT *`: integrations holds no secrets today, and
        // listing columns explicitly keeps it that way if one is ever added.
        db.execute(
          "SELECT id, provider, status, account_label, last_synced_at, created_at FROM integrations ORDER BY id"
        ),
        // The audit trail for everything the sync did on its own. An autonomy
        // feature whose record is missing from the backup is not auditable.
        db.execute("SELECT * FROM automation_actions ORDER BY id"),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        gym_logs: gym.rows,
        leetcode_logs: leetcode.rows,
        interviews: interviews.rows,
        school_tasks: school.rows,
        finance_transactions: finance.rows,
        checklist_items: checklist.rows,
        checklist_completions: completions.rows,
        crypto_holdings: crypto.rows,
        applications: applications.rows,
        application_events: applicationEvents.rows,
        external_events: externalEvents.rows,
        inbox_items: inbox.rows,
        integrations: integrations.rows,
        automation_actions: automation.rows,
      };

      return new NextResponse(JSON.stringify(payload, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="dashboard-export-${todayISO()}.json"`,
        },
      });
    });
  });
}
