"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { Lock, Fingerprint } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getBrandName } from "@/lib/identity";
import { useWebAuthnSupport } from "@/lib/useWebAuthnSupport";

// `next` comes straight from the query string, so only ever follow it when it
// is a path on this site — "//evil.com" and absolute URLs are not.
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const canUsePasskey = useWebAuthnSupport();

  async function handlePasskey() {
    setPasskeyLoading(true);
    setError(null);
    try {
      // Step 1: ask the server for a fresh challenge.
      const optionsRes = await fetch("/api/auth/passkey/login/options", { method: "POST" });
      const optionsJSON = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(optionsJSON.error ?? "Could not start passkey sign-in");

      // Step 2: the device prompts for Face ID / fingerprint and signs it.
      const assertion = await startAuthentication({ optionsJSON });

      // Step 3: the server checks the signature and issues the session cookie.
      const verifyRes = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Could not verify that device");

      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch (err) {
      // Cancelling the system prompt throws too — that's not an error worth shouting about.
      const message = err instanceof Error ? err.message : "Passkey sign-in failed";
      setError(/abort|cancel|NotAllowed/i.test(message) ? null : message);
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
      router.replace(safeNext(params.get("next")));
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
