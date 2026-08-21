"use client";

import useSWR from "swr";
import Link from "next/link";
import {
  GraduationCap,
  Briefcase,
  CheckSquare,
  Flame,
  Inbox as InboxIcon,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { fetcher } from "@/lib/fetcher";
import { PageHeader } from "@/components/PageHeader";
import { getDisplayName } from "@/lib/identity";
import type { TodayData, TodayItem } from "@/lib/types";

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

function PriorityRow({ item, index }: { item: TodayItem; index: number }) {
  const Icon = KIND_ICON[item.kind];
  const color = KIND_COLOR[item.kind];
  return (
    <li>
      <Link href={item.href} className="flex items-center gap-3 px-4 py-3 group">
        <span
          className="text-xs w-4 shrink-0 tabular-nums"
          style={{ color: "var(--ink-muted)" }}
          aria-hidden
        >
          {index + 1}
        </span>
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `color-mix(in srgb, ${color} 16%, transparent)` }}
        >
          <Icon size={14} color={color} />
        </span>
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
  const { data, isLoading } = useSWR<TodayData>("/api/today", fetcher, {
    refreshInterval: 60_000,
  });
  const { data: briefingData } = useSWR<TodayData>("/api/today?briefing=1", fetcher, {
    refreshInterval: 10 * 60_000,
    dedupingInterval: 5 * 60_000,
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${getDisplayName()}`}
        subtitle={new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      />

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
              <PriorityRow key={item.id} item={item} index={i} />
            ))}
          </ul>
        )}
      </div>

      {/* The briefing is only rendered when a provider actually produced one.
          No placeholder, no "AI unavailable" chrome — the page is complete
          without it. */}
      {briefingData?.briefing && (
        <div className="card p-4 mb-4">
          <p className="label mb-1.5 flex items-center gap-1.5">
            <Sparkles size={12} /> DeepSeek brief
          </p>
          <p className="text-sm" style={{ color: "var(--ink-secondary)" }}>
            {briefingData.briefing}
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
