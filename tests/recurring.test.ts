import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  detectRecurring,
  totalAnnualCost,
  isDueSoon,
  type RecurringInput,
} from "@/lib/recurring";

/**
 * The whole point of this detector is what it *refuses* to call a
 * subscription. A miss costs nothing; a false positive teaches the owner to
 * ignore the list, which is the same as deleting it. So most of these tests
 * are rejections.
 */

const expense = (date: string, category: string, amount: number): RecurringInput => ({
  date,
  type: "expense",
  category,
  amount,
});

describe("detectRecurring", () => {
  test("finds a clean monthly subscription", () => {
    const found = detectRecurring(
      [
        expense("2026-06-14", "Spotify", 11.99),
        expense("2026-07-14", "Spotify", 11.99),
        expense("2026-08-14", "Spotify", 11.99),
      ],
      "2026-09-01"
    );

    assert.equal(found.length, 1);
    const charge = found[0];
    assert.equal(charge.category, "Spotify");
    assert.equal(charge.occurrences, 3);
    assert.equal(charge.cadence, "monthly");
    assert.equal(charge.typicalAmount, 11.99);
    assert.equal(charge.lastCharged, "2026-08-14");
    assert.equal(charge.nextExpected, "2026-09-14"); // 30 and 31-day gaps, median 30.5
    assert.equal(charge.annualCost, 141.17);
  });

  test("tolerates the drift a real card statement has", () => {
    // 31 then 28 days, and a price rise — all still one subscription.
    const found = detectRecurring(
      [
        expense("2026-01-03", "iCloud", 2.99),
        expense("2026-02-03", "iCloud", 2.99),
        expense("2026-03-03", "iCloud", 3.49),
      ],
      "2026-03-10"
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].cadence, "monthly");
  });

  test("rejects two occurrences — two points fit any line", () => {
    const found = detectRecurring(
      [expense("2026-07-14", "Spotify", 11.99), expense("2026-08-14", "Spotify", 11.99)],
      "2026-09-01"
    );
    assert.deepEqual(found, []);
  });

  test("rejects irregular groceries", () => {
    const found = detectRecurring(
      [
        expense("2026-08-01", "Groceries", 62),
        expense("2026-08-04", "Groceries", 41),
        expense("2026-08-13", "Groceries", 88),
        expense("2026-08-18", "Groceries", 55),
        expense("2026-08-30", "Groceries", 73),
      ],
      "2026-09-01"
    );
    assert.deepEqual(found, []);
  });

  test("rejects a steady cadence with wildly different amounts", () => {
    // Rent-like timing, restaurant-like amounts: not a fixed commitment.
    const found = detectRecurring(
      [
        expense("2026-06-01", "Dining", 20),
        expense("2026-07-01", "Dining", 140),
        expense("2026-08-01", "Dining", 65),
      ],
      "2026-09-01"
    );
    assert.deepEqual(found, []);
  });

  test("rejects near-daily spending even when the amount never changes", () => {
    const found = detectRecurring(
      [
        expense("2026-08-01", "Coffee", 4.5),
        expense("2026-08-02", "Coffee", 4.5),
        expense("2026-08-03", "Coffee", 4.5),
        expense("2026-08-04", "Coffee", 4.5),
      ],
      "2026-08-10"
    );
    assert.deepEqual(found, []);
  });

  test("never reports income — a salary is the most regular row there is", () => {
    const found = detectRecurring(
      [
        { date: "2026-06-15", type: "income", category: "Paycheck", amount: 2200 },
        { date: "2026-07-15", type: "income", category: "Paycheck", amount: 2200 },
        { date: "2026-08-15", type: "income", category: "Paycheck", amount: 2200 },
      ],
      "2026-09-01"
    );
    assert.deepEqual(found, []);
  });

  test("groups case- and whitespace-variant categories, displaying the latest spelling", () => {
    const found = detectRecurring(
      [
        expense("2026-06-02", "netflix", 15.49),
        expense("2026-07-02", "  Netflix ", 15.49),
        expense("2026-08-02", "Netflix", 15.49),
      ],
      "2026-09-01"
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].category, "Netflix");
  });

  test("labels weekly and yearly cadences, and leaves odd ones unlabelled", () => {
    const weekly = detectRecurring(
      [
        expense("2026-08-03", "Laundry", 6),
        expense("2026-08-10", "Laundry", 6),
        expense("2026-08-17", "Laundry", 6),
      ],
      "2026-08-20"
    );
    assert.equal(weekly[0].cadence, "weekly");
    assert.equal(weekly[0].annualCost, 312.86);

    const yearly = detectRecurring(
      [
        expense("2024-02-01", "Domain", 14),
        expense("2025-02-01", "Domain", 14),
        expense("2026-02-01", "Domain", 14),
      ],
      "2026-09-01"
    );
    assert.equal(yearly[0].cadence, "yearly");

    const fortnightly = detectRecurring(
      [
        expense("2026-07-01", "Cleaner", 60),
        expense("2026-07-15", "Cleaner", 60),
        expense("2026-07-29", "Cleaner", 60),
      ],
      "2026-08-01"
    );
    assert.equal(fortnightly[0].cadenceDays, 14);
    assert.equal(fortnightly[0].cadence, null);
  });

  test("sorts by annual cost, not by amount per charge", () => {
    const found = detectRecurring(
      [
        // $120 once a year.
        expense("2024-01-10", "Insurance", 120),
        expense("2025-01-10", "Insurance", 120),
        expense("2026-01-10", "Insurance", 120),
        // $20 a month is $240 a year — the bigger commitment.
        expense("2026-06-05", "Gym", 20),
        expense("2026-07-05", "Gym", 20),
        expense("2026-08-05", "Gym", 20),
      ],
      "2026-09-01"
    );
    assert.deepEqual(
      found.map((c) => c.category),
      ["Gym", "Insurance"]
    );
  });
});

