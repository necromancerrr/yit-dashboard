import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyDomain, extractAmount, extractDate } from "@/lib/ingest/domains";
import type { NormalizedMessage } from "@/lib/ingest/types";

function msg(over: Partial<NormalizedMessage> & { providerMessageId: string }): NormalizedMessage {
  return {
    threadId: `t-${over.providerMessageId}`,
    receivedOn: "2026-03-10",
    subject: "",
    senderName: null,
    senderEmail: null,
    snippet: "",
    ...over,
  };
}

describe("extractDate", () => {
  test("reads an explicit ISO date", () => {
    assert.equal(extractDate("Due 2026-04-02 at 11:59pm", "2026-03-10"), "2026-04-02");
  });

  test("reads a named month with an explicit year", () => {
    assert.equal(extractDate("Submit by March 14, 2027", "2026-03-10"), "2027-03-14");
  });

  test("borrows the received year when none is stated", () => {
    assert.equal(extractDate("Due April 2", "2026-03-10"), "2026-04-02");
  });

  test("rolls a long-past month forward rather than backdating a year", () => {
    // Arriving in December about "January 5" means the coming January.
    assert.equal(extractDate("Due January 5", "2026-12-20"), "2027-01-05");
  });

  test("reads slash dates", () => {
    assert.equal(extractDate("Payment due 4/2", "2026-03-10"), "2026-04-02");
  });

  test("refuses relative dates rather than computing one", () => {
    // A wrong deadline is worse than no deadline: you plan around it.
    assert.equal(extractDate("Due next Friday", "2026-03-10"), null);
    assert.equal(extractDate("Due in two weeks", "2026-03-10"), null);
  });

  test("refuses an impossible day", () => {
    assert.equal(extractDate("Ref 45/99 order", "2026-03-10"), null);
  });
});

describe("extractAmount", () => {
  test("takes the total, not the first line item", () => {
    assert.equal(extractAmount("Latte $4.50\nPastry $3.25\nTotal $7.75"), 7.75);
  });

  test("handles thousands separators", () => {
    assert.equal(extractAmount("Amount charged: $1,299.00"), 1299);
  });

  test("returns null when no amount is present", () => {
    assert.equal(extractAmount("Your order has shipped"), null);
  });
});

describe("classifyDomain — school", () => {
  test("reads a course platform notification", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "s1",
        subject: "CSE 143: Assignment 4 is due",
        senderEmail: "notifications@instructure.com",
        snippet: "Assignment 4 is due 2026-04-02 at 11:59pm.",
      })
    );
    assert.equal(signal?.domain, "school");
    assert.equal(signal?.school?.course, "CSE 143");
    assert.equal(signal?.school?.dueDate, "2026-04-02");
  });

  test("trusts a university sender less than a course platform", () => {
    const lms = classifyDomain(
      msg({
        providerMessageId: "s2",
        subject: "MATH126 quiz",
        senderEmail: "no-reply@gradescope.com",
        snippet: "Your quiz is due March 14, 2026.",
      })
    );
    const prof = classifyDomain(
      msg({
        providerMessageId: "s3",
        subject: "MATH126 quiz",
        senderEmail: "professor@uw.edu",
        snippet: "Your quiz is due March 14, 2026.",
      })
    );
    assert.ok((lms?.confidence ?? 0) > (prof?.confidence ?? 0));
  });

  test("ignores university mail that is not about coursework", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "s4",
        subject: "Campus parking survey",
        senderEmail: "news@uw.edu",
        snippet: "Tell us about your commute.",
      })
    );
    assert.equal(signal, null);
  });
});

describe("classifyDomain — money", () => {
  test("reads a receipt into a transaction", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "m1",
        subject: "Your receipt from Blue Bottle",
        senderName: "Blue Bottle",
        senderEmail: "receipts@bluebottle.com",
        snippet: "Total charged $7.75 on 3/9.",
      })
    );
    assert.equal(signal?.domain, "money");
    assert.equal(signal?.money?.amount, 7.75);
    assert.equal(signal?.money?.type, "expense");
    assert.equal(signal?.money?.date, "2026-03-09");
  });

  test("recognises a refund as income", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "m2",
        subject: "Refund issued",
        senderEmail: "billing@shop.com",
        snippet: "We refunded $23.10 to your card.",
      })
    );
    assert.equal(signal?.money?.type, "income");
  });

  test("refuses to propose a transaction with no amount", () => {
    // A transaction without a number is not a transaction, and inventing one
    // would quietly corrupt the ledger.
    const signal = classifyDomain(
      msg({
        providerMessageId: "m3",
        subject: "Your receipt is ready",
        senderEmail: "receipts@shop.com",
        snippet: "View your receipt online.",
      })
    );
    assert.equal(signal, null);
  });

  test("falls back to the received date when the text states none", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "m4",
        receivedOn: "2026-05-01",
        subject: "Payment confirmation",
        senderEmail: "payments@utility.com",
        snippet: "You were charged $60.00.",
      })
    );
    assert.equal(signal?.money?.date, "2026-05-01");
  });
});

describe("classifyDomain — deferral", () => {
  test("returns null for ordinary mail rather than guessing a domain", () => {
    const signal = classifyDomain(
      msg({
        providerMessageId: "n1",
        subject: "Lunch tomorrow?",
        senderEmail: "friend@gmail.com",
        snippet: "Are you free around noon?",
      })
    );
    assert.equal(signal, null);
  });
});
