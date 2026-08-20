import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { shiftISODate, todayISO } from "@/lib/date";
import { rolloverRecurringChecklist } from "@/lib/checklist";
import { refreshDerivedInbox, daysBetween, relativeDay } from "@/lib/inbox";
import { getPrices } from "@/lib/prices";
import { getAIProvider } from "@/lib/ai";
import type { TodayItem } from "@/lib/types";

/**
 * "What matters to Yit today?"
 *
 * The ranking is deliberately deterministic and computed from the database —
 * not asked of a model. Sorting by how soon something is due is something SQL
 * and arithmetic do exactly right, for free, offline, and identically every
 * time. A model adds nothing here except latency and the chance of inventing a
 * deadline that does not exist.
 *
 * The AI's only job is the closing sentence, and only over facts this route
 * already computed. See summarizeToday() in src/lib/ai.
 */

/** Only this far ahead competes for today's attention. */
const HORIZON_DAYS = 7;

/** Urgency is "days until due", nudged so same-day items outrank equal ties. */
function urgencyFor(days: number, weight: number): number {
  return days * 10 + weight;
}

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    return withDb(async () => {
      const today = todayISO();
      const horizon = shiftISODate(today, HORIZON_DAYS);

      await rolloverRecurringChecklist(today);
      await refreshDerivedInbox(today);

      const [school, career, checklist, inboxCount, gymDates, income, expense, holdings] =
        await Promise.all([
          db.execute({
            sql: `SELECT id, course, title, due_date FROM school_tasks
                  WHERE status != 'Done' AND due_date IS NOT NULL AND due_date <= ?
                  ORDER BY due_date ASC LIMIT 10`,
            args: [horizon],
          }),
          db.execute({
            sql: `SELECT id, company, role, status, next_action_date, next_action_label
                  FROM applications
                  WHERE next_action_date IS NOT NULL AND next_action_date <= ?
                    AND status NOT IN ('Rejected', 'Withdrawn')
                  ORDER BY next_action_date ASC LIMIT 10`,
            args: [horizon],
          }),
          db.execute({
            sql: `SELECT COUNT(*) AS total,
                         SUM(CASE WHEN done = 1 AND done_date = ? THEN 1 ELSE 0 END) AS done
                  FROM checklist_items WHERE recurring = 1`,
            args: [today],
          }),
          db.execute("SELECT COUNT(*) AS c FROM inbox_items WHERE state = 'open'"),
          db.execute({
            sql: "SELECT DISTINCT date FROM gym_logs WHERE date >= ?",
            args: [shiftISODate(today, -365)],
          }),
          db.execute({
            sql: `SELECT COALESCE(SUM(amount),0) AS s FROM finance_transactions
                  WHERE type='income' AND date >= ?`,
            args: [today.slice(0, 7) + "-01"],
          }),
          db.execute({
            sql: `SELECT COALESCE(SUM(amount),0) AS s FROM finance_transactions
                  WHERE type='expense' AND date >= ?`,
            args: [today.slice(0, 7) + "-01"],
          }),
          db.execute("SELECT coin_id, quantity FROM crypto_holdings"),
        ]);

      const items: TodayItem[] = [];

      for (const row of school.rows) {
        const due = row.due_date as string;
        const days = daysBetween(today, due);
        items.push({
          id: `school-${row.id}`,
          kind: "school",
          title: `${row.title as string} due ${relativeDay(days)}`,
          detail: row.course as string,
          urgency: urgencyFor(days, 0),
          dueDate: due,
          href: "/school",
        });
      }

      for (const row of career.rows) {
        const due = row.next_action_date as string;
        const days = daysBetween(today, due);
        const label = (row.next_action_label as string | null) ?? (row.status as string);
        items.push({
          id: `career-${row.id}`,
          kind: "career",
          title: `${row.company as string} ${label} ${relativeDay(days)}`,
          detail: (row.role as string | null) ?? null,
          urgency: urgencyFor(days, 1),
          dueDate: due,
          href: `/career/${row.id}`,
        });
      }

      const checklistDone = Number(checklist.rows[0]?.done ?? 0);
      const checklistTotal = Number(checklist.rows[0]?.total ?? 0);
      if (checklistTotal > checklistDone) {
        items.push({
          id: "checklist",
          kind: "checklist",
          title: `${checklistTotal - checklistDone} habit${checklistTotal - checklistDone === 1 ? "" : "s"} left today`,
          detail: `${checklistDone} of ${checklistTotal} done`,
          // Habits are today's work but never outrank a dated deadline.
          urgency: urgencyFor(0, 5),
          dueDate: today,
          href: "/checklist",
        });
      }

      items.sort((a, b) => a.urgency - b.urgency);

      // Gym streak: consecutive days back from today, tolerating a missing
      // entry for today so a rest morning doesn't read as a broken streak.
      const gymSet = new Set(gymDates.rows.map((r) => r.date as string));
      let streak = 0;
      let cursor = gymSet.has(today) ? today : shiftISODate(today, -1);
      while (gymSet.has(cursor)) {
        streak += 1;
        cursor = shiftISODate(cursor, -1);
      }

      let cryptoValue = 0;
      try {
        const rows = holdings.rows as unknown as { coin_id: string | null; quantity: number }[];
        const prices = await getPrices(rows.map((h) => h.coin_id ?? "").filter(Boolean));
        cryptoValue = rows.reduce((sum, h) => {
          const price = h.coin_id ? prices.get(h.coin_id) : undefined;
          return sum + (price ? price.usd * h.quantity : 0);
        }, 0);
      } catch (err) {
        console.warn("Crypto valuation unavailable for today:", err);
      }

      const monthNet = Number(income.rows[0]?.s ?? 0) - Number(expense.rows[0]?.s ?? 0);

      // The briefing is additive. When no provider is configured this is null
      // and the page renders its ranked list exactly as it otherwise would.
      let briefing: string | null = null;
      if (req.nextUrl.searchParams.get("briefing") === "1") {
        const provider = getAIProvider();
        if (provider) {
          briefing = await provider.summarizeToday(
            items.slice(0, 6).map((i) => ({ title: i.title, detail: i.detail }))
          );
        }
      }

      return NextResponse.json({
        date: today,
        items: items.slice(0, 8),
        inboxOpenCount: Number(inboxCount.rows[0]?.c ?? 0),
        gymStreak: streak,
        checklistDoneToday: checklistDone,
        checklistTotalToday: checklistTotal,
        monthNet,
        netWorthSnapshot: cryptoValue,
        briefing,
      });
    });
  });
}
