import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";

// Full data export — every table, as one JSON file. This exists so nothing
// you log here is ever locked in: you can always get a complete copy out.
export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const [gym, leetcode, interviews, school, finance, checklist] = await Promise.all([
        db.execute("SELECT * FROM gym_logs ORDER BY date"),
        db.execute("SELECT * FROM leetcode_logs ORDER BY date"),
        db.execute("SELECT * FROM interviews ORDER BY id"),
        db.execute("SELECT * FROM school_tasks ORDER BY id"),
        db.execute("SELECT * FROM finance_transactions ORDER BY date"),
        db.execute("SELECT * FROM checklist_items ORDER BY id"),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        gym_logs: gym.rows,
        leetcode_logs: leetcode.rows,
        interviews: interviews.rows,
        school_tasks: school.rows,
        finance_transactions: finance.rows,
        checklist_items: checklist.rows,
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
