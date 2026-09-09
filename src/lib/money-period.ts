/**
 * What "Income $4,210" is actually the income *of*.
 *
 * The Money cards used to total every transaction the list had loaded — up to
 * three hundred rows, going back however far that reached — while the empty
 * state promised a "monthly picture". A number with no period attached is not
 * a wrong number, it is a number you cannot act on: you cannot tell whether
 * spending is up without knowing up *since when*.
 *
 * So the period is explicit, it is chosen, and every figure is paired with the
 * same figure for the period before it. "You spent $890" is trivia; "$890,
 * up 31% on last month" is the thing that changes what you do next.
 *
 * Pure — no database, no clock. `today` is a parameter so the month boundaries
 * can be pinned in tests, which matters more here than anywhere: a
 * comparison against the wrong previous month is invisible and wrong.
 */

export interface PeriodInput {
  date: string;
  type: "income" | "expense";
  category: string;
  amount: number;
}

export type PeriodId = "month" | "30d" | "all";

export interface PeriodOption {
  id: PeriodId;
  label: string;
  /** What the comparison line calls the period before this one. */
  previousLabel: string | null;
}

export const PERIODS: PeriodOption[] = [
  { id: "month", label: "This month", previousLabel: "last month" },
  { id: "30d", label: "Last 30 days", previousLabel: "the 30 days before" },
  { id: "all", label: "All time", previousLabel: null },
];

export interface PeriodTotals {
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface PeriodSummary extends PeriodTotals {
  /** The same window, one period earlier. Null when the period is "all time". */
  previous: PeriodTotals | null;
  /** Top spending categories in the period, largest first. */
  byCategory: Array<[string, number]>;
  /** Inclusive ISO bounds of the window, or null for all time. */
  range: { from: string; to: string } | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** First day of the month `iso` falls in. */
function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** First day of the month `months` before the one `iso` falls in. */
function shiftMonth(iso: string, months: number): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12);
  // Modulo of a negative month has to land back in 0-11, hence the second %.
  const m = ((month % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** Last day of the month `iso` falls in — day 0 of the next month. */
function endOfMonth(iso: string): string {
  const next = shiftMonth(iso, 1);
  const d = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 0));
  return d.toISOString().slice(0, 10);
}

/** `iso` moved by whole calendar days, in UTC space so DST cannot shorten one. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  );
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The window for a period, and the window immediately before it.
 *
 * Calendar months are compared month-to-month rather than as fixed 30-day
 * blocks: February against January is the comparison a person means, even
 * though one is three days shorter.
 */
/**
 * The calendar month `today` falls in, inclusive at both ends.
 *
 * Exported separately from `periodRanges` because the API routes want a range
 * that definitely exists — "all time" has none — and a non-null assertion at
 * every call site is a worse answer than a function with a narrower type.
 */
export function monthRange(today: string): { from: string; to: string } {
  return { from: startOfMonth(today), to: endOfMonth(today) };
}

export function periodRanges(period: PeriodId, today: string): {
  current: { from: string; to: string } | null;
  previous: { from: string; to: string } | null;
} {
  if (period === "all") return { current: null, previous: null };

  if (period === "month") {
    const prevFrom = shiftMonth(today, -1);
    return {
      current: monthRange(today),
      previous: { from: prevFrom, to: endOfMonth(prevFrom) },
    };
  }

  // 30 days *including* today, so the two windows are the same length and do
  // not overlap on the boundary day.
  const from = shiftDays(today, -29);
  return {
    current: { from, to: today },
    previous: { from: shiftDays(from, -30), to: shiftDays(from, -1) },
  };
}

function totalsFor(transactions: PeriodInput[]): PeriodTotals {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.type === "income") income += t.amount;
    else expense += t.amount;
  }
  return {
    income: round(income),
    expense: round(expense),
    net: round(income - expense),
    count: transactions.length,
  };
}

const within = (t: PeriodInput, range: { from: string; to: string } | null) =>
  !range || (t.date >= range.from && t.date <= range.to);

export function summarizePeriod(
  transactions: PeriodInput[],
  period: PeriodId,
  today: string,
  topCategories = 6
): PeriodSummary {
  const { current, previous } = periodRanges(period, today);

  const inPeriod = transactions.filter((t) => within(t, current));
  const totals = totalsFor(inPeriod);

  const byCategory = new Map<string, number>();
  for (const t of inPeriod) {
    if (t.type !== "expense") continue;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  }

  return {
    ...totals,
    previous: previous
      ? totalsFor(transactions.filter((t) => within(t, previous)))
      : null,
    byCategory: Array.from(byCategory.entries())
      .map(([cat, amt]): [string, number] => [cat, round(amt)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, topCategories),
    range: current,
  };
}

/**
 * Percentage change, or null when there is nothing honest to say.
 *
 * Growth from zero is not "+100%" or "+∞" — it is a first month, and stating a
 * percentage there is a made-up number dressed as a measurement. The UI shows
 * nothing instead.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
