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
        return `This passkey belongs to a different web address than ${window.location.hostname}. Sign in with your password, then add this device again under Security.`;

      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "This device already has a passkey for this site — you can sign in with it.";

      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
        return "This device can't do Face ID, Touch ID, or a PIN, which this site requires.";

      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
        return "This device can't store a passkey for this site.";

      default:
        return err.message;
    }
  }

  // Not a WebAuthnError. A bare NotAllowedError reaches here from some
  // browsers; it means the ceremony ended without a credential, which is
  // either a dismissal, a timeout, or no passkey on this device — and the
  // browser deliberately will not say which.
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError") {
    return action === "login"
      ? "No passkey was used. If you didn't cancel, this device may not have one for this site yet — sign in with your password, then add it under Security."
      : "Setup didn't finish. If you didn't cancel, your device may have timed out — try again.";
  }

  if (name === "SecurityError") {
    return "Passkeys need a secure (HTTPS) connection on the site's real domain.";
  }

  return err instanceof Error ? err.message : "Something went wrong with that passkey.";
}
