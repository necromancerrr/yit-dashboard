import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
        style={{
          background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          border: "1px solid var(--border)",
        }}
      >
        <Icon size={22} color="var(--accent)" />
      </div>
      <p className="font-display text-lg font-semibold tracking-tight">{title}</p>
      {sub && (
        <p className="text-sm mt-1.5 max-w-xs leading-relaxed" style={{ color: "var(--ink-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
