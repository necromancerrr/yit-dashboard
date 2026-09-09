import {
  COURSE_CODE,
  INCOME_PHRASES,
  SCHOOL_PHRASES,
  extractAmount,
  extractDate,
} from "@/lib/ingest/text";
import type { MoneyProposal, SchoolProposal } from "@/lib/ingest/domains";

/**
 * Reading a typed line the same way ingestion reads an email.
 *
 * `coffee $4.50` and `CSE143 pset due 4/2` are the two shapes that actually
 * get typed, and both already have a table and an API route waiting for them.
 * Nothing here is new judgement: the date and the amount come out of
 * `@/lib/ingest/text`, the same readers the email router uses, so a line you
 * type and a receipt you are sent are understood by one set of rules rather
 * than two that drift apart.
 *
 * The two contracts that matter are inherited unchanged:
 *
 * - **Never compute a date.** Only a date written in the line is read.
 *   "due Friday" parses as a task with no due date, not a task due on
 *   whichever Friday this code guessed — you would plan around that guess and
 *   never question it.
 * - **No amount, no transaction.** A line with no number is never proposed as
 *   money, because a transaction without a number is not a transaction.
 *
 * And, like every other producer in this codebase, it *proposes*: this module
 * returns a shape for the UI to preview, and an ordinary POST to `/api/school`
 * or `/api/finance` is what actually writes a row.
 */
export interface QuickAddResult {
  domain: "school" | "money";
  /** Plain-language account of why this is the reading, shown in the preview. */
  reason: string;
  school?: SchoolProposal;
  money?: MoneyProposal;
}

const AMOUNT_TOKEN = /\$\s?\d[\d,]*(?:\.\d{2})?/g;

const MONTH_WORD =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/**
 * The spellings of a date that `extractDate` can read.
 *
 * Kept here rather than exported from the reader because they serve the
 * opposite purpose: the reader looks for a date, and this removes the one it
 * found so that what remains is the *name* of the thing — "pset" out of
 * "CSE143 pset due 4/2".
 */
const DATE_TOKENS: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  new RegExp(`\\b(?:${MONTH_WORD})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_WORD})\\.?(?:,?\\s+\\d{4})?\\b`, "gi"),
];

/** Words that only ever joined the label to the date or the amount. */
const DANGLING = /\b(?:due|on|by|at|for|of|from|to|is|was)\b/gi;

/** Trim the punctuation and connectives left behind by removing a token. */
function tidy(text: string): string {
  let out = text.replace(/\s+/g, " ").trim();
  // Only the *edges* are cleaned: a connective in the middle of "cost of
  // living" is part of the name, while a trailing "due" is debris.
  let previous = "";
  while (out !== previous) {
    previous = out;
    out = out
      .replace(/^[\s,.:;–—-]+|[\s,.:;–—-]+$/g, "")
      .replace(new RegExp(`^(?:${DANGLING.source})\\s+`, "i"), "")
      .replace(new RegExp(`\\s+(?:${DANGLING.source})$`, "i"), "")
      .trim();
  }
  return out;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Everything that is not the date, the amount, or the course code. */
function labelOf(input: string, courseCode: string | null): string {
  let out = input;
  if (courseCode) out = out.replace(courseCode, " ");
  out = out.replace(AMOUNT_TOKEN, " ");
  for (const token of DATE_TOKENS) out = out.replace(token, " ");
  return tidy(out);
}

/**
 * Read one typed line into a proposed row, or `null` for "I cannot tell".
 *
 * `null` is the same refusal `classifyDomain()` makes: the input is not
 * something these rules can read, and the honest answer is to say so rather
 * than file it somewhere plausible.
 *
 * `today` is passed in rather than read from the clock so the parser stays
 * pure and the tests do not move with the calendar.
 */
export function parseQuickAdd(input: string, today: string): QuickAddResult | null {
  const text = input.trim();
  if (!text) return null;

  const amount = extractAmount(text);
  // A typed line can become either a deadline or a purchase, and a bare
  // month/day means opposite things in each: "due March 14" points forward,
  // "spent $40 March 14" points back. Read it both ways and let the branch
  // that wins pick the one that matches what it is.
  const futureDate = extractDate(text, today, "future");
  const pastDate = extractDate(text, today, "past");
  const code = COURSE_CODE.exec(text);
  const course = code ? `${code[1]} ${code[2]}` : null;
  const label = labelOf(text, code ? code[0] : null);

  // --- School -------------------------------------------------------------
  // A course code or coursework vocabulary, and no money in the line. A course
  // code *with* a price on it ("CSE143 textbook $80") is a purchase you made
  // for a class, not a deadline, so the amount below takes it.
  if (amount === null && (course !== null || SCHOOL_PHRASES.test(text))) {
    const school: SchoolProposal = {
      course: course ?? "Course",
      title: capitalize(label) || "Task",
      // Null when the line says "due Friday". Deliberate: see the note above.
      dueDate: futureDate,
    };
    return {
      domain: "school",
      reason: futureDate
        ? `School task for ${school.course}, due ${futureDate}`
        : `School task for ${school.course} — no date written, so none is set`,
      school,
    };
  }

  // --- Money --------------------------------------------------------------
  if (amount !== null) {
    const money: MoneyProposal = {
      // Unlike a deadline, a transaction always happened on some day, and the
      // day you typed it is the honest default when the line names none.
      date: pastDate ?? today,
      type: INCOME_PHRASES.test(text) ? "income" : "expense",
      category: capitalize(label) || "Uncategorized",
      amount,
      note: label && label.toLowerCase() !== text.toLowerCase() ? text : null,
    };
    return {
      domain: "money",
      reason: `${money.type === "income" ? "Income" : "Expense"} of $${amount.toFixed(2)} on ${money.date}`,
      money,
    };
  }

  return null;
}
