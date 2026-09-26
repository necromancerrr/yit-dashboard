"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";
import { CheckCircle2, AlertTriangle, CircleDashed, RefreshCw, Sun, Moon, Monitor, Type } from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import {
  getThemeChoice,
  setThemeChoice,
  getTextSize,
  setTextSize,
  subscribeTheme,
  type ThemeChoice,
  type TextSize,
} from "@/lib/theme";
import type { SetupStatus, CheckLevel } from "@/lib/setup-status";

const LEVELS: Record<CheckLevel, { icon: typeof CheckCircle2; color: string; label: string }> = {
  ok: { icon: CheckCircle2, color: "var(--good)", label: "Working" },
  warn: { icon: AlertTriangle, color: "var(--warning)", label: "Needs attention" },
  off: { icon: CircleDashed, color: "var(--ink-muted)", label: "Off" },
};

const THEME_OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
];

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string; icon?: typeof Sun }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-xl p-1 gap-0.5"
      style={{ background: "var(--surface-raised)" }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors min-h-[2.5rem]"
            style={{
              background: active ? "var(--surface)" : "transparent",
              color: active ? "var(--ink-primary)" : "var(--ink-muted)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.2)" : "none",
            }}
          >
            {Icon ? <Icon size={13} aria-hidden /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function AppearanceSection() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeChoice, () => "system" as ThemeChoice);
  const textSize = useSyncExternalStore(subscribeTheme, getTextSize, () => "normal" as TextSize);
  return (
    <div className="card mb-4 p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Type size={14} aria-hidden /> Appearance
      </h2>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium">Theme</p>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              System follows your phone or computer.
            </p>
          </div>
          <Segmented options={THEME_OPTIONS} value={theme} onChange={setThemeChoice} ariaLabel="Theme" />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium">Text size</p>
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Scales type and spacing across the whole app.
            </p>
          </div>
          <Segmented options={TEXT_SIZE_OPTIONS} value={textSize} onChange={setTextSize} ariaLabel="Text size" />
        </div>
      </div>
    </div>
  );
}

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

      <AppearanceSection />

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
