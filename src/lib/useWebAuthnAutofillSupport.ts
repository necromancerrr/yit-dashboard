"use client";

import { useSyncExternalStore } from "react";
import { browserSupportsWebAuthnAutofill } from "@simplewebauthn/browser";

// Whether this browser can put passkeys in the autofill dropdown ("conditional
// mediation"). Unlike `browserSupportsWebAuthn()` this answer arrives as a
// *promise* — `PublicKeyCredential.isConditionalMediationAvailable()` — so it
// cannot simply be read during render.
//
// It is still not React state: the answer belongs to the browser, is identical
// for every component that asks, and never changes while the page is open. So
// the promise is resolved once into a module-level cache and components
// subscribe to that, exactly as `useWebAuthnSupport` subscribes to `navigator`.
// The alternative — `useState` plus a `setState` inside `useEffect` — is what
// the React Compiler lint rules reject, and it would re-probe per component.
let supported = false;
let probe: Promise<void> | null = null;
const listeners = new Set<() => void>();

function startProbe() {
  probe ??= browserSupportsWebAuthnAutofill()
    .catch(() => false) // an unsupported browser must degrade, not throw
    .then((result) => {
      supported = result;
      for (const listener of listeners) listener();
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Kick the probe off from `subscribe`, not from the snapshot getter: getting
  // a snapshot must stay pure and synchronous.
  startProbe();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the browser can offer passkeys through autofill.
 *
 * Returns `false` on the server and on the first client render (the probe has
 * not answered yet), then flips to `true` once it has. Callers get a plain
 * boolean that is safe to hydrate against and safe to use as an effect
 * dependency — and, importantly, a render happens *between* the answer and any
 * effect that depends on it, so markup the ceremony needs (the `webauthn`
 * autocomplete token) is already in the DOM by the time the effect runs.
 */
export function useWebAuthnAutofillSupport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => supported, // client
    () => false // server: no PublicKeyCredential at all
  );
}
