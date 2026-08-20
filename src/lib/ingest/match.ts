import { normalizeCompany } from "@/lib/ingest/normalize";

/**
 * Deciding which application a message is about.
 *
 * The hard cases are all real: you apply to three roles at Amazon, a recruiter
 * spells the company differently than you did, and a reply lands on a thread
 * that already resolved once. Getting this wrong is worse than not matching at
 * all — attaching an OA to the wrong role corrupts a timeline you trust — so
 * an ambiguous match reports itself as ambiguous rather than picking.
 */

export interface MatchCandidate {
  id: number;
  company: string;
  role: string | null;
  status: string;
  /** Set when a previous message on the same thread already matched here. */
  threadId?: string | null;
}

export interface MatchResult {
  /** The application to attach to, or null when nothing is safe to pick. */
  applicationId: number | null;
  confidence: number;
  reason: string;
  /** True when several applications fit and only you can say which. */
  ambiguous: boolean;
}

/** Tokens that carry no signal when comparing two role titles. */
const ROLE_NOISE = new Set([
  "the", "a", "an", "of", "for", "and", "or", "at", "in", "to",
  "job", "role", "position", "opening", "req", "requisition",
  "2026", "2025", "2027", "summer", "fall", "spring", "winter",
]);

function roleTokens(role: string): Set<string> {
  const expanded = role
    .toLowerCase()
    .replace(/\bsde\b/g, "software engineer")
    .replace(/\bswe\b/g, "software engineer")
    .replace(/\bmle\b/g, "machine learning engineer")
    .replace(/\beng\b/g, "engineer")
    .replace(/\bengineering\b/g, "engineer")
    .replace(/\bintern(ship)?\b/g, "intern")
    .replace(/\bnew grad(uate)?\b/g, "grad");
  return new Set(
    expanded
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 && !ROLE_NOISE.has(t))
  );
}

/** Jaccard overlap of two role titles, 0-1. */
export function roleSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const setA = roleTokens(a);
  const setB = roleTokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** Two company names refer to the same employer. */
export function companiesMatch(a: string, b: string): boolean {
  const left = normalizeCompany(a);
  const right = normalizeCompany(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // One side often arrives as a domain label ("goldmansachs") against a typed
  // name ("Goldman Sachs"), so compare with separators removed too.
  const tight = (s: string) => s.replace(/\s+/g, "");
  if (tight(left) === tight(right)) return true;
  // A prefix match handles "Stripe" vs "Stripe Payments", but only when the
  // shorter side is long enough that the prefix means something.
  const [shorter, longer] = tight(left).length <= tight(right).length
    ? [tight(left), tight(right)]
    : [tight(right), tight(left)];
  return shorter.length >= 5 && longer.startsWith(shorter);
}

/** Role similarity at or above this counts as the same role. */
const ROLE_MATCH_THRESHOLD = 0.5;

/**
 * Pick the application a signal belongs to.
 *
 * Thread continuity wins outright: if an earlier message on this thread was
 * already attributed, the reply is about the same application no matter how
 * the company is spelled in it.
 */
export function matchApplication(
  signal: { company: string | null; role: string | null },
  candidates: MatchCandidate[],
  threadId: string | null
): MatchResult {
  if (threadId) {
    const sameThread = candidates.find((c) => c.threadId === threadId);
    if (sameThread) {
      return {
        applicationId: sameThread.id,
        confidence: 0.97,
        reason: "Continues a thread already attached to this application",
        ambiguous: false,
      };
    }
  }

  if (!signal.company) {
    return {
      applicationId: null,
      confidence: 0,
      reason: "No company identified in the message",
      ambiguous: false,
    };
  }

  const sameCompany = candidates.filter((c) => companiesMatch(c.company, signal.company!));
  if (sameCompany.length === 0) {
    return {
      applicationId: null,
      confidence: 0,
      reason: `No existing application for ${signal.company}`,
      ambiguous: false,
    };
  }

  if (sameCompany.length === 1) {
    return {
      applicationId: sameCompany[0].id,
      confidence: 0.92,
      reason: `Only application for ${signal.company}`,
      ambiguous: false,
    };
  }

  // Several roles at one company — the case that makes blind company matching
  // dangerous. Only a clearly better role match resolves it.
  if (signal.role) {
    const scored = sameCompany
      .map((c) => ({ candidate: c, score: roleSimilarity(c.role, signal.role) }))
      .sort((a, b) => b.score - a.score);

    const [best, runnerUp] = scored;
    if (best.score >= ROLE_MATCH_THRESHOLD && (!runnerUp || best.score > runnerUp.score)) {
      return {
        applicationId: best.candidate.id,
        confidence: 0.85,
        reason: `Role "${signal.role}" matches "${best.candidate.role}"`,
        ambiguous: false,
      };
    }
  }

  return {
    applicationId: null,
    confidence: 0,
    reason: `${sameCompany.length} applications at ${signal.company} and the role is unclear`,
    ambiguous: true,
  };
}
