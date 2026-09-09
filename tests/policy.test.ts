import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideCareerTier,
  decideMoneyTier,
  decideSchoolTier,
  decideDomainTier,
  parseMode,
  tierActs,
  CAREER_AUTO_BAR,
  MONEY_AUTO_BAR,
  SCHOOL_AUTO_BAR,
  AUTO_APPLY_MAX_AMOUNT,
  AUTO_APPLY_MAX_PER_RUN,
  TRUST_PROMOTION,
  TRUST_IDLE_DAYS,
  TRUST_DECAY_EVERY_DAYS,
  effectiveConfirms,
  requiredConfirms,
  assessTrust,
  type RunContext,
  type TrustRecord,
} from "@/lib/autonomy/policy";
import { AUTO_APPLY_MIN_CONFIDENCE } from "@/lib/ingest/classify";

/**
 * The regression suite for autonomy.
 *
 * Almost every test here asserts a *refusal*. The tiers are only defensible if
 * the never-list is genuinely unreachable — a threshold that can be tuned into
 * allowing something is not a guarantee, and "gradual drift toward full
 * autonomy because the prompts feel like friction" is the failure this design
 * is most exposed to.
 */

const TODAY = "2026-06-01";

const run = (over: Partial<RunContext> = {}): RunContext => ({
  mode: "auto",
  actionsSoFar: 0,
  today: TODAY,
  ...over,
});

/** A sender that has earned the right to act, with room to spare. */
const trusted = (over: Partial<TrustRecord> = {}): TrustRecord => ({
  scopeKey: "spotify.com",
  confirms: TRUST_PROMOTION,
  corrections: 0,
  mode: "ask",
  lastConfirmedAt: TODAY,
  lastAppliedAt: null,
  ...over,
});

describe("parseMode", () => {
  test("anything unset or unrecognised means today's behaviour", () => {
    // A typo in the variable must never widen what the app may do.
    assert.equal(parseMode(undefined), "assist");
    assert.equal(parseMode(""), "assist");
    assert.equal(parseMode("AUTO_APPLY_EVERYTHING"), "assist");
    assert.equal(parseMode("yes"), "assist");
  });

  test("off and auto are opted into explicitly, case-insensitively", () => {
    assert.equal(parseMode("off"), "off");
    assert.equal(parseMode("Auto"), "auto");
    assert.equal(parseMode("  OFF "), "off");
  });
});

describe("the career bar still means what the pipeline meant", () => {
  test("CAREER_AUTO_BAR is the value the pipeline used inline", () => {
    // policy.ts stays free of ingest imports; this is what pins the two.
    assert.equal(CAREER_AUTO_BAR, Number((AUTO_APPLY_MIN_CONFIDENCE * 0.9).toFixed(10)));
  });
});

describe("career", () => {
  const ok = { method: "deterministic" as const, combined: 0.9, ambiguous: false, hasMatch: true };

  test("a confident deterministic match on an existing application acts", () => {
    const d = decideCareerTier(ok, run({ mode: "assist" }));
    assert.equal(d.tier, "act_log");
    assert.equal(tierActs(d.tier), true);
  });

  test("creating an application is never automatic, at any confidence", () => {
    // An application is an identity, not a fact: a wrong one becomes a
    // permanent candidate that every future message is matched against.
    const d = decideCareerTier({ ...ok, hasMatch: false, combined: 1 }, run());
    assert.equal(d.tier, "never");
  });

  test("an ambiguous match is always a question", () => {
    assert.equal(decideCareerTier({ ...ok, ambiguous: true, combined: 1 }, run()).tier, "ask");
  });

  test("anything a model read is always a question", () => {
    assert.equal(decideCareerTier({ ...ok, method: "ai", combined: 1 }, run()).tier, "ask");
  });

  test("below the bar is a question, and the reason says how sure it was", () => {
    const d = decideCareerTier({ ...ok, combined: CAREER_AUTO_BAR - 0.01 }, run());
    assert.equal(d.tier, "ask");
    assert.match(d.reason, /80% sure/);
  });

  test("AUTOMATION_MODE=off stops even the behaviour that predates this", () => {
    assert.equal(decideCareerTier(ok, run({ mode: "off" })).tier, "ask");
  });
});

