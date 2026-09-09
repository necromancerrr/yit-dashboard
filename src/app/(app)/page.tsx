"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import {
  GraduationCap,
  Briefcase,
  CheckSquare,
  Flame,
  Inbox as InboxIcon,
  ArrowRight,
  Check,
} from "lucide-react";
import { fetcher, apiPatch } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { getDisplayName } from "@/lib/identity";
import { parseISODate } from "@/lib/date";
import type { TodayData, TodayItem } from "@/lib/types";
import { QuickAdd } from "./QuickAdd";
import { SetupNotice } from "@/components/SetupNotice";
import { DigestLine } from "@/components/DigestLine";

/**
 * Today — the primary Yit OS screen.
 *
 * The ordering is attention → action → context, and deliberately not
 * analytics: a ranked list of what is due, then a thin strip of context, and
 * nothing else. The heatmap and the stat grid moved off this page because
 * neither answers "what should I do now", which is the only question this
 * screen exists to answer.
 */

const KIND_ICON = {
  school: GraduationCap,
  career: Briefcase,
  checklist: CheckSquare,
  money: CheckSquare,
  habit: Flame,
} as const;

const KIND_COLOR = {
  school: "var(--cat-school)",
  career: "var(--cat-interviews)",
  checklist: "var(--cat-checklist)",
  money: "var(--cat-finance)",
  habit: "var(--cat-gym)",
} as const;

