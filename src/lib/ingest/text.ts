import { shiftISODate } from "@/lib/date";

/**
 * Reading facts out of free text.
 *
 * These readers started life inside the email domain router, where the text
 * came from a subject line and a snippet. They are just as true of a line you
 * type into a box, so they live here on their own: pure, dependency-free,
 * client-safe, and shared verbatim by both callers. Duplicating them would
 * mean a quick-add box that agrees with your inbox only until one of the two
 * copies is edited.
 *
 * The contract they enforce is the important part, and it is the same in both
 * places: **only what is written is read**. Nothing here computes a date or
 * infers an amount, so what these functions cannot see they return `null` for
 * rather than guessing.
 */

/** Course codes look like "CSE 143" or "MATH126". */
export const COURSE_CODE = /\b([A-Z]{2,5})\s?-?\s?(\d{2,4}[A-Z]?)\b/;

/** Words that say a piece of text is about coursework rather than anything else. */
export const SCHOOL_PHRASES =
  /\b(?:assignment|homework|problem set|pset|quiz|midterm|final exam|exam|lab report|lab|essay|paper|reading|project|submission|due date|due|is due|syllabus|lecture|discussion post|office hours)\b/i;

/** Words that say money moved *towards* you. Everything else is an expense. */
export const INCOME_PHRASES =
  /\b(?:refund(?:ed)?|deposit(?:ed)?|payment received|you received|reimburs(?:ed|ement)|paycheck|payday|salary|income|earned|got paid)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "March 14", "Mar. 14, 2027" — a month word followed by a day. */
const MONTH_FIRST = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/g;
/** "14 March", "14th Mar 2027" — the same date the other way round. */
const DAY_FIRST = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/g;

/**
 * Pull an explicit date out of text.
 *
 * Only formats actually written in the message are accepted. "Due Friday" and
 * "in two weeks" are deliberately unreadable here: a wrong deadline is worse
 * than no deadline, because you will plan around it and never question it.
 */
export function extractDate(text: string, receivedOn: string): string | null {
  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const receivedYear = Number(receivedOn.slice(0, 4));

  // Every "word followed by a number" is a *candidate* month, and most of them
  // are not one: "Quiz 4 due March 14" offers "Quiz 4" first. Taking only the
  // first match would discard the real date sitting later in the same line, so
  // candidates are tried in order until one names an actual month.
  for (const named of [...text.matchAll(MONTH_FIRST), ...text.matchAll(DAY_FIRST)]) {
    const monthToken = /^\d/.test(named[1]) ? named[2] : named[1];
    const dayToken = /^\d/.test(named[1]) ? named[1] : named[2];
    const month = MONTHS[monthToken.slice(0, 3).toLowerCase()];
    const day = Number(dayToken);
    if (!month || day < 1 || day > 31) continue;
    const year = named[3] ? Number(named[3]) : receivedYear;
    const candidate = `${year}-${pad(month)}-${pad(day)}`;
    // A "January 5" that arrives in December means next January, not one
    // eleven months gone. Only roll forward, and only by a whole year.
    if (!named[3] && candidate < shiftISODate(receivedOn, -30)) {
      return `${year + 1}-${pad(month)}-${pad(day)}`;
    }
    return candidate;
  }

  // "3/14" or "3/14/2027"
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text);
  if (slash) {
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const rawYear = slash[3] ? Number(slash[3]) : receivedYear;
      const year = rawYear < 100 ? 2000 + rawYear : rawYear;
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  return null;
}

/** Pull a USD amount out of text. Returns the largest, which is the total. */
export function extractAmount(text: string): number | null {
  const matches = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{2})?)/g)];
  if (matches.length === 0) return null;
  const amounts = matches
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (amounts.length === 0) return null;
  // A receipt lists items then a total; the total is the largest number.
  return Math.max(...amounts);
}
