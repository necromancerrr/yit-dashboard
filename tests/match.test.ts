import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchApplication, companiesMatch, roleSimilarity } from "@/lib/ingest/match";
import { normalizeCompany, stripForwardPrefixes, parseSender, truncateSnippet } from "@/lib/ingest/normalize";

describe("company identity", () => {
  test("legal suffixes and punctuation do not fork an employer", () => {
    assert.ok(companiesMatch("Goldman Sachs & Co.", "Goldman Sachs"));
    assert.ok(companiesMatch("Stripe, Inc.", "Stripe"));
    assert.ok(companiesMatch("Datadog Technologies", "Datadog"));
  });

  test("a domain label matches the typed name", () => {
    assert.ok(companiesMatch("goldmansachs", "Goldman Sachs"));
  });

  test("different employers stay different", () => {
    assert.equal(companiesMatch("Amazon", "Amazon Web Services Brazil"), true, "prefix of same brand");
    assert.equal(companiesMatch("Meta", "Metabase"), false, "short prefix must not collide");
    assert.equal(companiesMatch("Stripe", "Snowflake"), false);
  });

  test("normalization is stable", () => {
    assert.equal(normalizeCompany("Goldman Sachs & Co."), "goldman sachs");
    assert.equal(normalizeCompany("  STRIPE  "), "stripe");
  });
});

describe("role similarity", () => {
  test("abbreviations count as the same role", () => {
    assert.ok(roleSimilarity("SDE Intern", "Software Engineer Intern") > 0.5);
    assert.ok(roleSimilarity("SWE Intern 2026", "Software Engineering Intern") > 0.5);
  });

  test("genuinely different roles score low", () => {
    assert.ok(roleSimilarity("Data Engineer Intern", "Product Manager Intern") < 0.5);
  });
});

describe("matching a signal to an application", () => {
  const candidates = [
    { id: 1, company: "Goldman Sachs", role: "SWE Intern", status: "Applied" },
    { id: 2, company: "Amazon", role: "SDE Intern", status: "Applied" },
    { id: 3, company: "Amazon", role: "Data Engineer Intern", status: "Applied" },
  ];

  test("single application at a company matches on company alone", () => {
    const r = matchApplication({ company: "goldmansachs", role: null }, candidates, null);
    assert.equal(r.applicationId, 1);
    assert.equal(r.ambiguous, false);
  });

  test("two roles at one company with no role stated is ambiguous, not a guess", () => {
    const r = matchApplication({ company: "Amazon", role: null }, candidates, null);
    assert.equal(r.applicationId, null);
    assert.equal(r.ambiguous, true);
  });

  test("two roles at one company resolve when the role is stated", () => {
    const r = matchApplication(
      { company: "Amazon", role: "Software Engineer Intern" },
      candidates,
      null
    );
    assert.equal(r.applicationId, 2);
    assert.equal(r.ambiguous, false);
  });

  test("an unknown company matches nothing rather than the nearest row", () => {
    const r = matchApplication({ company: "Snowflake", role: null }, candidates, null);
    assert.equal(r.applicationId, null);
    assert.equal(r.ambiguous, false);
  });

  test("thread continuity wins even when the company is unstated", () => {
    const threaded = [{ ...candidates[1], threadId: "thread-9" }];
    const r = matchApplication({ company: null, role: null }, threaded, "thread-9");
    assert.equal(r.applicationId, 2);
    assert.ok(r.confidence > 0.9);
  });

  test("no company and no thread matches nothing", () => {
    const r = matchApplication({ company: null, role: null }, candidates, null);
    assert.equal(r.applicationId, null);
  });
});

describe("normalization", () => {
  test("stacked forward prefixes are stripped", () => {
    assert.equal(
      stripForwardPrefixes("Fwd: Re: Fwd: Thank you for applying"),
      "Thank you for applying"
    );
    assert.equal(stripForwardPrefixes("RE[2]: Offer"), "Offer");
  });

  test("sender parsing", () => {
    assert.deepEqual(parseSender("Jane Doe <jane@corp.com>"), {
      name: "Jane Doe",
      email: "jane@corp.com",
    });
    assert.deepEqual(parseSender("bare@corp.com"), { name: null, email: "bare@corp.com" });
  });

  test("snippets are clamped to what we are willing to store", () => {
    const long = "x".repeat(500);
    assert.ok(truncateSnippet(long).length <= 300);
    assert.ok(truncateSnippet(long).endsWith("…"));
  });
});
