"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
import { Lock, Fingerprint } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getBrandName } from "@/lib/identity";
import { useWebAuthnSupport } from "@/lib/useWebAuthnSupport";
import { useWebAuthnAutofillSupport } from "@/lib/useWebAuthnAutofillSupport";
import { passkeyErrorMessage } from "@/lib/passkey-errors";

// `next` comes straight from the query string, so only ever follow it when it
// is a path on this site — "//evil.com" and absolute URLs are not.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const canUsePasskey = useWebAuthnSupport();
  const canAutofillPasskey = useWebAuthnAutofillSupport();

  // True while the *conditional* (autofill) ceremony owns the library's shared
  // abort controller. The button flow takes ownership when it starts, so the
  // conditional cleanup can never cancel a ceremony the user explicitly asked
  // for. See the effect below.
  const conditionalOwnsCeremony = useRef(false);

  // Steps 2 and 3 of signing in are identical whichever way the ceremony was
  // started, so both paths share them.
  const verifyAssertion = useCallback(
    async (assertion: Awaited<ReturnType<typeof startAuthentication>>) => {
      const verifyRes = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Could not verify that device");

      router.replace(next);
      router.refresh();
    },
    [router, next]
  );

  /**
   * Conditional UI: offer the passkey through the browser's own autofill popup
   * as soon as the page is ready, so signing in is one tap on the password
   * field rather than a hunt for a button.
   *
   * This is a progressive enhancement and must behave like one. It only runs
   * where `browserSupportsWebAuthnAutofill()` said yes, it never shows a
   * blocking prompt of its own, and — the part that matters — it fails
   * *silently*. The request stays pending until the user picks a passkey or
   * something cancels it, and "something cancels it" is the normal ending:
   * typing a password, clicking the button, or leaving the page all abort it.
   * An error toast there would be an error message for doing nothing wrong.
   */
  useEffect(() => {
    if (!canAutofillPasskey) return;

    // Aborting the options fetch is separate from aborting the ceremony: the
    // former is our request, the latter belongs to the library's singleton.
    const fetchAbort = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const optionsRes = await fetch("/api/auth/passkey/login/options", {
          method: "POST",
          signal: fetchAbort.signal,
        });
        // A 404 here just means no passkey has been enrolled yet. That is not
        // a failure of anything the user did — there is simply nothing to
        // offer, so leave the form exactly as it was.
        if (!optionsRes.ok) return;
        const optionsJSON = await optionsRes.json();
        if (cancelled) return;

        conditionalOwnsCeremony.current = true;
        try {
          // `useBrowserAutofill` sets mediation: "conditional" and empties the
          // allow-list (conditional UI requires a discoverable credential).
          // The library also asserts that an <input> whose `autocomplete` ends
          // in "webauthn" is in the DOM — the password field below carries it.
          const assertion = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
          await verifyAssertion(assertion);
        } finally {
          conditionalOwnsCeremony.current = false;
        }
      } catch (err) {
        if (cancelled) return;
        // The user reached into the autofill popup and it went wrong — worth
        // saying. Anything that merely ended the waiting request is not.
        const message = passkeyErrorMessage(err, "login");
        if (message) setError(message);
      }
    })();

    return () => {
      cancelled = true;
      fetchAbort.abort();
      // Only ever cancel our own ceremony. If the button flow has taken over,
      // the library already aborted this one when it started its own.
      if (conditionalOwnsCeremony.current) {
        conditionalOwnsCeremony.current = false;
        WebAuthnAbortService.cancelCeremony();
      }
    };
  }, [canAutofillPasskey, verifyAssertion]);

  async function handlePasskey() {
    setPasskeyLoading(true);
    setError(null);
    // The explicit button wins: `startAuthentication` below aborts any pending
    // conditional request through the shared abort service, so hand ownership
    // over now and let that rejection be swallowed as a cancellation.
    conditionalOwnsCeremony.current = false;
    try {
      // Step 1: ask the server for a fresh challenge.
      const optionsRes = await fetch("/api/auth/passkey/login/options", { method: "POST" });
      const optionsJSON = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(optionsJSON.error ?? "Could not start passkey sign-in");

      // Step 2: the device prompts for Face ID / fingerprint and signs it.
      const assertion = await startAuthentication({ optionsJSON });

      // Step 3: the server checks the signature and issues the session cookie.
      await verifyAssertion(assertion);
    } catch (err) {
      setError(passkeyErrorMessage(err, "login"));
      setPasskeyLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong");
        setLoading(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4">
            <Logo size="lg" />
          </div>
          <h1 className="text-lg font-semibold">{getBrandName()}</h1>
          <p className="text-sm text-ink-muted mt-1" style={{ color: "var(--ink-muted)" }}>
            Sign in to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="label">
              Password
            </label>
            <div className="relative">
              <Lock
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--ink-muted)" }}
              />
              <input
                id="password"
                type="password"
                autoFocus
                // The "webauthn" token is what makes the browser list passkeys
                // in this field's autofill popup, and the library refuses to
                // start a conditional request without it. It is added only
                // where conditional UI actually exists: a browser that does
                // not know the token may ignore the whole attribute, which
                // would cost ordinary password autofill for no benefit.
                autoComplete={canAutofillPasskey ? "current-password webauthn" : "current-password"}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                className="input pl-9"
                placeholder="Enter password"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm" style={{ color: "var(--critical)" }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading || !password} className="btn btn-primary w-full disabled:opacity-50">
            {loading ? "Signing in…" : "Sign in"}
          </button>

          {canUsePasskey && (
            <>
              <div className="flex items-center gap-3" aria-hidden="true">
                <div className="h-px flex-1" style={{ background: "var(--border)" }} />
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  or
                </span>
                <div className="h-px flex-1" style={{ background: "var(--border)" }} />
              </div>
              <button
                type="button"
                onClick={handlePasskey}
                disabled={passkeyLoading}
                className="btn btn-ghost w-full disabled:opacity-50"
              >
                <Fingerprint size={15} />
                {passkeyLoading ? "Waiting for device…" : "Sign in with a passkey"}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
