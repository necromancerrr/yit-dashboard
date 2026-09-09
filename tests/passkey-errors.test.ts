import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { WebAuthnError } from "@simplewebauthn/browser";
import { passkeyErrorMessage } from "@/lib/passkey-errors";

function webAuthnError(code: string, message = "platform text") {
  return new WebAuthnError({
    message,
    code: code as never,
    cause: new Error("cause"),
  });
}

describe("passkeyErrorMessage", () => {
  test("stays silent only for an identified cancellation", () => {
    assert.equal(passkeyErrorMessage(webAuthnError("ERROR_CEREMONY_ABORTED"), "login"), null);
  });

  test("explains a domain mismatch, the most common real cause", () => {
    const message = passkeyErrorMessage(webAuthnError("ERROR_INVALID_RP_ID"), "login");
    assert.match(String(message), /different web address/i);
  });

  test("does not leak the platform's useless NotAllowedError text", () => {
    // Regression: the library wraps a bare NotAllowedError as
    // ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY, so an `err.name` check never runs
    // and this fell through to `default: return err.message` — surfacing
    // "not allowed or timed out", which tells the user nothing actionable.
    const message = passkeyErrorMessage(
      webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "The operation either timed out or was not allowed."),
      "login"
    );
    assert.doesNotMatch(String(message), /timed out or was not allowed/i);
    assert.match(String(message), /sign in with your password/i);
  });

  test("says something different when registering than when signing in", () => {
    const login = passkeyErrorMessage(webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"), "login");
    const register = passkeyErrorMessage(webAuthnError("ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY"), "register");
    assert.notEqual(login, register);
  });

  test("handles a raw DOMException that never reached the library", () => {
    const raw = new Error("nope");
    raw.name = "NotAllowedError";
    assert.match(String(passkeyErrorMessage(raw, "login")), /sign in with your password/i);
  });

  test("never returns null for anything it could not identify", () => {
    // Silence is the failure mode this whole module exists to prevent.
    for (const code of [
      "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      "ERROR_INVALID_DOMAIN",
      "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      "ERROR_AUTHENTICATOR_GENERAL_ERROR",
    ]) {
      assert.notEqual(passkeyErrorMessage(webAuthnError(code), "login"), null, code);
    }
  });
});
