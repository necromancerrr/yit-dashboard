"use client";

import { useState } from "react";
import useSWR from "swr";
import { ShieldCheck, ShieldOff, Shield } from "lucide-react";
import { fetcher, apiPatch } from "@/lib/fetcher";
import type { AutomationRuleView, RuleMode } from "@/lib/autonomy/rule-types";

/**
 * Who may act without asking — and how you take that back.
 *
 * The list exists mostly so autonomy is *falsifiable*: you can see which
 * senders have earned something, how much, and what each one is still short of.
 * A system that acts on its own and cannot be interrogated is one you end up
 * switching off wholesale, which is the outcome this whole feature is trying to
 * avoid.
 *
 * Per-sender rather than global for the same reason. "Stop doing this with
 * Amazon" and "stop doing this at all" are different decisions.
 */

const MODES: { id: RuleMode; label: string; hint: string }[] = [
  { id: "ask", label: "Earn it", hint: "Acts once it has enough confirmations" },
  { id: "auto", label: "Always", hint: "Acts now, without waiting" },
  { id: "never", label: "Never", hint: "Never acts, whatever it has earned" },
];

function Row({ rule, onChange }: { rule: AutomationRuleView; onChange: () => void }) {
  const [busy, setBusy] = useState(false);

  async function set(mode: RuleMode) {
    if (busy || mode === rule.mode) return;
    setBusy(true);
    try {
      await apiPatch(`/api/automation/rules/${rule.id}`, { mode });
      onChange();
    } finally {
      setBusy(false);
    }
  }

  const Icon =
    rule.mode === "never" ? ShieldOff : rule.verdict.trusted ? ShieldCheck : Shield;
  const color =
    rule.mode === "never"
      ? "var(--ink-muted)"
      : rule.verdict.trusted
        ? "var(--good)"
        : "var(--ink-muted)";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate flex items-center gap-1.5">
            <Icon size={13} style={{ color }} className="shrink-0" />
            {rule.scopeKey}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            {rule.domain} · {rule.verdict.reason}
          </p>
        </div>
        <div className="flex gap-1 shrink-0" role="group" aria-label={`${rule.scopeKey} setting`}>
          {MODES.map((m) => {
            const active = m.id === rule.mode;
            return (
              <button
                key={m.id}
                onClick={() => set(m.id)}
                disabled={busy}
                aria-pressed={active}
                title={m.hint}
                className="px-2 py-1 rounded-md text-[11px] transition-colors"
                style={{
                  background: active ? "var(--surface-raised)" : "transparent",
                  color: active ? "var(--ink-primary)" : "var(--ink-muted)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </li>
  );
}

export function TrustRules() {
  const { data, mutate } = useSWR<{ items: AutomationRuleView[] }>(
    "/api/automation/rules",
    fetcher
  );
  const [open, setOpen] = useState(false);
  const rules = data?.items ?? [];

  // Nothing has been confirmed from any sender yet, so there is nothing to
  // explain. An empty panel describing a mechanism that has not started is
  // noise on the screen you go to when something needs doing.
  if (rules.length === 0) return null;

  const trusted = rules.filter((r) => r.mode !== "never" && r.verdict.trusted).length;

  return (
    <div className="card mb-4">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold">Who can act without asking</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            {trusted} of {rules.length} sender{rules.length === 1 ? "" : "s"} has earned it
          </p>
        </div>
        <span className="text-xs" style={{ color: "var(--accent)" }}>
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <>
          <ul className="divide-y border-t" style={{ borderColor: "var(--border)" }}>
            {rules.map((rule) => (
              <Row key={rule.id} rule={rule} onChange={() => mutate()} />
            ))}
          </ul>
          <p
            className="text-xs px-4 py-3 border-t leading-relaxed"
            style={{ borderColor: "var(--border)", color: "var(--ink-muted)" }}
          >
            A sender earns this by being right — confirming its proposals — and loses it
            the moment you undo or edit something it filed. Standing lapses if a sender
            goes quiet for months, because a promotion earned under one email template
            should not outlive the template.
          </p>
        </>
      )}
    </div>
  );
}
