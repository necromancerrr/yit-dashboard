import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DESTINATIONS } from "@/lib/palette";

/**
 * The bottom bar used to show five of eleven destinations, and the other six
 * — plus Export and Sign out — had no route on a phone at all. You could only
 * reach them by typing a URL, which is not a navigation design, it is an
 * omission, and it stayed invisible because the desktop sidebar was complete.
 *
 * The rule now: every destination is in the bottom bar or in the More sheet,
 * and the sheet renders everything the bar does not. These read `Nav.tsx` as
 * source because that is the only thing that fails when a section is added and
 * the bar is not updated.
 */

const nav = readFileSync(path.join(process.cwd(), "src/components/Nav.tsx"), "utf8");

function navHrefs(): string[] {
  const block = nav.slice(nav.indexOf("const NAV_ITEMS"), nav.indexOf("const GROUPS"));
  return [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function mobileHrefs(): string[] {
  const line = nav.slice(nav.indexOf("const MOBILE_NAV_HREFS"));
  const set = line.slice(0, line.indexOf("]"));
  return [...set.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("every destination is reachable on a phone", () => {
  test("the source parses — otherwise the checks below are vacuous", () => {
    assert.ok(navHrefs().length >= 8, "failed to read NAV_ITEMS");
    assert.ok(mobileHrefs().length >= 3, "failed to read MOBILE_NAV_HREFS");
  });

  test("the bottom bar holds few enough tabs to stay legible", () => {
    // Four plus the More button. Five icons across a narrow phone is the point
    // where labels start truncating.
    assert.ok(
      mobileHrefs().length <= 4,
      `${mobileHrefs().length} tabs plus More will not fit a small screen`
    );
  });

  test("every bottom-bar href is a real destination", () => {
    const all = new Set(navHrefs());
    for (const href of mobileHrefs()) {
      assert.ok(all.has(href), `${href} is in the bottom bar but not in NAV_ITEMS`);
    }
  });

  test("the More sheet renders everything the bar does not", () => {
    // overflowItems is defined as exactly that complement, so the guarantee is
    // structural rather than a second hand-maintained list. This asserts the
    // definition has not been replaced by an enumeration.
    assert.match(
      nav,
      /const overflowItems = NAV_ITEMS\.filter\(\(item\) => !MOBILE_NAV_HREFS\.has\(item\.href\)\)/,
      "overflowItems must stay the complement of the bottom bar, not a hand-written list"
    );
    assert.ok(nav.includes("overflowItems.filter((item) => item.group === group.id)"));
  });

  test("Export and Sign out are in the sheet, not desktop-only", () => {
    const sheet = nav.slice(nav.indexOf('aria-label="More destinations"'));
    assert.ok(sheet.includes('href="/api/export"'), "a phone must be able to back up its data");
    assert.ok(sheet.includes("handleLogout"), "a phone must be able to sign out");
  });

  test("every nav item belongs to a rendered group", () => {
    const groups = new Set(
      [...nav.slice(nav.indexOf("const GROUPS"), nav.indexOf("MOBILE_NAV_HREFS")).matchAll(/id: "(\w+)"/g)].map(
        (m) => m[1]
      )
    );
    assert.ok(groups.size >= 2, "failed to read GROUPS");
    const itemGroups = [
      ...nav
        .slice(nav.indexOf("const NAV_ITEMS"), nav.indexOf("const GROUPS"))
        .matchAll(/group: "(\w+)"/g),
    ].map((m) => m[1]);
    assert.equal(itemGroups.length, navHrefs().length, "every item needs a group");
    for (const g of itemGroups) {
      assert.ok(groups.has(g), `group "${g}" is on an item but never rendered`);
    }
  });

  test("the palette still covers every sidebar destination", () => {
    const paletteHrefs = new Set(DESTINATIONS.map((d) => d.href));
    for (const href of navHrefs()) {
      assert.ok(paletteHrefs.has(href), `${href} is in the sidebar but not in the palette`);
    }
  });
});
