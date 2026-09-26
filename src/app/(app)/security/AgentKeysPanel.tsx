"use client";

import { useState } from "react";
import useSWR from "swr";
import { KeyRound, Plus, Trash2, Copy, Check } from "lucide-react";
import { fetcher, apiPost } from "@/lib/fetcher";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { parseISODate } from "@/lib/date";
import type { ApiKey } from "@/lib/types";

/**
 * Machine credentials for the agent API (/api/agent/*) — this is what lets
 * Muse log to the dashboard from a conversation. The raw key is shown exactly
 * once, at creation; afterwards only metadata is visible, because the server
 * stores a hash, not the key.
 */
export function AgentKeysPanel() {
  const { data, isLoading, mutate } = useSWR<{ items: ApiKey[] }>("/api/auth/agent-keys", fetcher);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The just-created raw key. Lives in memory only — never refetched, and
  // closing the dialog drops it for good.
  const [freshKey, setFreshKey] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const allItems = data?.items ?? [];
  const { visibleItems: items, requestDelete } = useUndoableDelete(allItems, {
    deleteUrl: (item) => `/api/auth/agent-keys/${item.id}`,
    label: (item) => item.name,
    onCommitted: () => mutate(),
  });

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await apiPost<{ item: ApiKey; key: string }>("/api/auth/agent-keys", {
        name: trimmed,
      });
      setFreshKey({ name: res.item.name, key: res.key });
      setName("");
      mutate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  }

  async function copyKey() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable on insecure origins; the key is still
      // visible for manual copying.
    }
  }

  function lastUsedLabel(key: ApiKey): string {
    if (!key.last_used_at) return "never used";
    return `last used ${parseISODate(key.last_used_at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`;
  }

  return (
    <div className="card mb-4">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <KeyRound size={15} style={{ color: "var(--accent)" }} />
          Agent API keys
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
          Keys for Muse to update the dashboard from conversation — LeetCode solves, workouts,
          anything you mention. Each key is shown once; revoke any key the moment you stop trusting it.
        </p>
      </div>

      <div className="px-4 pb-3">
        <form onSubmit={createKey} className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="Key name, e.g. Muse"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            aria-label="New key name"
          />
          <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
            <Plus size={15} /> {creating ? "Creating…" : "Create key"}
          </button>
        </form>
        {error && (
          <p className="text-xs mt-2" style={{ color: "var(--critical)" }}>
            {error}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Loading…
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No agent keys"
          sub="Create one above, hand it to Muse once, and the dashboard starts keeping up with your conversations."
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
                  <KeyRound size={15} color="var(--accent)" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{key.name}</p>
                  <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    Added {key.created_at.slice(0, 10)} · {lastUsedLabel(key)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => requestDelete(key)}
                className="icon-btn opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                aria-label={`Revoke ${key.name}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The key is shown once. Closing this drops it — the server never
          stored the raw value, so there is no "show again". */}
      <Modal open={freshKey !== null} onClose={() => setFreshKey(null)} title="Key created">
        <p className="text-sm mb-3" style={{ color: "var(--ink-secondary)" }}>
          Copy <strong>{freshKey?.name}</strong> now — this is the only time it&apos;s shown.
        </p>
        <div className="flex gap-2">
          <code
            className="flex-1 px-3 py-2 rounded-lg text-xs break-all select-all"
            style={{ background: "var(--surface-raised)", color: "var(--ink-primary)" }}
          >
            {freshKey?.key}
          </code>
          <button onClick={copyKey} className="btn" aria-label="Copy key">
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <button onClick={() => setFreshKey(null)} className="btn btn-primary w-full mt-4">
          I&apos;ve saved it
        </button>
      </Modal>
    </div>
  );
}
