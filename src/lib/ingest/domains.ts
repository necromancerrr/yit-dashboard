import type { NormalizedMessage } from "@/lib/ingest/types";
import { senderDomain, stripForwardPrefixes } from "@/lib/ingest/normalize";
import { COURSE_CODE, INCOME_PHRASES, extractAmount, extractDate } from "@/lib/ingest/text";

// The text readers live in `text.ts` because the quick-add box on Today reads
// typed lines with exactly the same rules. They are re-exported here so this
// module stays the single import for anything doing domain routing.
export { extractAmount, extractDate };

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

// Deliberately narrower than the shared SCHOOL_PHRASES: a sender is already
// half the evidence here, and mail says "due" about a great many things that
// are not coursework.
const SCHOOL_PHRASES =
  /\b(?:assignment|homework|problem set|pset|quiz|midterm|final exam|lab report|submission|due date|is due|syllabus|lecture|discussion post|office hours)\b/i;

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
          type: INCOME_PHRASES.test(text) ? "income" : "expense",
          category: merchantFrom(message),
          amount,
          note: subject.slice(0, 120),
        },
      };
    }
  }

  return null;
}
