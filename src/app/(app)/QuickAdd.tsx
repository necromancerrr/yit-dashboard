"use client";

import { useMemo, useState } from "react";
import { useSWRConfig } from "swr";
import { GraduationCap, Wallet, CornerDownLeft } from "lucide-react";
import { apiDelete, apiPost } from "@/lib/fetcher";
import { useToast } from "@/components/ToastProvider";
import { todayISO } from "@/lib/date";
import { parseQuickAdd } from "@/lib/quick-add";

/**
 * One box on Today that files a typed line where it belongs.
 *
 * The reading is done by `parseQuickAdd`, which shares its date and amount
 * readers with email ingestion — so this box understands `coffee $4.50` for
 * exactly the reasons the inbox understands a receipt, and neither can drift
 * from the other.
 *
 * It *proposes*. What you type is previewed as the row it would become, and
 * nothing is written until you confirm — the same contract the Inbox has, for
 * the same reason: a parser that files rows the moment it thinks it recognised
 * something is a parser you stop trusting.
 *
 * The preview is derived during render rather than mirrored into state. There
 * is no effect here to keep in sync, and nothing to go stale between the
 * keystroke and the paint.
 */

const PLACEHOLDER = "coffee $4.50  ·  CSE143 pset due 4/2";

export function QuickAdd() {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutate } = useSWRConfig();
  const { notify } = useToast();

  const today = todayISO();
  const proposal = useMemo(() => parseQuickAdd(text, today), [text, today]);

  async function save() {
    if (!proposal || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { url, body, label } =
        proposal.domain === "school"
          ? {
              url: "/api/school",
              label: "School",
              body: {
                course: proposal.school!.course,
                title: proposal.school!.title,
                due_date: proposal.school!.dueDate,
                status: "Pending",
              },
            }
          : {
              url: "/api/finance",
              label: "Money",
              body: {
                date: proposal.money!.date,
                type: proposal.money!.type,
                category: proposal.money!.category,
                amount: proposal.money!.amount,
                note: proposal.money!.note,
              },
            };

      const { item } = await apiPost<{ item: { id: number } }>(url, body);
      setText("");
      await mutate("/api/today");
      notify({
        message: `Added to ${label}`,
        actionLabel: "Undo",
        onAction: () => {
          void apiDelete(`${url}/${item.id}`).then(() => mutate("/api/today"));
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  const typed = text.trim().length > 0;

  return (
    <div className="card p-3 mb-4">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
          aria-label="Quick add — type an expense or a school deadline"
          aria-describedby="quick-add-preview"
        />
        <button
          type="submit"
          className="btn btn-primary shrink-0"
          disabled={!proposal || saving}
          style={{ opacity: proposal && !saving ? 1 : 0.5 }}
        >
          <CornerDownLeft size={13} />
          {saving ? "Adding…" : "Add"}
        </button>
      </form>

      {/* Rendered only once something has been typed, so the empty box stays a
          box and the server never renders a preview of nothing. */}
      {typed && (
        <div id="quick-add-preview" className="mt-2.5" aria-live="polite">
          {proposal?.domain === "school" && proposal.school && (
            <Preview
              icon={<GraduationCap size={13} color="var(--cat-school)" />}
              color="var(--cat-school)"
              title={`${proposal.school.course} — ${proposal.school.title}`}
              detail={
                proposal.school.dueDate
                  ? `Due ${proposal.school.dueDate}`
                  : "No due date — a date has to be written out to be read"
              }
            />
          )}
          {proposal?.domain === "money" && proposal.money && (
            <Preview
              icon={<Wallet size={13} color="var(--cat-finance)" />}
              color="var(--cat-finance)"
              title={`${proposal.money.category} — $${proposal.money.amount.toFixed(2)}`}
              detail={`${proposal.money.type === "income" ? "Income" : "Expense"} on ${proposal.money.date}`}
            />
          )}
          {!proposal && (
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Not recognised. An expense needs a $ amount; a school task needs a
              course code or a word like &ldquo;pset&rdquo;.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs mt-2" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

function Preview({
  icon,
  color,
  title,
  detail,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm truncate">{title}</span>
        <span className="block text-xs truncate" style={{ color: "var(--ink-muted)" }}>
          {detail}
        </span>
      </span>
    </div>
  );
}
