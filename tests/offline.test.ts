import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";

import {
  OFFLINE_URL,
  formatCachedAt,
  readOfflineEnvelope,
  wasRedacted,
  noteResponse,
  noteNetworkFailure,
  getOfflineSnapshot,
  __resetOfflineState,
} from "@/lib/offline";

/**
 * `public/sw.js` is not bundled, so it cannot import anything from src/ and
 * nothing in src/ can import it. It is loaded here in a sandbox with just
 * enough of a service worker global to evaluate, and its routing policy — which
 * requests it will and won't answer from a cache — is asserted directly.
 *
 * That policy is the part with teeth. The caching mechanics need a browser and
 * a real network drop to verify; *what may be served stale* is a pure decision
 * and belongs under test.
 */
interface SwPolicy {
  isBypassed(pathname: string): boolean;
  isLivePriceRoute(pathname: string): boolean;
  isApi(pathname: string): boolean;
  isAsset(pathname: string): boolean;
  isCacheableApi(pathname: string): boolean;
  OFFLINE_URL: string;
  OWNED_CACHES: string[];
}

function loadWorker(): { policy: SwPolicy; events: string[]; source: string } {
  const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  const events: string[] = [];
  const self: Record<string, unknown> = {
    addEventListener: (type: string) => events.push(type),
    location: { origin: "https://example.test" },
    clients: { claim: async () => {} },
    skipWaiting: () => {},
  };
  const sandbox = { self, caches: {}, fetch: async () => {}, Response: class {}, URL, console };
  (sandbox as Record<string, unknown>).globalThis = sandbox;
  runInContext(source, createContext(sandbox));
  return { policy: self.__swPolicy as SwPolicy, events, source };
}

const { policy, events, source } = loadWorker();

test("the worker registers the lifecycle handlers it needs", () => {
  assert.deepEqual(events.sort(), ["activate", "fetch", "install", "message"]);
});

test("live-priced endpoints are never cached and never served stale", () => {
  assert.equal(policy.isLivePriceRoute("/api/crypto"), true);
  assert.equal(policy.isLivePriceRoute("/api/crypto/12"), true);
  assert.equal(policy.isCacheableApi("/api/crypto"), false);
  // Not a prefix match on the string: /api/cryptography would be a different
  // resource entirely.
  assert.equal(policy.isLivePriceRoute("/api/cryptonite"), false);
});

test("auth, share target and side-effecting routes are left entirely alone", () => {
  for (const p of [
    "/share",
    "/api/auth/login",
    "/api/auth/passkey/login/verify",
    "/api/export",
    "/api/ingest/sync",
    "/api/import/screenshot",
  ]) {
    assert.equal(policy.isBypassed(p), true, p);
    assert.equal(policy.isCacheableApi(p), false, p);
  }
});

test("ordinary data endpoints are cacheable", () => {
  for (const p of ["/api/today", "/api/school", "/api/checklist", "/api/applications", "/api/finance"]) {
    assert.equal(policy.isCacheableApi(p), true, p);
  }
});

test("only immutable-by-URL things are treated as cache-first assets", () => {
  assert.equal(policy.isAsset("/_next/static/chunks/main-abc123.js"), true);
  assert.equal(policy.isAsset("/icon-192"), true);
  assert.equal(policy.isAsset("/manifest.webmanifest"), true);
  assert.equal(policy.isAsset("/globe.svg"), true);
  // A page and an API route must never fall into the cache-first branch.
  assert.equal(policy.isAsset("/career"), false);
  assert.equal(policy.isAsset("/api/today"), false);
});

test("the worker only ever answers GET requests", () => {
  // The guard that keeps an offline POST/PATCH/DELETE — and the OS share
  // target's inbound POST — from ever being intercepted or replayed.
  assert.match(source, /req\.method !== "GET"/);
  assert.doesNotMatch(source, /SyncManager|backgroundSync|"sync"/);
});

test("the offline fallback URL matches the one the app publishes", () => {
  assert.equal(policy.OFFLINE_URL, OFFLINE_URL);
});

test("every cache the worker owns is namespaced so activate can retire it", () => {
  assert.equal(policy.OWNED_CACHES.length, 3);
  for (const name of policy.OWNED_CACHES) assert.match(name, /^yit-.+-v\d+$/);
});

// --- the app's half of the contract -----------------------------------------

test("a live response carries no offline envelope", () => {
  assert.equal(readOfflineEnvelope({ items: [] }), null);
  assert.equal(readOfflineEnvelope({ items: [], offline: { stale: false, cachedAt: null } }), null);
  assert.equal(readOfflineEnvelope(null), null);
  assert.equal(readOfflineEnvelope("nope"), null);
});

test("a cached response reports when it was saved and what was blanked out", () => {
  const body = {
    monthNet: 120,
    netWorthSnapshot: null,
    offline: { stale: true, cachedAt: "2026-09-09T08:30:00.000Z", redacted: ["netWorthSnapshot"] },
  };
  const env = readOfflineEnvelope(body);
  assert.equal(env?.stale, true);
  assert.equal(env?.cachedAt, "2026-09-09T08:30:00.000Z");
  assert.equal(wasRedacted(body, "netWorthSnapshot"), true);
  assert.equal(wasRedacted(body, "monthNet"), false);
});

test("formatCachedAt names a time, and says which day when it isn't today", () => {
  const now = new Date("2026-09-09T20:00:00Z");
  assert.match(formatCachedAt(new Date("2026-09-09T09:00:00Z").toISOString(), now), /\d/);
  assert.match(formatCachedAt(new Date("2026-09-08T09:00:00Z").toISOString(), now), /^yesterday /);
  assert.match(formatCachedAt(new Date("2026-09-01T09:00:00Z").toISOString(), now), /Sep/);
  // A cached body with no timestamp must still produce a truthful phrase
  // rather than an empty span or "Invalid Date".
  assert.equal(formatCachedAt(null, now), "an earlier session");
  assert.equal(formatCachedAt("not a date", now), "an earlier session");
});

test("the connectivity store tracks both signals and clears on a live response", () => {
  __resetOfflineState();
  assert.deepEqual(getOfflineSnapshot(), { offline: false, cachedAt: null });

  // navigator.onLine can stay true on a network with no upstream, so a failed
  // request is itself evidence.
  noteNetworkFailure();
  assert.equal(getOfflineSnapshot().offline, true);

  noteResponse({ items: [], offline: { stale: true, cachedAt: "2026-09-09T08:30:00.000Z" } });
  assert.deepEqual(getOfflineSnapshot(), { offline: true, cachedAt: "2026-09-09T08:30:00.000Z" });

  noteResponse({ items: [] });
  assert.deepEqual(getOfflineSnapshot(), { offline: false, cachedAt: null });

  // Snapshots must be referentially stable or useSyncExternalStore loops.
  assert.equal(getOfflineSnapshot(), getOfflineSnapshot());
  __resetOfflineState();
});
