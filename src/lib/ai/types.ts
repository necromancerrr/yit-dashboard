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

export interface AIProvider {
  readonly name: string;
  classifyCareerEmail(input: CareerEmailInput): Promise<CareerClassification | null>;
  extractCareerEvent(input: CareerEmailInput): Promise<CareerEvent | null>;
  /**
   * Phrase an already-computed list of facts. The model is given the facts and
   * asked only to prioritize and word them — it never queries, infers, or
   * invents a deadline, so it cannot hallucinate a task you do not have.
   */
  summarizeToday(facts: BriefingFact[]): Promise<string | null>;
}
