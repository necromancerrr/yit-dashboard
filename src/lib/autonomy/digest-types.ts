/**
 * The client-safe half of the journal.
 *
 * `journal.ts` imports the database (and `node:crypto`), which pulls Node
 * built-ins into the browser bundle and fails the build outright when a client
 * component imports it — the same reason `search-types.ts` exists.
 */

export type UndoResult = "reverted" | "kept_edited" | "gone";

export interface DigestAction {
  id: number;
  runId: string;
  domain: string;
  tier: string;
  /** What was done, in your terms: "-$18.40 Spotify". */
  summary: string;
  /** Why it was allowed to happen without asking. Shown verbatim. */
  because: string;
  appliedAt: string;
  reviewed: boolean;
  undoneAt: string | null;
  undoResult: UndoResult | null;
  target: { table: string; id: number };
}

export interface Digest {
  actions: DigestAction[];
  unreviewed: number;
  since: string | null;
}
