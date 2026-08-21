import type { BriefingFact } from "@/lib/ai/types";
import type { TodayItem } from "@/lib/types";

export interface BriefingInboxItem {
  title: string;
  detail: string | null;
  severity: string;
}

export interface BriefingStatusCount {
  status: string;
  count: number;
}

interface TodayBriefingSnapshot {
  date: string;
  priorities: TodayItem[];
  inboxOpenCount: number;
  inboxItems: BriefingInboxItem[];
  careerStatuses: BriefingStatusCount[];
  schoolOpenCount: number;
  checklistDone: number;
  checklistTotal: number;
  gymStreak: number;
  monthNet: number;
  cryptoValue: number;
}

function dollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Build the bounded, factual dashboard snapshot an AI may summarize. */
export function buildTodayBriefingFacts(snapshot: TodayBriefingSnapshot): BriefingFact[] {
  const facts: BriefingFact[] = [
    { title: `Dashboard date: ${snapshot.date}`, detail: null },
  ];

  for (const item of snapshot.priorities.slice(0, 6)) {
    facts.push({ title: `Priority: ${item.title}`, detail: item.detail });
  }

  facts.push({
    title:
      `Inbox: ${snapshot.inboxOpenCount} open item` +
      (snapshot.inboxOpenCount === 1 ? "" : "s"),
    detail:
      snapshot.inboxOpenCount > 0
        ? "These require confirmation, dismissal, or follow-up."
        : "Nothing is waiting for review.",
  });
  for (const item of snapshot.inboxItems.slice(0, 6)) {
    facts.push({
      title: `Inbox ${item.severity}: ${item.title}`,
      detail: item.detail,
    });
  }

  facts.push({
    title:
      `Career applications: ` +
      snapshot.careerStatuses.reduce((sum, row) => sum + row.count, 0),
    detail:
      snapshot.careerStatuses.map((row) => `${row.status}: ${row.count}`).join(", ") ||
      "No applications recorded.",
  });
  facts.push({
    title:
      `School: ${snapshot.schoolOpenCount} open task` +
      (snapshot.schoolOpenCount === 1 ? "" : "s"),
    detail: null,
  });
  facts.push({
    title: `Habits: ${snapshot.checklistDone} of ${snapshot.checklistTotal} done today`,
    detail: null,
  });
  facts.push({ title: `Gym streak: ${snapshot.gymStreak} days`, detail: null });
  facts.push({ title: `Month net: ${dollars(snapshot.monthNet)}`, detail: null });
  facts.push({ title: `Crypto snapshot: ${dollars(snapshot.cryptoValue)}`, detail: null });

  return facts;
}
