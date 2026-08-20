"use client";

import { useState } from "react";
import useSWR from "swr";
import { startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Plus, Trash2, ShieldCheck } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { parseISODate } from "@/lib/date";
import { useWebAuthnSupport } from "@/lib/useWebAuthnSupport";
import type { Passkey } from "@/lib/types";

export default function SecurityPage() {
  const { data, isLoading, mutate } = useSWR<{ items: Passkey[] }>("/api/auth/passkey", fetcher);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUsePasskey = useWebAuthnSupport();

  const allItems = data?.items ?? [];
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/auth/passkey/${item.id}`,
    label: (item) => item.label,
    onCommitted: () => mutate(),
  });

  async function addDevice() {
    setAdding(true);
    setError(null);
    try {
      const optionsRes = await fetch("/api/auth/passkey/register/options", { method: "POST" });
      const optionsJSON = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(optionsJSON.error ?? "Could not start registration");

      const attestation = await startRegistration({ optionsJSON });

      const verifyRes = await fetch("/api/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error ?? "Could not register that device");

      mutate();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      setError(/abort|cancel|NotAllowed/i.test(message) ? null : message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Security"
        subtitle="Sign in with Face ID, Touch ID, or a fingerprint instead of your password"
        action={
          canUsePasskey ? (
            <button className="btn btn-primary" onClick={addDevice} disabled={adding}>
              <Plus size={15} /> {adding ? "Waiting for device…" : "Add this device"}
            </button>
          ) : undefined
        }
      />

      {!canUsePasskey && (
        <div className="card p-4 mb-4 text-sm" style={{ color: "var(--ink-secondary)" }}>
          This browser doesn&apos;t support passkeys. They also require a secure (HTTPS)
          connection — on a plain local IP the browser will refuse to offer them.
        </div>
      )}

      {error && (
        <div className="card p-4 mb-4 text-sm" style={{ color: "var(--critical)" }}>
          {error}
        </div>
      )}

      <div className="card mb-4">
        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={Fingerprint}
            title="No passkeys yet"
            sub="Add this device to sign in with your face or fingerprint next time."
          />
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((key) => (
              <li key={key.id} className="flex items-center justify-between gap-3 px-4 py-3 group">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}
                  >
                    <Fingerprint size={15} color="var(--accent)" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.label}</p>
                    <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      Added {key.created_at.slice(0, 10)}
                      {key.last_used_at
                        ? ` · last used ${parseISODate(key.last_used_at).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}`
                        : " · never used"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => requestDelete(key)}
                  className="icon-btn opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                  aria-label={`Remove ${key.label}`}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4 flex gap-3">
        <ShieldCheck size={16} style={{ color: "var(--good)" }} className="shrink-0 mt-0.5" />
        <div className="text-xs leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          <p className="mb-1.5">
            Your fingerprint and face never leave your device. Only a public key is stored here —
            it can verify a signature, but can never create one.
          </p>
          <p>
            Your password still works, and is the way back in if you lose every device above. Keep
            it somewhere safe rather than removing it.
          </p>
        </div>
      </div>
    </div>
  );
}
