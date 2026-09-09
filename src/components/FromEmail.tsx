import { Mail } from "lucide-react";

/**
 * A row the sync created, marked as such.
 *
 * An automated write that is visually identical to one you made is the failure
 * that costs the most trust: you find a transaction you do not remember, cannot
 * tell whether you forgot it or the machine invented it, and stop believing the
 * ledger either way. One icon makes that question answerable at a glance.
 */
export function FromEmail({ source }: { source?: string | null }) {
  if (!source) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded shrink-0"
      style={{ background: "var(--surface-raised)", color: "var(--ink-muted)" }}
      title="Added automatically from your email — undo it from the Inbox"
    >
      <Mail size={10} />
      email
    </span>
  );
}
