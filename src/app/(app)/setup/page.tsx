"use client";

import useSWR from "swr";
import { CheckCircle2, AlertTriangle, CircleDashed, RefreshCw } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import type { SetupStatus, CheckLevel } from "@/lib/setup-status";

const LEVELS: Record<CheckLevel, { icon: typeof CheckCircle2; color: string; label: string }> = {
  ok: { icon: CheckCircle2, color: "var(--good)", label: "Working" },
  warn: { icon: AlertTriangle, color: "var(--warning)", label: "Needs attention" },
  off: { icon: CircleDashed, color: "var(--ink-muted)", label: "Off" },
};

export default function SetupPage() {
  const { data, isLoading, mutate } = useSWR<SetupStatus>("/api/setup", fetcher);

  return (
    <div>
      <PageHeader
        title="Setup"
        subtitle="What's switched on, and what it costs when something isn't"
        action={
          <button className="btn btn-ghost" onClick={() => mutate()} aria-label="Re-check setup">
            <RefreshCw size={15} /> Re-check
          </button>
        }
      />

      {isLoading ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
          Checking…
        </div>
      ) : (
        <>
          <div className="card mb-4">
            <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
              {data?.checks.map((check) => {
                const level = LEVELS[check.level];
                const Icon = level.icon;
                return (
                  <li key={check.id} className="flex gap-3 px-4 py-3.5">
                    <Icon size={16} style={{ color: level.color }} className="shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{check.title}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--ink-secondary)" }}>
                        {check.status}
                      </p>
                      {check.fix && (
                        <p
                          className="text-xs mt-1.5 leading-relaxed p-2.5 rounded-lg"
                          style={{ background: "var(--surface-raised)", color: "var(--ink-muted)" }}
                        >
                          {check.fix}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card p-4 text-xs leading-relaxed" style={{ color: "var(--ink-muted)" }}>
            <p className="mb-1.5">
              These are read from the environment where the app runs — a hosting dashboard, or a
              local <code>.env.local</code>. Changing one there takes effect on the next deploy,
              not immediately.
            </p>
            <p>
              No key or token is ever shown on this page, or sent to your browser. Only whether
              each one is present.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