describe("totalAnnualCost", () => {
  test("sums to cents, not floating-point noise", () => {
    const charges = detectRecurring(
      [
        expense("2026-06-14", "Spotify", 11.99),
        expense("2026-07-14", "Spotify", 11.99),
        expense("2026-08-14", "Spotify", 11.99),
        expense("2026-06-02", "Netflix", 15.49),
        expense("2026-07-02", "Netflix", 15.49),
        expense("2026-08-02", "Netflix", 15.49),
      ],
      "2026-09-01"
    );
    assert.equal(charges.length, 2);
    assert.equal(totalAnnualCost(charges), 323.55);
  });

  test("is zero with nothing found", () => {
    assert.equal(totalAnnualCost([]), 0);
  });
});

describe("isDueSoon", () => {
  const [charge] = detectRecurring(
    [
      expense("2026-06-14", "Spotify", 11.99),
      expense("2026-07-14", "Spotify", 11.99),
      expense("2026-08-14", "Spotify", 11.99),
    ],
    "2026-09-01"
  );

  test("true inside the window", () => {
    assert.equal(charge.nextExpected, "2026-09-14");
    assert.equal(isDueSoon(charge, "2026-09-10"), true);
    assert.equal(isDueSoon(charge, "2026-09-14"), true);
  });

  test("false when it is still far off", () => {
    assert.equal(isDueSoon(charge, "2026-09-01"), false);
  });

  test("false once the date has passed — overdue is not upcoming", () => {
    // A missed charge means the guess was wrong or it was cancelled. Either
    // way, "coming up" is the wrong thing to say about it.
    assert.equal(isDueSoon(charge, "2026-09-15"), false);
  });
});

describe("stale charges", () => {
  test("drops a subscription that stopped two cycles ago", () => {
    const found = detectRecurring(
      [
        expense("2026-01-14", "Spotify", 11.99),
        expense("2026-02-14", "Spotify", 11.99),
        expense("2026-03-14", "Spotify", 11.99),
      ],
      "2026-09-01"
    );
    assert.deepEqual(found, []);
  });

  test("keeps one that is merely late", () => {
    const found = detectRecurring(
      [
        expense("2026-06-14", "Spotify", 11.99),
        expense("2026-07-14", "Spotify", 11.99),
        expense("2026-08-14", "Spotify", 11.99),
      ],
      // Five days past the expected date — a statement lag, not a cancellation.
      "2026-09-19"
    );
    assert.equal(found.length, 1);
  });
});
