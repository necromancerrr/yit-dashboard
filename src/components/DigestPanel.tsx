"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Undo2, Sparkles } from "lucide-react";
import { fetcher, apiPost } from "@/lib/fetcher";
import type { Digest, DigestAction } from "@/lib/autonomy/digest-types";

/**
 * "Here is what I did" — the half of the Inbox that is not a question.
 *
 * The queue is what the owner was complaining about, so this replaces the
 * *interaction* rather than a threshold: a list of what already happened, each
 * line saying why it was allowed, with an undo. Reading it is optional and
 * nothing is blocked on it — that is the entire difference between this and a
 * queue.
 *
 * Undo here is durable. A receipt auto-applied in March is still undoable in
 * June, because the journal is permanent and the moment you notice a wrong row
 * is not something the app gets to schedule.
 */

const DOMAIN_COLOR: Record<string, string> = {
  money: "var(--cat-finance)",
  school: "var(--cat-school)",
  career: "var(--cat-interviews)",
};

function Row({ action, onChange }: { action: DigestAction; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>(`/api/digest/${action.id}/undo`, {});
      setOutcome(res.message);
      onChange();
    } catch (err) {
      setOutcome(err instanceof Error ? err.message : "Could not undo that");
    } finally {
      setBusy(false);
    }
  }

  const undone = action.undoneAt !== null;

  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p
          className="text-sm font-medium truncate"
          style={{ textDecoration: undone ? "line-through" : undefined }}
        >
          {action.summary}
        </p>
        {/* Why it was allowed to happen without asking. Shown always, not
            behind a disclosure: autonomy you cannot interrogate is the thing
            that stops being trusted. */}
        <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
          {outcome ?? action.because}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className="badge"
          style={{ color: DOMAIN_COLOR[action.domain] ?? "var(--ink-muted)" }}
        >
          {action.domain}
        </span>
        {!undone && (
          <button
            onClick={undo}
            disabled={busy}
            className="icon-btn"
            aria-label={`Undo ${action.summary}`}
            title="Undo"
          >
            <Undo2 size={14} />
          </button>
        )}
      </div>
    </li>
  );
}

export function DigestPanel() {
  const { data, mutate } = useSWR<Digest>("/api/digest", fetcher);
  const actions = data?.actions ?? [];

  // Nothing has ever been done automatically: no panel, no explanation of a
  // feature that has not happened yet.
  if (actions.length === 0) return null;

  async function acknowledge() {
    await apiPost("/api/digest", {});
    mutate();
  }

  return (
    <div className="card mb-4">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Sparkles size={14} style={{ color: "var(--accent)" }} />
          <h2 className="text-sm font-semibold">Done for you</h2>
          {(data?.unreviewed ?? 0) > 0 && (
            <span className="badge">{data?.unreviewed} new</span>
          )}
        </div>
        {(data?.unreviewed ?? 0) > 0 && (
          <button className="btn btn-ghost text-xs" onClick={acknowledge}>
            <Check size={13} /> Looks right
          </button>
        )}
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {actions.slice(0, 20).map((action) => (
          <Row key={action.id} action={action} onChange={() => mutate()} />
        ))}
      </ul>
    </div>
  );
}
