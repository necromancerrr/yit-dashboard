import type { ApplicationStatus } from "@/lib/types";
import type { CareerSignal, NormalizedMessage } from "@/lib/ingest/types";
import {
  companyFromDomain,
  isATSDomain,
  senderDomain,
  stripForwardPrefixes,
} from "@/lib/ingest/normalize";

/**
 * Deterministic classification of recruiting mail.
 *
 * Most recruiting email is templated, so most of it can be read by rules:
 * "Thank you for applying" means Applied, "unfortunately" near "application"
 * means Rejected. Rules are free, instant, offline, and identical every run,
 * which also makes them testable against fixtures in a way a model is not.
 *
 * A model is worth calling only for what rules genuinely cannot do — free-form
 * recruiter prose, role titles buried in a sentence. That is why this returns
 * null instead of guessing: null is the signal to escalate to the AI provider,
 * and a wrong confident guess here would be worse than no guess at all.
 */

/** Above this, a deterministic signal may apply without asking. */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.9;

interface Rule {
  status: ApplicationStatus;
  confidence: number;
  /** All of these must appear for the rule to fire. */
  patterns: RegExp[];
  /** Any of these disqualifies it. */
  unless?: RegExp[];
  reason: string;
}

// Ordered: the first match wins, so later stages are listed before earlier
// ones. An interview invitation that also thanks you for applying is an
// interview invitation.
const RULES: Rule[] = [
  {
    status: "Rejected",
    confidence: 0.95,
    patterns: [
      /\b(?:unfortunately|regret to inform|not (?:be )?(?:moving|progressing) forward|will not be moving|decided not to (?:move|proceed)|no longer under consideration|not to proceed with your application)\b/i,
    ],
    reason: "Message states the application will not proceed",
  },
  {
    status: "Offer",
    confidence: 0.92,
    patterns: [/\b(?:offer of employment|pleased to offer|extend(?:ing)? (?:you )?an offer|your offer letter)\b/i],
    unless: [/\bunfortunately\b/i],
    reason: "Message extends an offer",
  },
  {
    status: "Onsite",
    confidence: 0.9,
    patterns: [/\b(?:onsite|on-site|final round|final[- ]stage|super ?day|hiring manager (?:round|interview))\b/i],
    unless: [/\bunfortunately\b/i],
    reason: "Message refers to a final-stage interview",
  },
  {
    status: "Technical",
    confidence: 0.9,
    patterns: [/\b(?:technical (?:interview|screen|round)|coding interview|system design interview|pair programming)\b/i],
    unless: [/\bunfortunately\b/i],
    reason: "Message refers to a technical interview",
  },
  {
    status: "Phone Screen",
    confidence: 0.88,
    patterns: [
      /\b(?:phone screen|recruiter (?:call|screen|chat)|introductory call|intro call|initial (?:call|conversation)|screening call)\b/i,
    ],
    unless: [/\bunfortunately\b/i],
    reason: "Message invites you to a recruiter screen",
  },
  {
    status: "OA",
    confidence: 0.93,
    patterns: [
      /\b(?:online assessment|coding (?:assessment|challenge|test)|hackerrank|codility|codesignal|hackerearth|take[- ]home (?:assessment|assignment|challenge))\b/i,
    ],
    unless: [/\bunfortunately\b/i],
    reason: "Message invites you to an online assessment",
  },
  {
    status: "Applied",
    confidence: 0.9,
    patterns: [
      /\b(?:thank you for (?:your interest|applying)|we(?:'ve| have) received your application|application (?:has been )?received|successfully submitted|thanks for applying)\b/i,
    ],
    unless: [/\bunfortunately\b/i],
    reason: "Automated confirmation that an application was received",
  },
];

/**
 * Mail that looks recruiting-adjacent but concerns no application of yours.
 * Checked first: a job alert is full of interview vocabulary and would
 * otherwise match several rules confidently.
 */
const NOT_ABOUT_YOUR_APPLICATION =
  /\b(?:job alert|jobs? you may be interested|new jobs? (?:matching|for you)|recommended jobs?|unsubscribe from job|weekly (?:digest|newsletter)|webinar|career fair|hiring event|apply now to|view all jobs|top picks for you)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Spelled out rather than [A-Z][a-z]+ because these patterns are
// case-insensitive: a character class cannot express "a capitalised word" under
// /i, so any lowercase word after "due by" would be read as a month name.
const MONTH_NAMES =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|" +
  "aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

const DEADLINE_TRIGGER = "(?:due|expires?|complete(?:d)? by|deadline|submit by|closes?)";

/** Deadline phrasings, most explicit first. */
const DEADLINE_PATTERNS = [
  new RegExp(
    `\\b${DEADLINE_TRIGGER}\\s*(?:on|by|:)?\\s*((?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?)`,
    "i"
  ),
  new RegExp(`\\b${DEADLINE_TRIGGER}\\s*(?:on|by|:)?\\s*(\\d{4}-\\d{2}-\\d{2})`, "i"),
  /\bwithin\s+(\d+)\s+(?:business\s+)?days?\b/i,
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parse a stated deadline into YYYY-MM-DD.
 *
 * Only dates the message actually states are returned. A wrong deadline is
 * worse than none — it would put a fabricated item at the top of Today — so
 * anything unparseable yields null rather than a best guess.
 */
export function extractDeadline(text: string, receivedOn: string): string | null {
  // Each pattern that matches but fails to parse falls through to the next,
  // rather than ending the search — an earlier pattern matching the wrong
  // fragment must not hide a later one that would have read it correctly.
  for (const pattern of DEADLINE_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const value = match[1];

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    // "within N days" is relative to when the message arrived.
    if (/^\d+$/.test(value)) {
      const days = Number(value);
      if (days < 1 || days > 60) continue;
      const base = new Date(`${receivedOn}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() + days);
      return `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
    }

    const named = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/.exec(value);
    if (named) {
      const month = MONTHS[named[1].slice(0, 3).toLowerCase()];
      const day = Number(named[2]);
      if (!month || day < 1 || day > 31) continue;
      // No year stated: assume the coming occurrence, since a deadline is
      // ahead of the message, never behind it.
      let year = named[3] ? Number(named[3]) : Number(receivedOn.slice(0, 4));
      if (!named[3] && `${year}-${pad(month)}-${pad(day)}` < receivedOn) year += 1;
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }
  return null;
}

/**
 * Pull the employer out of the text when the sender domain cannot say.
 *
 * Assessment vendors and ATS platforms send on behalf of an employer, so the
 * company appears in phrasing like "your application to Stripe".
 */
export function extractCompanyFromText(text: string): string | null {
  const patterns = [
    /\b(?:your application (?:to|at|with)|applying (?:to|at|with)|position (?:at|with)|role (?:at|with)|interview (?:at|with)|assessment for)\s+([A-Z][\w&.\-]*(?:[ \t]+[A-Z][\w&.\-]*){0,3})/,
    /\b([A-Z][\w&.\-]*(?:[ \t]+[A-Z][\w&.\-]*){0,3})\s+(?:has invited you|invites you|would like to invite you)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const candidate = match[1]
        .replace(/\b(?:Online|Assessment|Coding|Interview|Team|Recruiting|Talent)\b.*$/, "")
        .trim();
      if (candidate.length > 1) return candidate;
    }
  }
  return null;
}

/**
 * Classify a message using rules alone.
 *
 * Returns null when the rules have nothing confident to say, which is the
 * caller's cue to try the AI provider. `isCareerRelated: false` is different —
 * that is a definite "this is a newsletter", and must not be escalated.
 */
export function classifyDeterministic(message: NormalizedMessage): CareerSignal | null {
  const subject = stripForwardPrefixes(message.subject);
  const text = `${subject}\n${message.snippet}`;

  if (NOT_ABOUT_YOUR_APPLICATION.test(text)) {
    return {
      isCareerRelated: false,
      company: null,
      role: null,
      status: null,
      deadline: null,
      confidence: 0.9,
      method: "deterministic",
      reasoning: "Job alert or marketing mail, not about an application of yours",
    };
  }

  const matched = RULES.find(
    (rule) =>
      rule.patterns.every((p) => p.test(text)) && !rule.unless?.some((p) => p.test(text))
  );
  if (!matched) return null;

  const domain = senderDomain(message.senderEmail);
  const fromText = extractCompanyFromText(text);
  const fromDomain = companyFromDomain(domain);

  // Who sent it is usually the best evidence of which company it is about —
  // but not always, and the exceptions matter:
  //
  //  - An ATS or assessment vendor sends on behalf of an employer, so the
  //    domain names Greenhouse, not the company hiring.
  //  - A message you forwarded to yourself carries *your* domain. Trusting it
  //    would attribute a Goldman Sachs assessment to your university.
  //
  // In both cases the employer is stated in the text, so that wins.
  const wasForwarded = subject !== message.subject.trim();
  const company =
    isATSDomain(domain) || wasForwarded
      ? fromText ?? fromDomain ?? message.senderName
      : fromDomain ?? fromText ?? message.senderName;

  return {
    isCareerRelated: true,
    company: company ?? null,
    // Role titles are free-form prose; rules do badly at them, so this is left
    // for the AI path or for matching on company alone.
    role: null,
    status: matched.status,
    deadline: extractDeadline(text, message.receivedOn),
    // A signal we cannot attribute to a company cannot be matched safely, so
    // it drops below the auto-apply bar and goes to review instead.
    confidence: company ? matched.confidence : Math.min(matched.confidence, 0.6),
    method: "deterministic",
    reasoning: matched.reason,
  };
}
