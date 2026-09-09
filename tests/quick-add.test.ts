import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd } from "@/lib/quick-add";

/**
 * The regression suite for typed input, the counterpart of
 * `tests/domains.test.ts` for mail. Both read the same text with the same
 * functions, so a rule that changes here must survive there too.
 *
 * A fixed "today" is passed in everywhere: the parser is pure, and a test that
 * moves with the calendar is not a test.
 */
const TODAY = "2026-03-10";

describe("parseQuickAdd — money", () => {
  test("reads an expense with an amount", () => {
    const result = parseQuickAdd("coffee $4.50", TODAY);
    assert.equal(result?.domain, "money");
    assert.equal(result?.money?.amount, 4.5);
    assert.equal(result?.money?.type, "expense");
    assert.equal(result?.money?.category, "Coffee");
    // No date in the line, so the day it was typed — a transaction always
    // happened on some day, unlike a deadline.
    assert.equal(result?.money?.date, TODAY);
  });

  test("reads a written date rather than defaulting to today", () => {
    const result = parseQuickAdd("groceries $62.10 on 3/8", TODAY);
    assert.equal(result?.money?.date, "2026-03-08");
    assert.equal(result?.money?.category, "Groceries");
  });

  test("recognises money coming in as income", () => {
    const result = parseQuickAdd("refund from the bookstore $23.10", TODAY);
    assert.equal(result?.money?.type, "income");
    assert.equal(result?.money?.amount, 23.1);
  });

  test("takes the total when several amounts are written", () => {
    const result = parseQuickAdd("lunch $12 and $3 tip, total $15", TODAY);
    assert.equal(result?.money?.amount, 15);
  });

  test("keeps the typed line as the note when it says more than the category", () => {
    const result = parseQuickAdd("dinner $40 with Sam", TODAY);
    assert.equal(result?.money?.note, "dinner $40 with Sam");
  });

  test("refuses a line with no number rather than inventing one", () => {
    // No amount, no transaction: a guessed number quietly corrupts the ledger.
    assert.equal(parseQuickAdd("coffee", TODAY), null);
    assert.equal(parseQuickAdd("bought lunch today", TODAY), null);
  });
});

describe("parseQuickAdd — school", () => {
  test("reads a course code and an explicit slash date", () => {
    const result = parseQuickAdd("CSE143 pset due 4/2", TODAY);
    assert.equal(result?.domain, "school");
    assert.equal(result?.school?.course, "CSE 143");
    assert.equal(result?.school?.title, "Pset");
    assert.equal(result?.school?.dueDate, "2026-04-02");
  });

  test("reads an ISO date", () => {
    const result = parseQuickAdd("MATH 126 midterm 2026-04-20", TODAY);
    assert.equal(result?.school?.course, "MATH 126");
    assert.equal(result?.school?.dueDate, "2026-04-20");
    assert.equal(result?.school?.title, "Midterm");
  });

  test("reads a named month written after other numbers", () => {
    // "Quiz 4" is a candidate month-and-day and is not one; the real date sits
    // later in the same line and must still be found.
    const result = parseQuickAdd("CSE143 quiz 4 due March 14", TODAY);
    assert.equal(result?.school?.dueDate, "2026-03-14");
  });

  test("takes coursework vocabulary without a course code", () => {
    const result = parseQuickAdd("essay due 2026-05-01", TODAY);
    assert.equal(result?.domain, "school");
    assert.equal(result?.school?.course, "Course");
    assert.equal(result?.school?.title, "Essay");
  });

  test("refuses to compute a relative date", () => {
    // A wrong deadline is worse than no deadline: you plan around it and never
    // question it. The task is still proposed — only the date is withheld.
    const friday = parseQuickAdd("CSE143 pset due Friday", TODAY);
    assert.equal(friday?.domain, "school");
    assert.equal(friday?.school?.dueDate, null);

    const fortnight = parseQuickAdd("MATH126 project due in two weeks", TODAY);
    assert.equal(fortnight?.school?.dueDate, null);
  });

  test("a priced line about a class is a purchase, not a deadline", () => {
    const result = parseQuickAdd("CSE143 textbook $80", TODAY);
    assert.equal(result?.domain, "money");
    assert.equal(result?.money?.amount, 80);
  });
});

describe("parseQuickAdd — refusal", () => {
  test("returns null for a line that matches nothing", () => {
    assert.equal(parseQuickAdd("call mom", TODAY), null);
    assert.equal(parseQuickAdd("thinking about the weekend", TODAY), null);
  });

  test("returns null for empty and whitespace input", () => {
    assert.equal(parseQuickAdd("", TODAY), null);
    assert.equal(parseQuickAdd("   \t ", TODAY), null);
  });

  test("a bare date is not enough to file anything", () => {
    assert.equal(parseQuickAdd("2026-04-02", TODAY), null);
  });
});
