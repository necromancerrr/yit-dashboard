import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { classifyDeterministic, extractDeadline } from "@/lib/ingest/classify";
import { EMAIL_FIXTURES } from "./fixtures/emails";

describe("deterministic classification", () => {
  for (const fixture of EMAIL_FIXTURES) {
    test(fixture.name, () => {
      const signal = classifyDeterministic(fixture.message);

      if (fixture.expect.deferToAI) {
        assert.equal(signal, null, "rules should defer rather than guess");
        return;
      }

      assert.ok(signal, "expected the rules to produce a signal");
      assert.equal(signal.isCareerRelated, fixture.expect.careerRelated);
      assert.equal(signal.status, fixture.expect.status);

      if (fixture.expect.deadline !== undefined) {
        assert.equal(signal.deadline, fixture.expect.deadline);
      }
      if (fixture.expect.company !== undefined) {
        assert.equal(signal.company, fixture.expect.company);
      }
    });
  }
});

describe("deadline extraction", () => {
  const received = "2026-08-20";

  test("explicit month and day", () => {
    assert.equal(extractDeadline("due by August 24, 2026", received), "2026-08-24");
  });

  test("ISO date", () => {
    assert.equal(extractDeadline("deadline: 2026-09-01", received), "2026-09-01");
  });

  test("no year assumes the coming occurrence, never the past", () => {
    // January is behind August, so it must resolve to next year.
    assert.equal(extractDeadline("expires on January 5", received), "2027-01-05");
  });

  test("relative window", () => {
    assert.equal(extractDeadline("complete by within 3 days", received), "2026-08-23");
  });

  test("absent deadline is null, never a guess", () => {
    assert.equal(extractDeadline("please complete the assessment soon", received), null);
  });

  test("implausible relative window is rejected", () => {
    assert.equal(extractDeadline("within 400 days", received), null);
  });
});
