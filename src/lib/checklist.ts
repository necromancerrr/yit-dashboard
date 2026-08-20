import { db } from "@/lib/db";
import { todayISO } from "@/lib/date";

/**
 * Recurring items are daily habits, so a tick from yesterday shouldn't still
 * be showing today. This clears `done` on any recurring item last completed on
 * an earlier day — a lazy rollover, run on read, so there's no cron to keep
 * alive. The completion itself is preserved in `checklist_completions`.
 */
export async function rolloverRecurringChecklist(today: string = todayISO()): Promise<void> {
  await db.execute({
    sql: `UPDATE checklist_items
             SET done = 0, done_date = NULL
           WHERE recurring = 1
             AND done = 1
             AND (done_date IS NULL OR done_date != ?)`,
    args: [today],
  });
}
