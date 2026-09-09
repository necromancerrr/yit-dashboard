import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  monthRange,
  periodRanges,
  summarizePeriod,
  percentChange,
  PERIODS,
  type PeriodInput,
} from "@/lib/money-period";

const spend = (date: string, category: string, amount: number): PeriodInput => ({
  date,
  type: "expense",
  category,
  amount,
});
const earn = (date: string, amount: number): PeriodInput => ({
  date,
  type: "income",
  category: "Paycheck",
  amount,
});

describe("periodRanges", () => {
  test("this month runs first to last, and compares against the whole month before", () => {
    const { current, previous } = periodRanges("month", "2026-03-14");
    assert.deepEqual(current, { from: "2026-03-01", to: "2026-03-31" });
    assert.deepEqual(previous, { from: "2026-02-01", to: "2026-02-28" });
  });

  test("crosses a year boundary backwards", () => {
    const { current, previous } = periodRanges("month", "2026-01-09");
    assert.deepEqual(current, { from: "2026-01-01", to: "2026-01-31" });
    assert.deepEqual(previous, { from: "2025-12-01", to: "2025-12-31" });
  });

  test("knows February in a leap year", () => {
    const { current } = periodRanges("month", "2028-02-10");
    assert.deepEqual(current, { from: "2028-02-01", to: "2028-02-29" });
  });

  test("30 days includes today, and the two windows neither overlap nor gap", () => {
    const { current, previous } = periodRanges("30d", "2026-03-30");
    assert.deepEqual(current, { from: "2026-03-01", to: "2026-03-30" });
    assert.deepEqual(previous, { from: "2026-01-30", to: "2026-02-28" });
    // Same length, back to back.
    assert.equal(previous!.to < current!.from, true);
  });

  test("all time has no window and nothing to compare against", () => {
    assert.deepEqual(periodRanges("all", "2026-03-14"), { current: null, previous: null });
  });
});

describe("monthRange", () => {
  test("is inclusive at both ends of the calendar month", () => {
    assert.deepEqual(monthRange("2026-03-14"), { from: "2026-03-01", to: "2026-03-31" });
    assert.deepEqual(monthRange("2026-04-01"), { from: "2026-04-01", to: "2026-04-30" });
    assert.deepEqual(monthRange("2026-02-28"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(monthRange("2028-02-01"), { from: "2028-02-01", to: "2028-02-29" });
    assert.deepEqual(monthRange("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
  });

  test("agrees with the month period, so the API and the UI cannot disagree", () => {
    for (const day of ["2026-01-01", "2026-02-14", "2026-06-30", "2026-12-25"]) {
      assert.deepEqual(monthRange(day), periodRanges("month", day).current);
    }
  });
});

describe("summarizePeriod", () => {
  const ledger: PeriodInput[] = [
    earn("2026-03-01", 2000),
    spend("2026-03-02", "Rent", 900),
    spend("2026-03-05", "Groceries", 120),
    spend("2026-03-20", "Groceries", 80),
    // Last month — must not land in this month's totals.
    earn("2026-02-01", 1800),
    spend("2026-02-02", "Rent", 900),
    spend("2026-02-11", "Groceries", 200),
    // A year ago — inside "all", outside everything else.
    spend("2025-03-04", "Rent", 850),
  ];

  test("totals only the chosen month", () => {
    const s = summarizePeriod(ledger, "month", "2026-03-14");
    assert.equal(s.income, 2000);
    assert.equal(s.expense, 1100);
    assert.equal(s.net, 900);
    assert.equal(s.count, 4);
  });

  test("carries the same figures for the month before", () => {
    const s = summarizePeriod(ledger, "month", "2026-03-14");
    assert.equal(s.previous?.expense, 1100);
    assert.equal(s.previous?.income, 1800);
    assert.equal(s.previous?.net, 700);
  });

  test("ranks spending categories inside the period only", () => {
    const s = summarizePeriod(ledger, "month", "2026-03-14");
    assert.deepEqual(s.byCategory, [
      ["Rent", 900],
      ["Groceries", 200],
    ]);
  });

  test("income never appears as a spending category", () => {
    const s = summarizePeriod(ledger, "month", "2026-03-14");
    assert.equal(
      s.byCategory.some(([cat]) => cat === "Paycheck"),
      false
    );
  });

  test("all time takes everything and offers no comparison", () => {
    const s = summarizePeriod(ledger, "all", "2026-03-14");
    assert.equal(s.count, ledger.length);
    assert.equal(s.previous, null);
    assert.equal(s.range, null);
  });

  test("an empty period reports zero rather than going missing", () => {
    const s = summarizePeriod(ledger, "month", "2026-07-04");
    assert.deepEqual(
      { income: s.income, expense: s.expense, net: s.net, count: s.count },
      { income: 0, expense: 0, net: 0, count: 0 }
    );
    assert.deepEqual(s.byCategory, []);
  });

  test("sums cents without floating-point dust", () => {
    const s = summarizePeriod(
      [spend("2026-03-01", "Coffee", 4.1), spend("2026-03-02", "Coffee", 4.2)],
      "month",
      "2026-03-14"
    );
    assert.equal(s.expense, 8.3);
    assert.deepEqual(s.byCategory, [["Coffee", 8.3]]);
  });

  test("counts the boundary days as inside the period", () => {
    const s = summarizePeriod(
      [spend("2026-03-01", "Rent", 10), spend("2026-03-31", "Rent", 10)],
      "month",
      "2026-03-14"
    );
    assert.equal(s.count, 2);
  });
});

describe("percentChange", () => {
  test("reports a rise and a fall", () => {
    assert.equal(percentChange(1100, 1000), 10);
    assert.equal(percentChange(900, 1000), -10);
  });

  test("says nothing rather than inventing a number from zero", () => {
    // "+100%" or "+∞" against a first month is a made-up figure wearing the
    // clothes of a measurement.
    assert.equal(percentChange(500, 0), null);
    assert.equal(percentChange(0, 0), null);
  });

  test("zero when nothing moved", () => {
    assert.equal(percentChange(1000, 1000), 0);
  });
});

describe("PERIODS", () => {
  test("all time is the only period without a comparison label", () => {
    for (const p of PERIODS) {
      const hasPrevious = periodRanges(p.id, "2026-03-14").previous !== null;
      assert.equal(
        hasPrevious,
        p.previousLabel !== null,
        `${p.id}: a period with a previous window needs a label for it, and vice versa`
      );
    }
  });
});
