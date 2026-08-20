import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb } from "@/lib/api-helpers";
import { daysAgoISO, shiftISODate, todayISO } from "@/lib/date";
import { rolloverRecurringChecklist } from "@/lib/checklist";
import { getPrices } from "@/lib/prices";
import type { HeatmapDay, SchoolTask } from "@/lib/types";

export async function GET() {
  return handleRoute(async () => {
    return withDb(async () => {
      const today = todayISO();
      // Un-check recurring habits that were completed on an earlier day, so
      // "today's checklist" reflects today and not whenever it was last done.
      await rolloverRecurringChecklist(today);

      const yearAgo = daysAgoISO(364);
      const weekAgo = daysAgoISO(6);
      const monthStart = today.slice(0, 7) + "-01";

      const [gymDates, leetcodeDates, checklistDates, leetcodeWeek, leetcodeTotal, upcomingInterviews, nextSchool, incomeRow, expenseRow, cryptoRows, checklistToday] =
        await Promise.all([
          db.execute({ sql: "SELECT DISTINCT date FROM gym_logs WHERE date >= ?", args: [yearAgo] }),
          db.execute({ sql: "SELECT DISTINCT date FROM leetcode_logs WHERE date >= ?", args: [yearAgo] }),
          db.execute({
            sql: "SELECT DISTINCT date FROM checklist_completions WHERE date >= ?",
            args: [yearAgo],
          }),
          db.execute({ sql: "SELECT COUNT(*) as c FROM leetcode_logs WHERE date >= ?", args: [weekAgo] }),
          db.execute("SELECT COUNT(*) as c FROM leetcode_logs"),
          db.execute({
            sql: "SELECT COUNT(*) as c FROM interviews WHERE status = 'Upcoming' AND (date IS NULL OR date >= ?)",
            args: [today],
          }),
          db.execute({
            sql: "SELECT * FROM school_tasks WHERE status != 'Done' AND due_date IS NOT NULL AND due_date >= ? ORDER BY due_date ASC LIMIT 1",
            args: [today],
          }),
          db.execute({
            sql: "SELECT COALESCE(SUM(amount),0) as s FROM finance_transactions WHERE type='income' AND date >= ?",
            args: [monthStart],
          }),
          db.execute({
            sql: "SELECT COALESCE(SUM(amount),0) as s FROM finance_transactions WHERE type='expense' AND date >= ?",
            args: [monthStart],
          }),
          db.execute("SELECT coin_id, quantity FROM crypto_holdings"),
          db.execute({
            sql: `SELECT COUNT(*) as total,
                         SUM(CASE WHEN done = 1 AND done_date = ? THEN 1 ELSE 0 END) as done
                  FROM checklist_items WHERE recurring = 1`,
            args: [today],
          }),
        ]);

      // Combine activity counts per day across gym / leetcode / checklist completions.
      const activityCounts = new Map<string, number>();
      for (const rows of [gymDates.rows, leetcodeDates.rows, checklistDates.rows]) {
        for (const row of rows) {
          const date = row.date as string | null;
          if (!date) continue;
          activityCounts.set(date, (activityCounts.get(date) ?? 0) + 1);
        }
      }
      const heatmap: HeatmapDay[] = Array.from(activityCounts.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Gym streak: consecutive days ending today (or yesterday, so a rest day
      // this morning doesn't zero it) with at least one gym log.
      const gymDateSet = new Set(gymDates.rows.map((r) => r.date as string));
      let streak = 0;
      // Walk backwards over calendar dates as strings, so the step is always
      // exactly one day regardless of daylight-saving shifts.
      let cursor = gymDateSet.has(today) ? today : shiftISODate(today, -1);
      while (gymDateSet.has(cursor)) {
        streak += 1;
        cursor = shiftISODate(cursor, -1);
      }

      // Crypto is part of the money picture, so it belongs on the overview —
      // valued live, never from a stored number. A price outage degrades to
      // zero rather than failing the whole summary.
      const holdings = cryptoRows.rows as unknown as { coin_id: string | null; quantity: number }[];
      let cryptoValue = 0;
      try {
        const prices = await getPrices(holdings.map((h) => h.coin_id ?? "").filter(Boolean));
        cryptoValue = holdings.reduce((sum, h) => {
          const price = h.coin_id ? prices.get(h.coin_id) : undefined;
          return sum + (price ? price.usd * h.quantity : 0);
        }, 0);
      } catch (err) {
        console.warn("Crypto valuation unavailable for summary:", err);
      }

      const monthIncome = Number(incomeRow.rows[0]?.s ?? 0);
      const monthExpense = Number(expenseRow.rows[0]?.s ?? 0);

      return NextResponse.json({
        gymStreak: streak,
        leetcodeThisWeek: Number(leetcodeWeek.rows[0]?.c ?? 0),
        leetcodeTotal: Number(leetcodeTotal.rows[0]?.c ?? 0),
        upcomingInterviews: Number(upcomingInterviews.rows[0]?.c ?? 0),
        nextSchoolDeadline: (nextSchool.rows[0] as unknown as SchoolTask) ?? null,
        monthIncome,
        monthExpense,
        monthNet: monthIncome - monthExpense,
        cryptoValue,
        cryptoCount: holdings.length,
        checklistDoneToday: Number(checklistToday.rows[0]?.done ?? 0),
        checklistTotalToday: Number(checklistToday.rows[0]?.total ?? 0),
        heatmap,
      });
    });
  });
}
