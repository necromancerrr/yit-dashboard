import type { ApplicationStatus } from "@/lib/types";

/**
 * Pure pipeline vocabulary and transition rules — no database, no server-only
 * imports, so the Career UI can share exactly the same definitions the API
 * enforces. Anything that touches the database lives in src/lib/career.ts.
 */

/**
 * The recruiting pipeline, in order.
 *
 * The index is meaningful: it is what lets the system tell forward progress
 * from a regression. "Applied" arriving after "Technical" is not news, it is a
 * stale recruiter reminder landing out of order, and the system must not walk
 * the application backwards because an old email showed up late.
 */
export const PIPELINE: ApplicationStatus[] = [
  "Applied",
  "OA",
  "Phone Screen",
  "Technical",
  "Onsite",
  "Offer",
];

/**
 * Ends of the road. A terminal status is never left by inference — only you
 * can reopen a rejected application, because "we're moving forward" arriving
 * after a rejection is far more likely a mis-parse than a real reversal.
 */
export const TERMINAL: ApplicationStatus[] = ["Rejected", "Withdrawn"];

export const ALL_STATUSES: ApplicationStatus[] = [...PIPELINE, ...TERMINAL];

export const STATUS_COLOR: Record<string, string> = {
  Applied: "var(--ink-muted)",
  OA: "var(--cat-school)",
  "Phone Screen": "var(--cat-leetcode)",
  Technical: "var(--cat-leetcode)",
  Onsite: "var(--warning)",
  Offer: "var(--good)",
  Rejected: "var(--critical)",
  Withdrawn: "var(--ink-muted)",
};

export function isTerminal(status: string): boolean {
  return TERMINAL.includes(status as ApplicationStatus);
}

/** Position in the pipeline, or -1 for terminal/unknown statuses. */
export function pipelineRank(status: string): number {
  return PIPELINE.indexOf(status as ApplicationStatus);
}

export interface TransitionDecision {
  accepted: boolean;
  reason: string;
}

/**
 * Decide whether an *inferred* status change should be applied.
 *
 * This is only consulted for non-manual sources. Anything you do by hand is
 * applied unconditionally: user edits always win over inference, including
 * edits that move an application backwards or reopen a closed one.
 */
export function evaluateTransition(
  current: string,
  proposed: string,
  opts: { statusLocked: boolean; source: string }
): TransitionDecision {
  if (opts.source === "manual") {
    return { accepted: true, reason: "Manual edit" };
  }
  if (opts.statusLocked) {
    return { accepted: false, reason: "Status was set by hand; inference cannot override it" };
  }
  if (current === proposed) {
    return { accepted: false, reason: "Already in that status" };
  }
  if (isTerminal(current)) {
    return { accepted: false, reason: `Application is ${current.toLowerCase()}; reopen it yourself` };
  }
  if (isTerminal(proposed)) {
    return { accepted: true, reason: "Closing the application" };
  }
  if (pipelineRank(proposed) < pipelineRank(current)) {
    return { accepted: false, reason: "Would move the application backwards" };
  }
  return { accepted: true, reason: "Advances the pipeline" };
}
