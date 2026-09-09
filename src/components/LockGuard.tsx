"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Lock, Fingerprint } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getBrandName } from "@/lib/identity";
import { useWebAuthnSupport } from "@/lib/useWebAuthnSupport";
import { passkeyErrorMessage } from "@/lib/passkey-errors";

/**
 * Hides the dashboard when you leave it, and asks for you back.
 *
 * Be clear about what this is: a **privacy screen**, not a cryptographic
 * boundary. It stops the person who picks up your unlocked phone, or reads
 * over your shoulder in the app switcher. It does not stop someone with
 * developer tools — the session cookie is still valid while locked, because
 * killing it would mean a bug here could lock you out of your own data.
 *
 * That tradeoff is deliberate. Unlocking still costs a real server round trip
 * (a passkey signature, or a password check), so the lock is not pure theatre;
 * it just is not the thing standing between an attacker and the API.
 */

/**
 * How long the app may sit in the background before locking.
 *
 * Not zero: on a phone, glancing at a notification or pasting from another app
 * backgrounds this one constantly, and a lock screen every time would train
 * you to turn the feature off. Thirty seconds covers a real context switch
 * without punishing a two-second one.
 */
const LOCK_AFTER_MS = 30_000;

/** Survives a reload, so refreshing the page is not a way around the lock. */
const LOCK_KEY = "dash_locked_at";

/**
 * sessionStorage is the single source of truth for "am I locked", rather than
 * React state that has to be kept in sync with it.
 *
 * That makes the reload case fall out for free, and avoids the trap of setting
 * state from an effect on mount: the value lives outside React and does not
 * exist during server rendering, which is exactly what useSyncExternalStore
 * is for. The server snapshot is `false`, so the markup matches and the client
 * corrects itself on hydration.
 */
const listeners = new Set<() => void>();

function readStoredLock(): boolean {
  try {
    return sessionStorage.getItem(LOCK_KEY) !== null;
  } catch {
    // Private mode and blocked site data both throw; an unusable store just
    // means the lock does not survive reloads, never that the app breaks.
    return false;
  }
}

function writeStoredLock(locked: boolean) {
  try {
    if (locked) sessionStorage.setItem(LOCK_KEY, String(Date.now()));
    else sessionStorage.removeItem(LOCK_KEY);
  } catch {
    /* ignore — see readStoredLock */
  }
  for (const notify of listeners) notify();
}

function subscribeToLock(onChange: () => void): () => void {
  listeners.add(onChange);
  // A lock in one tab should lock the others too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function LockGuard({ children }: { children: React.ReactNode }) {
  const locked = useSyncExternalStore(subscribeToLock, readStoredLock, () => false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hiddenSince = useRef<number | null>(null);
  const canUsePasskey = useWebAuthnSupport();

  const lock = useCallback(() => writeStoredLock(true), []);

  const unlock = useCallback(() => {
    setPassword("");
    setError(null);
    writeStoredLock(false);
  }, []);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenSince.current = Date.now();
        return;
      }
      const since = hiddenSince.current;
      hiddenSince.current = null;
      if (since !== null && Date.now() - since >= LOCK_AFTER_MS) lock();
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [lock]);

  async function unlockWithPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/passkey/login/options", { method: "POST" });
      const optionsJSON = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(optionsJSON.error ?? "Could not start passkey unlock");

      const assertion = await startAuthentication({ optionsJSON });

      const verifyRes = await fetch("/api/auth/passkey/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error ?? "Could not verify that device");

      unlock();
    } catch (err) {
      setError(passkeyErrorMessage(err, "login"));
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      unlock();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Kept mounted rather than unmounted, so unlocking returns you to the
          page you were on with its scroll position and open forms intact. */}
      <div aria-hidden={locked} inert={locked || undefined}>
        {children}
      </div>

      {locked && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Locked"
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: "var(--page)" }}
        >
          <div className="w-full max-w-sm animate-fade-in">
            <div className="flex flex-col items-center mb-8">
              <div className="mb-4">
                <Logo size="lg" />
              </div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Lock size={16} style={{ color: "var(--ink-muted)" }} />
                {getBrandName()}
              </h1>
              <p className="text-sm mt-1" style={{ color: "var(--ink-muted)" }}>
                Locked while you were away
              </p>
            </div>

            <form onSubmit={unlockWithPassword} className="card p-5 flex flex-col gap-4">
              {canUsePasskey && (
                <button
                  type="button"
                  onClick={unlockWithPasskey}
                  disabled={busy}
                  className="btn btn-primary w-full disabled:opacity-50"
                >
                  <Fingerprint size={15} />
                  {busy ? "Waiting for device…" : "Unlock with Face ID"}
                </button>
              )}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="unlock-password" className="label">
                  Password
                </label>
                <input
                  id="unlock-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="input"
                  placeholder="Enter password"
                />
              </div>

              {error && (
                <p className="text-sm" style={{ color: "var(--critical)" }}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || !password}
                className="btn btn-ghost w-full disabled:opacity-50"
              >
                Unlock
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
