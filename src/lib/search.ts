import { db } from "@/lib/db";
import type { SearchHit } from "@/lib/search-types";

/**
 * One box that finds anything you have written down.
 *
 * The dashboard splits your life into sections, which is right for reviewing
 * and wrong for remembering: "what did I pay that dentist?" does not begin by
 * choosing a tab. Without this, finding a six-week-old transaction means
 * knowing which section to open and scrolling.
 *
 * Deliberately dumb, and deliberately not AI. A `LIKE` scan over a handful of
 * columns is instant at this scale, works offline once cached, costs nothing,
 * and — most importantly — is *predictable*: it finds exactly the rows
 * containing what you typed, never a plausible-looking row that does not.
 */

export type { SearchKind, SearchHit } from "@/lib/search-types";
export { KIND_LABEL } from "@/lib/search-types";

const MAX_PER_KIND = 8;
const MAX_TOTAL = 30;

/**
 * `LIKE` treats `%` and `_` as wildcards, so a search for "50%" would match
 * everything. Escape them and declare the escape character in the SQL.
 */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function search(rawQuery: string): Promise<SearchHit[]> {
  const query = rawQuery.trim();
  // One character matches most of the database — that is a scroll, not a
  // search, and it would make the box feel broken rather than fast.
  if (query.length < 2) return [];

  const like = likePattern(query);
  const hits: SearchHit[] = [];

  const [applications, school, money, crypto, checklist] = await Promise.all([
    db.execute({
      sql: `SELECT id, company, role, status FROM applications
             WHERE company LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\'
             ORDER BY id DESC LIMIT ?`,
      args: [like, like, MAX_PER_KIND],
    }),
    db.execute({
      sql: `SELECT id, course, title, due_date, status FROM school_tasks
             WHERE course LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\'
             ORDER BY due_date IS NULL, due_date DESC LIMIT ?`,
      args: [like, like, MAX_PER_KIND],
    }),
    db.execute({
      sql: `SELECT id, date, type, category, amount, note FROM finance_transactions
             WHERE category LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\'
             ORDER BY date DESC LIMIT ?`,
      args: [like, like, MAX_PER_KIND],
    }),
    db.execute({
      sql: `SELECT id, symbol, name, quantity FROM crypto_holdings
             WHERE symbol LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
             ORDER BY id DESC LIMIT ?`,
      args: [like, like, MAX_PER_KIND],
    }),
    db.execute({
      sql: `SELECT id, title, category, done FROM checklist_items
             WHERE title LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\'
             ORDER BY id DESC LIMIT ?`,
      args: [like, like, MAX_PER_KIND],
    }),
  ]);

  for (const row of applications.rows) {
    hits.push({
      kind: "application",
      id: Number(row.id),
      title: String(row.company),
      detail: [row.role, row.status].filter(Boolean).join(" · ") || null,
      date: null,
      href: `/career/${row.id}`,
    });
  }

  for (const row of school.rows) {
    hits.push({
      kind: "school",
      id: Number(row.id),
      title: String(row.title),
      detail: [row.course, row.status].filter(Boolean).join(" · ") || null,
      date: (row.due_date as string | null) ?? null,
      href: "/school",
    });
  }

  for (const row of money.rows) {
    const amount = Number(row.amount);
    hits.push({
      kind: "money",
      id: Number(row.id),
      title: String(row.category),
      // Sign it: "-$40 Groceries" reads instantly, "40 Groceries" does not.
      detail: `${row.type === "income" ? "+" : "−"}$${amount.toFixed(2)}${row.note ? ` · ${row.note}` : ""}`,
      date: (row.date as string | null) ?? null,
      href: "/money",
    });
  }

  for (const row of crypto.rows) {
    hits.push({
      kind: "crypto",
      id: Number(row.id),
      title: String(row.name),
      detail: `${row.quantity} ${row.symbol}`,
      date: null,
      href: "/money",
    });
  }

  for (const row of checklist.rows) {
    hits.push({
      kind: "checklist",
      id: Number(row.id),
      title: String(row.title),
      detail: [row.category, row.done ? "done" : null].filter(Boolean).join(" · ") || null,
      date: null,
      href: "/checklist",
    });
  }

  // Dated rows first and most recent first, because a search is nearly always
  // about something recent. Undated rows keep their per-section order rather
  // than being scattered.
  return hits
    .sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return 0;
    })
    .slice(0, MAX_TOTAL);
}