describe("money", () => {
  const ok = {
    confidence: MONEY_AUTO_BAR,
    amount: 18.4,
    type: "expense" as const,
    method: "deterministic" as const,
    trust: trusted(),
  };

  test("a small receipt from a billing sender it has learned acts, and tells you", () => {
    const d = decideMoneyTier(ok, run());
    assert.equal(d.tier, "act_tell");
  });

  test("a sender it has never seen is a question, however receipt-shaped", () => {
    // Looking like a receipt is a structural signal and says nothing about
    // whether this particular sender has ever been read correctly.
    const d = decideMoneyTier({ ...ok, trust: null }, run());
    assert.equal(d.tier, "ask");
    assert.match(d.reason, /New sender/);
  });

  test("a sender you turned off never acts, at any confirmation count", () => {
    const d = decideMoneyTier(
      { ...ok, trust: trusted({ mode: "never", confirms: 99 }) },
      run()
    );
    assert.equal(d.tier, "ask");
    assert.match(d.reason, /turned this sender off/);
  });

  test("a sender you allowed by hand does not wait for the counter", () => {
    const d = decideMoneyTier(
      { ...ok, trust: trusted({ mode: "auto", confirms: 0, lastConfirmedAt: null }) },
      run()
    );
    assert.equal(d.tier, "act_tell");
  });

  test("money never rides along with assist — it must be opted into", () => {
    // A wrong row here becomes a wrong number on the home screen.
    assert.equal(decideMoneyTier(ok, run({ mode: "assist" })).tier, "ask");
    assert.equal(decideMoneyTier(ok, run({ mode: "off" })).tier, "ask");
  });

  test("income is never automatic", () => {
    // A misfiled expense understates the month; a phantom income overstates
    // what you have. The error is not symmetric.
    assert.equal(decideMoneyTier({ ...ok, type: "income" }, run()).tier, "ask");
  });

  test("a generic 'mentions $40' message stays a question forever", () => {
    // 0.72 is the non-receipt-sender confidence in domains.ts.
    assert.equal(decideMoneyTier({ ...ok, confidence: 0.72 }, run()).tier, "ask");
  });

  test("anything over the ceiling is a question, and says so", () => {
    const d = decideMoneyTier({ ...ok, amount: AUTO_APPLY_MAX_AMOUNT + 0.01 }, run());
    assert.equal(d.tier, "ask");
    assert.match(d.reason, /\$100/);
    assert.equal(decideMoneyTier({ ...ok, amount: AUTO_APPLY_MAX_AMOUNT }, run()).tier, "act_tell");
  });

  test("a zero or negative amount never writes a row", () => {
    assert.equal(decideMoneyTier({ ...ok, amount: 0 }, run()).tier, "ask");
    assert.equal(decideMoneyTier({ ...ok, amount: -5 }, run()).tier, "ask");
  });

  test("a charge that looks already recorded is a question", () => {
    assert.equal(decideMoneyTier({ ...ok, possibleDuplicate: true }, run()).tier, "ask");
  });
});

describe("school", () => {
  const ok = {
    confidence: SCHOOL_AUTO_BAR,
    method: "deterministic" as const,
    dueDate: "2026-04-02",
    courseParsed: true,
    trust: trusted({ scopeKey: "instructure.com" }),
  };

  test("an LMS message with a stated date and a real course acts", () => {
    assert.equal(decideSchoolTier(ok, run()).tier, "act_tell");
  });

  test("an unlearned course platform still asks — a wrong deadline is the worse error", () => {
    assert.equal(decideSchoolTier({ ...ok, trust: null }, run()).tier, "ask");
  });

  test("no date in the message is never a task", () => {
    // extractDate refuses to compute one; autonomy must not soften that. You
    // plan around a deadline without questioning it.
    assert.equal(decideSchoolTier({ ...ok, dueDate: null }, run()).tier, "ask");
  });

  test("a .edu sender alone is not enough", () => {
    assert.equal(decideSchoolTier({ ...ok, confidence: 0.75 }, run()).tier, "ask");
  });

  test("a course that fell back to the generic label is a question", () => {
    assert.equal(decideSchoolTier({ ...ok, courseParsed: false }, run()).tier, "ask");
  });
});

