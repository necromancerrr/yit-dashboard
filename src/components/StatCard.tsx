import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = "var(--accent)",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  accent?: string;
}) {
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)` }}
        >
          <Icon size={14} color={accent} />
        </div>
      </div>
      <div>
        <div className="text-2xl font-semibold tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
          {value}
        </div>
        {sub && (
          <div className="text-xs mt-0.5" style={{ color: "var(--ink-muted)" }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
