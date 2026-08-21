import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildTodayBriefingFacts } from "@/lib/today-briefing";

describe("Today briefing facts", () => {
  test("an open Gmail inbox is visible even when nothing is due", () => {
    const facts = buildTodayBriefingFacts({
      date: "2026-08-20",
      priorities: [],
      inboxOpenCount: 30,
      inboxItems: [
        {
          title: "Create SAP as Rejected?",
          detail: "Application update from SAP SuccessFactors",
          severity: "attention",
        },
      ],
      careerStatuses: [{ status: "Applied", count: 9 }],
      schoolOpenCount: 2,
      checklistDone: 0,
      checklistTotal: 0,
      gymStreak: 0,
      monthNet: 0,
      cryptoValue: 0,
    });

    assert.ok(facts.some((fact) => fact.title === "Inbox: 30 open items"));
    assert.ok(facts.some((fact) => fact.title.includes("Create SAP as Rejected?")));
    assert.ok(facts.some((fact) => fact.title === "Career applications: 9"));
    assert.ok(facts.some((fact) => fact.title === "School: 2 open tasks"));
  });
});
