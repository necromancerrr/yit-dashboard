import type { ApplicationStatus } from "@/lib/types";

/**
 * A message reduced to the few fields Yit OS is willing to keep.
 *
 * Note what is absent: the body. Providers fetch header metadata and the
 * short snippet the API already returns, never the full message. This
 * dashboard is not an inbox mirror, and a leak of its database should not
 * cost you your email.
 */
export interface NormalizedMessage {
  /** Stable per-provider id — the deduplication key for external_events. */
  providerMessageId: string;
  /** Groups a reply chain, so a thread is one conversation, not five events. */
  threadId: string | null;
  /** ISO date (YYYY-MM-DD) the message was received, in the app's timezone. */
  receivedOn: string;
  subject: string;
  senderName: string | null;
  senderEmail: string | null;
  /** Short excerpt only. Truncated on the way in; never a whole body. */
  snippet: string;
}

/**
 * A source of messages. Gmail is the first; the pipeline never imports it
 * directly, so a second provider is a class rather than a rewrite.
 */
export interface MailProvider {
  readonly name: string;
  /**
   * Fetch messages newer than `cursor`, oldest first.
   *
   * `cursor` is opaque to callers and produced by this same provider, so each
   * sync processes only what it has not already seen. A null cursor means a
   * first run — providers should bound that themselves rather than returning
   * an entire mailbox.
   */
  fetchSince(cursor: string | null, limit: number): Promise<{
    messages: NormalizedMessage[];
    /** Pass to the next fetchSince. Unchanged when nothing new arrived. */
    nextCursor: string | null;
  }>;
}

/** How a signal was derived. AI-derived signals are never auto-applied. */
export type ClassificationMethod = "deterministic" | "ai";

/** What a message appears to say about an application. */
export interface CareerSignal {
  isCareerRelated: boolean;
  company: string | null;
  role: string | null;
  status: ApplicationStatus | null;
  /** A deadline stated in the message, as YYYY-MM-DD. Never inferred. */
  deadline: string | null;
  /** 0-1. Drives whether this can apply on its own or must be confirmed. */
  confidence: number;
  method: ClassificationMethod;
  reasoning: string;
}

export interface IngestOutcome {
  /** Messages the provider returned. */
  fetched: number;
  /** Messages not seen before (the rest were duplicates). */
  ingested: number;
  /** Messages that looked career-related. */
  career: number;
  /** Status changes written straight through, guarded by applyEvent. */
  applied: number;
  /** Items raised for your review instead of applied. */
  proposed: number;
  /** Messages deliberately skipped (newsletters, job alerts, no signal). */
  ignored: number;
}
