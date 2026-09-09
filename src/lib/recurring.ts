import { shiftISODate } from "@/lib/date";

/**
 * Find the charges that repeat, from transactions already recorded.
 *
 * Subscriptions are the spending you never decide to do again. They arrive
 * monthly, each one too small to notice, and the only moment you would catch
 * them is a moment that never comes. Everything needed to spot them is already
 * in the ledger — nobody has ever looked across rows.
 *
 * Pure: it takes transactions and returns findings, touching no database and
 * no clock. That is what makes it testable against fixed data, and it is why
 * `today` is a parameter.
 *
 * Deliberately conservative. A false "you are subscribed to this" is worse
 * than a miss: it teaches you to distrust the list, and an untrusted list is
 * the same as no list. Three occurrences minimum, consistent gaps, consistent
 * amounts — anything looser starts calling your weekly groceries a
 * subscription.
 */

export interface RecurringInput {
  date: string;
  type: "income" | "expense";
  category: string;
  amount: number;
}

export interface RecurringCharge {
  category: string;
  /** The typical charge — the median, so one annual bill doesn't skew it. */
  typicalAmount: number;
  occurrences: number;
  /** Rounded to the nearest day. ~30 monthly, ~7 weekly, ~365 yearly. */
  cadenceDays: number;
  /** Human label for the cadence, or null when it is irregular but consistent. */
  cadence: "weekly" | "monthly" | "yearly" | null;
  lastCharged: string;
  /** When another one is expected, extrapolated from the median gap. */
  nextExpected: string;
  /** What this costs over a year at the observed cadence. */
  annualCost: number;
}

/** At least three: two points make a line through anything. */
const MIN_OCCURRENCES = 3;
/** Gaps may vary by this fraction and still count as the same rhythm. */
const MAX_GAP_VARIANCE = 0.25;
/** Amounts may vary by this fraction — prices change, usage-based bills drift. */
const MAX_AMOUNT_VARIANCE = 0.2;
/**
 * How many cadences of silence before a charge is treated as stopped.
 *
 * A cancelled subscription leaves its history behind forever, and a list that
 * keeps billing you for Netflix two years after you quit is worse than useless
 * — you stop reading it. Two missed cycles is late enough to be a decision
 * rather than a delayed statement.
 */
const STALE_CADENCES = 2;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function cadenceLabel(days: number): RecurringCharge["cadence"] {
  if (days >= 6 && days <= 8) return "weekly";
  // Calendar months are 28-31 days, and a card that bills "monthly" drifts.
  if (days >= 26 && days <= 35) return "monthly";
  if (days >= 350 && days <= 380) return "yearly";
  return null;
}

/**
 * Is this rhythm regular enough to call recurring?
 *
 * Groceries bought most weeks have gaps of 3, 9, 5, 12 — a real subscription
 * has 30, 31, 30. Comparing each gap against the median catches that without
 * needing a fixed calendar model.
 */
function isRegular(gaps: number[]): boolean {
  const typical = median(gaps);
  if (typical < 5) return false; // more often than weekly is a habit, not a bill
  return gaps.every((gap) => Math.abs(gap - typical) <= typical * MAX_GAP_VARIANCE);
}

function isConsistentAmount(amounts: number[]): boolean {
  const typical = median(amounts);
  if (typical <= 0) return false;
  return amounts.every((a) => Math.abs(a - typical) <= typical * MAX_AMOUNT_VARIANCE);
}

export function detectRecurring(
  transactions: RecurringInput[],
  today: string
): RecurringCharge[] {
  // Income is not a subscription. A salary would otherwise be the most
  // confident "recurring charge" in the list.
  const expenses = transactions.filter((t) => t.type === "expense");

  const byCategory = new Map<string, RecurringInput[]>();
  for (const t of expenses) {
    const key = t.category.trim().toLowerCase();
    const bucket = byCategory.get(key);
    if (bucket) bucket.push(t);
    else byCategory.set(key, [t]);
  }

  const found: RecurringCharge[] = [];

  for (const rows of byCategory.values()) {
    if (rows.length < MIN_OCCURRENCES) continue;

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    }

    const amounts = sorted.map((r) => r.amount);
    if (!isRegular(gaps) || !isConsistentAmount(amounts)) continue;

    const cadenceDays = Math.round(median(gaps));
    const typicalAmount = median(amounts);
    const lastCharged = sorted[sorted.length - 1].date;

    // Silent for two cycles: cancelled, not recurring.
    if (daysBetween(lastCharged, today) > cadenceDays * STALE_CADENCES) continue;

    found.push({
      // Display the category as most recently written, not lowercased.
      category: sorted[sorted.length - 1].category,
      typicalAmount,
      occurrences: sorted.length,
      cadenceDays,
      cadence: cadenceLabel(cadenceDays),
      lastCharged,
      nextExpected: shiftISODate(lastCharged, cadenceDays),
      // Rounded to cents so the UI never renders a 12-decimal total.
      annualCost: Math.round((typicalAmount * (365 / cadenceDays)) * 100) / 100,
    });
  }

  // Most expensive per year first — that is the one worth cancelling.
  return found.sort((a, b) => b.annualCost - a.annualCost);
}

/** Total yearly commitment, for a single headline number. */
export function totalAnnualCost(charges: RecurringCharge[]): number {
  return Math.round(charges.reduce((sum, c) => sum + c.annualCost, 0) * 100) / 100;
}

/** True when the next charge is due within the window — "coming up". */
export function isDueSoon(charge: RecurringCharge, today: string, withinDays = 7): boolean {
  const days = daysBetween(today, charge.nextExpected);
  return days >= 0 && days <= withinDays;
}
