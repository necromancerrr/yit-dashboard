import type { LucideIcon } from "lucide-react";

export function EmptyState({ icon: Icon, title, sub }: { icon: LucideIcon; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-4">
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
        style={{ background: "var(--surface-raised)" }}
      >
        <Icon size={18} color="var(--ink-muted)" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      {sub && (
        <p className="text-xs mt-1 max-w-xs" style={{ color: "var(--ink-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}
