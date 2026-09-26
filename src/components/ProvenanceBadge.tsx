import { Bot, Mail, Tag } from "lucide-react";

/**
 * A row an automation created, marked as such.
 *
 * An automated write that is visually identical to one you made is the failure
 * that costs the most trust: you find a transaction you do not remember, cannot
 * tell whether you forgot it or the machine invented it, and stop believing the
 * ledger either way. One icon makes that question answerable at a glance.
 *
 * Hand-typed rows ('manual'/null) render nothing, so they stay visually clean.
 */
export function ProvenanceBadge({ source }: { source?: string | null }) {
  if (!source || source === "manual") return null;

  const meta =
    source === "gmail"
      ? {
          icon: <Mail size={10} aria-hidden />,
          label: "email",
          title: "Added automatically from your email — undo it from the Inbox",
        }
      : source === "Muse"
        ? {
            icon: <Bot size={10} aria-hidden />,
            label: "Muse",
            title: "Logged by Muse from a conversation",
          }
        : {
            icon: <Tag size={10} aria-hidden />,
            label: source,
            title: `Added automatically (${source})`,
          };

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none shrink-0"
      style={{
        background: "color-mix(in srgb, var(--accent) 14%, transparent)",
        color: "var(--accent)",
      }}
      title={meta.title}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}
