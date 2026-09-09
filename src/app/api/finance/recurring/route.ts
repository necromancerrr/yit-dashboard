import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handleRoute, withDb, todayISO } from "@/lib/api-helpers";
import { detectRecurring, totalAnnualCost, type RecurringInput } from "@/lib/recurring";

/**
 * The charges you signed up for once and never revisited.
 *
 * A static segment takes precedence over `[id]`, so this does not collide with
 * `/api/finance/<id>` — that route only serves PATCH and DELETE anyway.
 *
 * Detection is pure (`src/lib/recurring.ts`); this route's only jobs are
 * choosing the window and handing the model today's date. A year of history is
 * enough to see an annual bill repeat three times only if it is three years —
 * so the window is generous and the work is cheap: this is a scan over a few
 * hundred rows, not a query worth optimising.
 */

/** Two years of history: enough for a yearly bill to show a rhythm. */
const LOOKBACK_DAYS = 730;

export async function GET(req: NextRequest) {
  return handleRoute(async () => {
    const days = Number(req.nextUrl.searchParams.get("days") ?? LOOKBACK_DAYS);
    const today = todayISO();

    return withDb(async () => {
      const result = await db.execute({
        sql: `SELECT date, type, category, amount FROM finance_transactions
               WHERE date >= date(?, ?) ORDER BY date ASC`,
        args: [today, `-${Number.isFinite(days) ? Math.max(1, days) : LOOKBACK_DAYS} days`],
      });

      const transactions: RecurringInput[] = result.rows.map((row) => ({
        date: String(row.date),
        type: row.type === "income" ? "income" : "expense",
        category: String(row.category),
        amount: Number(row.amount),
      }));

      const items = detectRecurring(transactions, today);
      return NextResponse.json({
        items,
        totalAnnualCost: totalAnnualCost(items),
        today,
      });
    });
  });
}
