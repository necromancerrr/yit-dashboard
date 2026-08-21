import type { NormalizedMessage } from "@/lib/ingest/types";
import { senderDomain, stripForwardPrefixes } from "@/lib/ingest/normalize";
import { shiftISODate } from "@/lib/date";

/**
 * Which part of your life a message is about.
 *
 * Ingestion started by asking one question — "what does this say about a job
 * application?" — and everything that was not recruiting mail was discarded.
 * Most of what actually arrives every day is a receipt, a course deadline, or
 * a bill, and each of those already has a table waiting for it.
 *
 * This router answers the wider question first, then hands off to a
 * domain-specific reader. Career keeps its existing path untouched.
 */
export type LifeDomain = "career" | "school" | "money";

/** A school deadline read off a message. Mirrors school_tasks. */
export interface SchoolProposal {
  course: string;
  title: string;
  /** YYYY-MM-DD, only ever transcribed from the text — never computed. */
  dueDate: string | null;
}

/** A transaction read off a receipt. Mirrors finance_transactions. */
export interface MoneyProposal {
  date: string;
  type: "income" | "expense";
  category: string;
  amount: number;
  note: string | null;
}

export interface DomainSignal {
  domain: LifeDomain;
  confidence: number;
  reason: string;
  school?: SchoolProposal;
  money?: MoneyProposal;
}

const LMS_DOMAINS = ["instructure.com", "canvas.net", "blackboard.com", "gradescope.com", "piazza.com", "turnitin.com"];

const RECEIPT_SENDERS = [
  "receipts.", "billing.", "invoice.", "no-reply@squareup.com", "service@paypal.com",
  "receipts@", "billing@", "invoices@", "orders@", "payments@",
];

const MONEY_PHRASES =
  /\b(?:receipt|invoice|order confirmation|payment (?:received|confirmation|of)|you (?:paid|were charged)|charged|transaction|subscription renew(?:ed|al)|your bill|amount due|total charged|refund(?:ed)?|deposit(?:ed)?)\b/i;

const SCHOOL_PHRASES =
  /\b(?:assignment|homework|problem set|pset|quiz|midterm|final exam|lab report|submission|due date|is due|syllabus|lecture|discussion post|office hours)\b/i;

/** Course codes look like "CSE 143" or "MATH126". */
const COURSE_CODE = /\b([A-Z]{2,5})\s?-?\s?(\d{2,4}[A-Z]?)\b/;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

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

  // "March 14", "Mar 14, 2027", "14 March"
  const named =
    /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/.exec(text) ??
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/.exec(text);
  if (named) {
    const monthToken = /^\d/.test(named[1]) ? named[2] : named[1];
    const dayToken = /^\d/.test(named[1]) ? named[1] : named[2];
    const month = MONTHS[monthToken.slice(0, 3).toLowerCase()];
    const day = Number(dayToken);
    if (month && day >= 1 && day <= 31) {
      const year = named[3] ? Number(named[3]) : receivedYear;
      const candidate = `${year}-${pad(month)}-${pad(day)}`;
      // A "January 5" that arrives in December means next January, not one
      // eleven months gone. Only roll forward, and only by a whole year.
      if (!named[3] && candidate < shiftISODate(receivedOn, -30)) {
        return `${year + 1}-${pad(month)}-${pad(day)}`;
      }
      return candidate;
    }
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

function merchantFrom(message: NormalizedMessage): string {
  const domain = senderDomain(message.senderEmail);
  if (message.senderName && !/no.?reply/i.test(message.senderName)) return message.senderName;
  if (!domain) return "Unknown";
  const root = domain.split(".").slice(-2)[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}

/**
 * Deterministic domain routing.
 *
 * Returns null to mean "this needs judgement" — the same contract
 * classifyDeterministic() uses, so null is the only thing that should ever
 * trigger a model call. A confident wrong answer here is worse than no answer.
 */
export function classifyDomain(message: NormalizedMessage): DomainSignal | null {
  const subject = stripForwardPrefixes(message.subject);
  const text = `${subject}\n${message.snippet}`;
  const domain = senderDomain(message.senderEmail);
  const sender = (message.senderEmail ?? "").toLowerCase();

  // --- School -------------------------------------------------------------
  const fromLMS = LMS_DOMAINS.some((d) => domain?.endsWith(d));
  const fromEdu = domain?.endsWith(".edu") ?? false;
  if ((fromLMS || fromEdu) && SCHOOL_PHRASES.test(text)) {
    const code = COURSE_CODE.exec(subject) ?? COURSE_CODE.exec(message.snippet);
    return {
      domain: "school",
      // An LMS is unambiguous; a person emailing from a .edu might be anything.
      confidence: fromLMS ? 0.9 : 0.75,
      reason: fromLMS ? "Course platform message about coursework" : "University sender about coursework",
      school: {
        course: code ? `${code[1]} ${code[2]}` : "Course",
        title: subject.slice(0, 120),
        dueDate: extractDate(text, message.receivedOn),
      },
    };
  }

  // --- Money --------------------------------------------------------------
  const fromReceiptSender = RECEIPT_SENDERS.some((s) => sender.includes(s));
  if (MONEY_PHRASES.test(text)) {
    const amount = extractAmount(text);
    // No amount means nothing worth proposing — a transaction without a number
    // is not a transaction, and guessing one would corrupt the ledger.
    if (amount !== null) {
      return {
        domain: "money",
        confidence: fromReceiptSender ? 0.88 : 0.72,
        reason: fromReceiptSender ? "Receipt from a billing sender" : "Message states a charged amount",
        money: {
          date: extractDate(text, message.receivedOn) ?? message.receivedOn,
          type: /\b(?:refund(?:ed)?|deposit(?:ed)?|payment received|you received)\b/i.test(text)
            ? "income"
            : "expense",
          category: merchantFrom(message),
          amount,
          note: subject.slice(0, 120),
        },
      };
    }
  }

  return null;
}