describe("the run budget", () => {
  test("past the budget, everything drops to a question", () => {
    const full = run({ actionsSoFar: AUTO_APPLY_MAX_PER_RUN });
    const d = decideMoneyTier(
      { confidence: 0.99, amount: 5, type: "expense", method: "deterministic", trust: trusted() },
      full
    );
    assert.equal(d.tier, "ask");
    assert.match(d.reason, /Already handled 10/);
    // Career too — the budget is the run's, not one domain's.
    assert.equal(
      decideCareerTier(
        { method: "deterministic", combined: 1, ambiguous: false, hasMatch: true },
        full
      ).tier,
      "ask"
    );
  });

  test("the last slot inside the budget still acts", () => {
    const d = decideMoneyTier(
      { confidence: 0.99, amount: 5, type: "expense", method: "deterministic", trust: trusted() },
      run({ actionsSoFar: AUTO_APPLY_MAX_PER_RUN - 1 })
    );
    assert.equal(d.tier, "act_tell");
  });
});

describe("decideDomainTier routes to the right rules", () => {
  test("a money signal with no amount is never written", () => {
    const d = decideDomainTier(
      { domain: "money", confidence: 0.99, reason: "Receipt" },
      run()
    );
    assert.equal(d.tier, "ask");
  });

  test("a school signal with no proposal is never written", () => {
    const d = decideDomainTier(
      { domain: "school", confidence: 0.99, reason: "Course platform" },
      run()
    );
    assert.equal(d.tier, "ask");
  });

  test("a course of literally 'Course' is the fallback, not a course", () => {
    const d = decideDomainTier(
      {
        domain: "school",
        confidence: SCHOOL_AUTO_BAR,
        reason: "Course platform",
        school: { course: "Course", title: "Quiz 4", dueDate: "2026-04-02" },
      },
      run(),
      { trust: trusted({ scopeKey: "instructure.com" }) }
    );
    assert.equal(d.tier, "ask");
  });

  test("every refusal carries a sentence, never a bare code", () => {
    const decisions = [
      decideDomainTier({ domain: "money", confidence: 0.5, reason: "x" }, run()),
      decideCareerTier(
        { method: "ai", combined: 1, ambiguous: false, hasMatch: true },
        run()
      ),
      decideSchoolTier(
        { confidence: 0.9, method: "deterministic", dueDate: null, courseParsed: true },
        run()
      ),
      decideMoneyTier(
        { confidence: 0.99, amount: 5, type: "expense", method: "deterministic", trust: null },
        run()
      ),
    ];
    for (const d of decisions) {
      assert.ok(d.reason.length > 10, `"${d.reason}" is not an explanation`);
      assert.match(d.reason, /^[A-Z]/, "shown to the owner, so it reads as a sentence");
    }
  });
});

