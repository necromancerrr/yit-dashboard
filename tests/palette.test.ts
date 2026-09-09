import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DESTINATIONS, matchDestinations } from "@/lib/palette";

describe("matchDestinations", () => {
  test("lists everything for an empty query", () => {
    assert.equal(matchDestinations("").length, DESTINATIONS.length);
    assert.equal(matchDestinations("   ").length, DESTINATIONS.length);
  });

  test("matches a section by its name, case-insensitively", () => {
    assert.deepEqual(
      matchDestinations("MON").map((d) => d.href),
      ["/money"]
    );
  });

  test("matches by what you would type, not what the section is called", () => {
    // Nobody searches "Growth" looking for LeetCode.
    assert.deepEqual(
      matchDestinations("leetcode").map((d) => d.href),
      ["/growth"]
    );
    assert.deepEqual(
      matchDestinations("subscriptions").map((d) => d.href),
      ["/money"]
    );
    assert.deepEqual(
      matchDestinations("face id").map((d) => d.href),
      ["/security"]
    );
    assert.deepEqual(
      matchDestinations("api key").map((d) => d.href),
      ["/setup"]
    );
  });

  test("returns nothing rather than guessing at a typo", () => {
    // Substring, not fuzzy: a confident jump to the wrong page is worse than
    // an empty list, which at least tells you to retype.
    assert.deepEqual(matchDestinations("moneyy"), []);
    assert.deepEqual(matchDestinations("skool"), []);
  });
});

describe("the palette and the sidebar stay in step", () => {
  /**
   * These two lists are maintained by hand in different files, and a section
   * added to one and forgotten in the other is invisible until someone goes
   * looking for it. Reading the nav's source is crude, but it is the only
   * thing that fails when they drift.
   */
  test("every sidebar destination is reachable from the palette", () => {
    const nav = readFileSync(
      path.join(process.cwd(), "src/components/Nav.tsx"),
      "utf8"
    );
    const navBlock = nav.slice(nav.indexOf("const NAV_ITEMS"), nav.indexOf("MOBILE_NAV_HREFS"));
    const navHrefs = [...navBlock.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);

    assert.ok(navHrefs.length > 5, "failed to read NAV_ITEMS — the parsing above is stale");

    const paletteHrefs = new Set(DESTINATIONS.map((d) => d.href));
    for (const href of navHrefs) {
      assert.ok(paletteHrefs.has(href), `${href} is in the sidebar but not in the palette`);
    }
  });

  test("no destination has an empty keyword list", () => {
    for (const d of DESTINATIONS) {
      assert.ok(d.keywords.trim().length > 0, `${d.href} has no keywords`);
      assert.equal(d.keywords, d.keywords.toLowerCase(), `${d.href} keywords must be lowercase`);
    }
  });
});
