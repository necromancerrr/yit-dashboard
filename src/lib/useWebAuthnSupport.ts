"use client";

import { useSyncExternalStore } from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

// Nothing to subscribe to: whether this browser supports WebAuthn cannot change
// while the page is open, so the "unsubscribe" function is a no-op.
const subscribe = () => () => {};

/**
 * Whether this browser can do passkeys.
 *
 * This looks like a job for `useState` + `useEffect`, but it isn't: the value
 * lives *outside* React (on `navigator`) and does not exist at all during
 * server rendering. `useSyncExternalStore` is built for exactly that shape —
 * it takes a separate server snapshot, so the server renders `false`, the
 * client hydrates to the real value, and there is no mismatch and no extra
 * render pass.
 */
export function useWebAuthnSupport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => browserSupportsWebAuthn(), // client
    () => false // server: no navigator, so assume unsupported
  );
}
