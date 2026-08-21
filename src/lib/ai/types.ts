import { z } from "zod";

/**
 * The AI boundary for Yit OS.
 *
 * Two rules shape everything here:
 *
 * 1. **Structured or nothing.** Every operation returns a Zod-validated shape.
 *    Free-form model prose is never parsed, trusted, or written to the
 *    database — an extraction that does not satisfy its schema is a failure,
 *    not something to salvage.
 *
 * 2. **Never a hard dependency.** Every operation may return null, and every
 *    caller must already work when it does. AI improves the system; ordinary
 *    CRUD must not need a model, an API key, or a network round trip.
 */

/** What a career-related message appears to be about. */
export const CareerClassification = z.object({
  isCareerRelated: z.boolean(),
  company: z.string().nullable().describe("Employer name, exactly as written. Null if unclear."),
  role: z.string().nullable().describe("Role title if stated, else null"),
  /** Constrained to the pipeline; the model cannot invent a status. */
  proposedStatus: z
    .enum(["Applied", "OA", "Phone Screen", "Technical", "Onsite", "Offer", "Rejected", "Withdrawn"])
    .nullable(),
  confidence: z.number().min(0).max(1).describe("0-1. Below 0.7 should be reviewed by a human."),
  reasoning: z.string().describe("One sentence on what in the message justified this"),
});
export type CareerClassification = z.infer<typeof CareerClassification>;

/** A dated fact worth putting on an application's timeline. */
export const CareerEvent = z.object({
  occurredOn: z.string().nullable().describe("YYYY-MM-DD the event happened, if stated"),
  deadline: z.string().nullable().describe("YYYY-MM-DD a deadline falls, e.g. an OA due date"),
  summary: z.string().describe("Short factual description, no speculation"),
});
export type CareerEvent = z.infer<typeof CareerEvent>;

export interface CareerEmailInput {
  subject: string;
  sender: string;
  /** A short excerpt only — never the whole message body. */
  snippet: string;
  receivedOn: string;
}

/** One fact already computed from the database, handed to the model verbatim. */
export interface BriefingFact {
  title: string;
  detail: string | null;
}

/** A screenshot handed to a vision-capable provider. */
export interface ScreenshotImage {
  /** e.g. "image/png" */
  mediaType: string;
  base64: string;
}

export type ScreenshotKind = "crypto" | "transactions";

/** One crypto holding read off an exchange screenshot. */
export const ScreenshotCrypto = z.object({
  holdings: z.array(
    z.object({
      symbol: z.string().describe("Ticker symbol, e.g. ETH, SOL, XRP"),
      name: z.string().describe("Full asset name as shown, e.g. Ethereum"),
      quantity: z.number().nullable().describe("Units held if a coin amount is shown, else null"),
      value_usd: z.number().nullable().describe("Total USD value if shown, else null"),
      staked_pct: z.number().nullable().describe("Percent staked if stated, else null"),
    })
  ),
  notes: z.string().nullable().describe("Anything ambiguous or unreadable worth flagging"),
});
export type ScreenshotCrypto = z.infer<typeof ScreenshotCrypto>;

/** One transaction read off a banking or receipt screenshot. */
export const ScreenshotTransactions = z.object({
  transactions: z.array(
    z.object({
      date: z.string().describe("YYYY-MM-DD; use today's date if none is visible"),
      type: z.enum(["income", "expense"]),
      category: z.string().describe("Short category, e.g. Groceries, Salary, Transport"),
      amount: z.number().describe("Positive amount in USD"),
      note: z.string().nullable(),
    })
  ),
  notes: z.string().nullable().describe("Anything ambiguous or unreadable worth flagging"),
});
export type ScreenshotTransactions = z.infer<typeof ScreenshotTransactions>;

export interface AIProvider {
  readonly name: string;
  /**
   * Whether this provider's configured model accepts images.
   *
   * Declared rather than discovered so a caller can explain *why* screenshot
   * import is unavailable instead of failing with a generic "couldn't read
   * that image" — the two have completely different fixes.
   */
  readonly supportsVision: boolean;
  classifyCareerEmail(input: CareerEmailInput): Promise<CareerClassification | null>;
  extractCareerEvent(input: CareerEmailInput): Promise<CareerEvent | null>;
  /**
   * Phrase an already-computed list of facts. The model is given the facts and
   * asked only to prioritize and word them — it never queries, infers, or
   * invents a deadline, so it cannot hallucinate a task you do not have.
   */
  summarizeToday(facts: BriefingFact[]): Promise<string | null>;
  /**
   * Read a screenshot into rows. Returns null when the provider cannot see
   * images or the response fails its schema — the caller proposes the result
   * for review either way and never writes it directly.
   */
  extractFromScreenshot(
    image: ScreenshotImage,
    kind: ScreenshotKind,
    today: string
  ): Promise<ScreenshotCrypto | ScreenshotTransactions | null>;
}
