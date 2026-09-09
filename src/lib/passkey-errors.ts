import { WebAuthnError } from "@simplewebauthn/browser";

/**
 * Turn a WebAuthn failure into something you can act on.
 *
 * This exists because of a real bug: the first version swallowed anything
 * matching /abort|cancel|NotAllowed/, on the theory that those meant "the user
 * dismissed the sheet". But the spec makes `NotAllowedError` the catch-all —
 * a timeout, a domain mismatch, and "no passkey on this device" all arrive
 * under that same name. So genuine failures showed *nothing at all*: the
 * button stopped spinning and the page sat there.
 *
 * Silence is the worst possible response to a failed sign-in. Returning null
 * is reserved for a cancellation we can actually identify.
 */
/** `window` is absent during server rendering and in tests; never throw for a label. */
function currentHost(): string {
  return typeof window === "undefined" ? "this site" : window.location.hostname;
}

/** What to say when the browser refuses to tell us why the ceremony ended. */
function unidentifiedMessage(action: "login" | "register"): string {
  return action === "login"
    ? "No passkey was used. If you didn't cancel, this device may not have one for this site yet — sign in with your password, then add it under Security."
    : "Setup didn't finish. If you didn't cancel, your device may have timed out — try again.";
}

export function passkeyErrorMessage(err: unknown, action: "login" | "register"): string | null {
  if (err instanceof WebAuthnError) {
    switch (err.code) {
      case "ERROR_CEREMONY_ABORTED":
        // Genuinely dismissed. The only case worth staying quiet about.
        return null;

      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        // The single most common real-world cause: the passkey was created on
        // a different address (a preview deployment, or www vs the apex).
        return `This passkey belongs to a different web address than ${currentHost()}. Sign in with your password, then add this device again under Security.`;

      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "This device already has a passkey for this site — you can sign in with it.";

      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
        return "This device can't do Face ID, Touch ID, or a PIN, which this site requires.";

      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
        return "This device can't store a passkey for this site.";

      case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
        // The library wraps a bare NotAllowedError under this code rather than
        // interpreting it, because platforms overload that name. It is the
        // catch-all: dismissal, timeout, and "no passkey on this device" all
        // land here and the browser deliberately will not say which. The
        // platform's own text ("not allowed or timed out") explains nothing,
        // so say the useful thing instead.
        return unidentifiedMessage(action);

      default:
        return err.message;
    }
  }

  // Not a WebAuthnError at all — a raw DOMException, if the ceremony threw
  // before the library could classify it.
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") return unidentifiedMessage(action);

  if (name === "SecurityError") {
    return "Passkeys need a secure (HTTPS) connection on the site's real domain.";
  }

  return err instanceof Error ? err.message : "Something went wrong with that passkey.";
}
