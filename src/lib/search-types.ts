/**
 * The client-safe half of search.
 *
 * `src/lib/search.ts` imports the database, which pulls `node:fs` in through
 * the libSQL client — importing it from a client component drags Node built-ins
 * into the browser bundle and fails the build outright.
 *
 * So the shape and the labels live here, exactly as `career-status.ts` is kept
 * pure so the client can share the definitions the API enforces.
 */

export type SearchKind = "application" | "school" | "money" | "crypto" | "checklist";

export interface SearchHit {
  kind: SearchKind;
  id: number;
  title: string;
  /** Second line: the amount, the status, the course. */
  detail: string | null;
  /** ISO date used for ordering, when the row has one. */
  date: string | null;
  href: string;
}

/** Section labels, so the UI does not restate the mapping. */
export const KIND_LABEL: Record<SearchKind, string> = {
  application: "Career",
  school: "School",
  money: "Money",
  crypto: "Crypto",
  checklist: "Checklist",
};