/**
 * The greeting follows the *reader's* clock rather than APP_TIMEZONE, and that
 * is not an oversight: "good evening" is about the person, while the date
 * below it is about the data.
 */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function currency(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * A habit is the one thing on this page you can *finish* from this page.
 *
 * Sending you to /checklist to tick a box you are already looking at is the
 * single most repeated piece of friction in the app — it happens every day,
 * for every habit. So the row carries its own checkbox, and the rank number is
 * replaced by it: a row you can act on should not also be numbered as
 * something to get to later.
 *
 * The tick is optimistic and then reconciled. `/api/today` re-ranks on every
 * response, so waiting for the round trip means the row sits there looking
 * unticked for as long as the network takes — on a phone, long enough to tap
 * it twice.
 */
function HabitCheck({ item, onDone }: { item: TodayItem; onDone: () => void }) {
  const [ticked, setTicked] = useState(false);
  const [failed, setFailed] = useState(false);

  async function tick(e: React.MouseEvent) {
    // The row is a link; ticking it must not also navigate away from the page
    // you just acted on.
    e.preventDefault();
    e.stopPropagation();
    if (ticked) return;
    setTicked(true);
    setFailed(false);
    try {
      await apiPatch(`/api/checklist/${item.checklistItemId}`, { done: true });
      // A beat before the list re-ranks, so the tick is actually seen. Without
      // it the row vanishes the instant you touch it, which reads as "did that
      // register?" rather than as completion.
      setTimeout(onDone, 450);
    } catch {
      // Put the box back rather than leaving a tick that was never saved —
      // a habit you believe is done and is not is worse than one you know is
      // outstanding.
      setTicked(false);
      setFailed(true);
    }
  }

  return (
    <button
      onClick={tick}
      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors"
      style={{
        borderColor: failed ? "var(--critical)" : ticked ? "var(--good)" : "var(--border)",
        background: ticked ? "color-mix(in srgb, var(--good) 20%, transparent)" : "transparent",
      }}
      aria-label={failed ? `Could not complete ${item.title} — try again` : `Mark ${item.title} done`}
      title={failed ? "That did not save. Try again." : undefined}
    >
      <Check size={14} color={ticked ? "var(--good)" : "var(--ink-muted)"} />
    </button>
  );
}

function PriorityRow({
  item,
  index,
  today,
  onHabitDone,
}: {
  item: TodayItem;
  index: number;
  today: string | undefined;
  onHabitDone: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  // Overdue is derived from the two dates already on screen rather than a new
  // field — the route's day and the row's due date. A row that is late should
  // not need the server to remember to say so.
  const overdue = !!today && !!item.dueDate && item.dueDate < today;
  const color = overdue ? "var(--critical)" : KIND_COLOR[item.kind];
  // The id, not the kind: a row without one can never be given a checkbox by
  // accident.
  const tickable = item.checklistItemId !== undefined;
  return (
    <li>
      <Link href={item.href} className="flex items-center gap-3 px-4 py-3 group">
        {tickable ? (
          <HabitCheck item={item} onDone={onHabitDone} />
        ) : (
          <span
            className="text-xs w-4 shrink-0 tabular-nums"
            style={{ color: "var(--ink-muted)" }}
            aria-hidden
          >
            {index + 1}
          </span>
        )}
        {!tickable && (
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
          >
            <Icon size={14} color={color} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{item.title}</span>
          {item.detail && (
            <span className="block text-xs truncate" style={{ color: "var(--ink-muted)" }}>
              {item.detail}
            </span>
          )}
        </span>
        <ArrowRight
          size={14}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          color="var(--ink-muted)"
        />
      </Link>
    </li>
  );
}

export default function TodayPage() {
  const { data, isLoading, mutate } = useSWR<TodayData>("/api/today", fetcher, {
    refreshInterval: 60_000,
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${getDisplayName()}`}
        // The server's day, not the browser's. Every date on this page —
        // what counts as due today, when the checklist rolled over — is
        // resolved against APP_TIMEZONE, and a heading that disagrees with the
        // list underneath it is the app calling itself a liar.
        subtitle={
          data
            ? parseISODate(data.date).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : "\u00a0"
        }
      />

      {/* Capture, before attention: the cheapest moment to record something is
          the moment you thought of it, and it belongs on the screen you are
          already looking at. */}
      <SetupNotice />
      {/* One line, not a badge and not a modal. The whole point of autonomy is
          to stop demanding attention, so this must be ignorable for a week
          without anything degrading. */}
      <DigestLine />
      <QuickAdd />

      {/* Attention */}
      <div className="card mb-4">
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <h2 className="text-sm font-semibold">What matters today</h2>
          {(data?.inboxOpenCount ?? 0) > 0 && (
            <Link
              href="/inbox"
              className="flex items-center gap-1.5 text-xs"
              style={{ color: "var(--accent)" }}
            >
              <InboxIcon size={13} />
              {data?.inboxOpenCount} in inbox
            </Link>
          )}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm" style={{ color: "var(--ink-muted)" }}>
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm">Nothing is due.</p>
            <p className="text-xs mt-1" style={{ color: "var(--ink-muted)" }}>
              No deadlines in the next week and today&apos;s habits are done.
            </p>
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {items.map((item, i) => (
              <PriorityRow
                key={item.id}
                item={item}
                index={i}
                today={data?.date}
                onHabitDone={() => mutate()}
              />
            ))}
          </ul>
        )}
      </div>

      {/* The briefing is only rendered when a provider actually produced one.
          No placeholder, no "AI unavailable" chrome — the page is complete
          without it. */}
      {data?.briefing && (
        <div className="card p-4 mb-4">
          <p className="label mb-1.5">Suggested focus</p>
          <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
            {data.briefing}
          </p>
        </div>
      )}

      {/* Context — one quiet strip, not a wall of cards. */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/health" className="card p-4">
          <p className="label mb-1">Gym streak</p>
          <p className="text-lg font-semibold">{isLoading ? "–" : `${data?.gymStreak ?? 0}d`}</p>
        </Link>
        <Link href="/checklist" className="card p-4">
          <p className="label mb-1">Habits</p>
          <p className="text-lg font-semibold">
            {isLoading
              ? "–"
              : `${data?.checklistDoneToday ?? 0}/${data?.checklistTotalToday ?? 0}`}
          </p>
        </Link>
        <Link href="/money" className="card p-4">
          <p className="label mb-1">This month</p>
          <p className="text-lg font-semibold">{isLoading ? "–" : currency(data?.monthNet ?? 0)}</p>
        </Link>
      </div>
    </div>
  );
}