describe("what a sender has earned", () => {
  const base = (over: Partial<TrustRecord> = {}): TrustRecord => ({
    scopeKey: "spotify.com",
    confirms: 0,
    corrections: 0,
    mode: "ask",
    lastConfirmedAt: null,
    lastAppliedAt: null,
    ...over,
  });

  test("three clean confirmations are enough, two are not", () => {
    const two = assessTrust(base({ confirms: 2, lastConfirmedAt: TODAY }), TODAY);
    assert.equal(two.trusted, false);
    assert.match(two.reason, /2 of 3/);

    assert.equal(
      assessTrust(base({ confirms: TRUST_PROMOTION, lastConfirmedAt: TODAY }), TODAY).trusted,
      true
    );
  });

  test("every past mistake raises the bar to earn it back", () => {
    // Recoverable, but at increasing cost. A sender whose mail is structurally
    // hard to read drifts out of autonomy on its own.
    assert.equal(requiredConfirms(base()), TRUST_PROMOTION);
    assert.equal(requiredConfirms(base({ corrections: 1 })), TRUST_PROMOTION + 1);
    assert.equal(requiredConfirms(base({ corrections: 4 })), TRUST_PROMOTION + 4);

    const recovering = assessTrust(
      base({ confirms: 3, corrections: 1, lastConfirmedAt: TODAY }),
      TODAY
    );
    assert.equal(recovering.trusted, false);
    assert.match(recovering.reason, /wrong before/);
  });

  test("a mistake is never a permanent ban — that is what 'never' is for", () => {
    // An automatic permanent ban from one mis-parse would accumulate silently
    // until nothing was ever automatic, which looks exactly like the feature
    // being broken.
    const recovered = assessTrust(
      base({ confirms: TRUST_PROMOTION + 1, corrections: 1, lastConfirmedAt: TODAY }),
      TODAY
    );
    assert.equal(recovered.trusted, true);
  });

  test("'never' overrules any amount of accumulated confidence", () => {
    const banned = assessTrust(
      base({ confirms: 500, corrections: 0, mode: "never", lastConfirmedAt: TODAY }),
      TODAY
    );
    assert.equal(banned.trusted, false);
    assert.equal(banned.needed, Infinity);
  });

  test("an unknown sender says how to change that", () => {
    const unknown = assessTrust(null, TODAY);
    assert.equal(unknown.trusted, false);
    assert.equal(unknown.standing, 0);
    assert.match(unknown.reason, /confirm 3 of these/i);
  });
});

describe("trust lapses when a sender goes quiet", () => {
  const record = (lastConfirmedAt: string, confirms = 5): TrustRecord => ({
    scopeKey: "spotify.com",
    confirms,
    corrections: 0,
    mode: "ask",
    lastConfirmedAt,
    lastAppliedAt: null,
  });

  test("nothing lapses inside the idle window", () => {
    assert.equal(effectiveConfirms(record("2026-03-01"), "2026-05-01"), 5); // 61 days
    assert.equal(
      effectiveConfirms(record("2026-03-01"), "2026-05-30"), // exactly 90
      5
    );
  });

  test("one confirmation lapses per thirty days after it", () => {
    // 90 + 30 = 120 days of silence costs one.
    assert.equal(effectiveConfirms(record("2026-01-01"), "2026-05-01"), 4);
    // 90 + 60 costs two.
    assert.equal(effectiveConfirms(record("2026-01-01"), "2026-05-31"), 3);
  });

  test("a promotion earned under one template does not outlive it", () => {
    // Long enough and it is as if the sender were new — which is the point:
    // "reliable" is a claim about the present, not a permanent title.
    const stale = record("2024-01-01", 3);
    assert.equal(effectiveConfirms(stale, "2026-06-01"), 0);
    assert.equal(assessTrust(stale, "2026-06-01").trusted, false);
  });

  test("an unattended write counts as activity, not just a confirmation", () => {
    const active: TrustRecord = {
      scopeKey: "spotify.com",
      confirms: 5,
      corrections: 0,
      mode: "ask",
      lastConfirmedAt: "2024-01-01",
      lastAppliedAt: "2026-05-20",
    };
    assert.equal(effectiveConfirms(active, "2026-06-01"), 5);
  });

  test("lapse never goes below zero, and a record with no history is left alone", () => {
    assert.equal(effectiveConfirms(record("2020-01-01", 2), "2026-06-01"), 0);
    assert.equal(
      effectiveConfirms(
        { scopeKey: "x", confirms: 3, corrections: 0, mode: "ask", lastConfirmedAt: null, lastAppliedAt: null },
        "2026-06-01"
      ),
      3
    );
  });

  test("the windows are the documented constants, not magic numbers", () => {
    assert.equal(TRUST_IDLE_DAYS, 90);
    assert.equal(TRUST_DECAY_EVERY_DAYS, 30);
    assert.equal(TRUST_PROMOTION, 3);
  });
});
