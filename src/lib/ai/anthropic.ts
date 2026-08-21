import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  CareerClassification,
  CareerEvent,
  type AIProvider,
  type BriefingFact,
  type CareerEmailInput,
} from "@/lib/ai/types";

const MODEL = process.env.AI_MODEL ?? "claude-opus-5";

const CLASSIFY_SYSTEM = `You classify recruiting emails for a personal job-application tracker.

Rules:
- Report only what the message states. Never infer a company or role that is not written.
- A rejection is only a rejection if the text says so. "We will be in touch" is not.
- An automated "we received your application" is status Applied, not an interview.
- If the message is a newsletter, job alert, or marketing, isCareerRelated is false.
- When unsure, lower the confidence rather than guessing a status.`;

const EXTRACT_SYSTEM = `You extract dated facts from a recruiting email.

Rules:
- Only transcribe dates that appear in the text. Never estimate or compute one.
- If no date is present, return null. A wrong deadline is worse than no deadline.
- Keep the summary factual and under 20 words.`;

const BRIEFING_SYSTEM = `You write a two- or three-sentence action brief for a personal dashboard.

You are given a list of facts already computed from the user's own data.
- Use ONLY those facts. Never add a task, deadline, or number that is not listed.
- Name at most three concrete actions, ordered by urgency.
- Prioritize overdue or due-soon work, then urgent Inbox decisions and career updates.
- An open Inbox means the day is not clear, even when no dated deadline is due.
- Treat streaks, balances, and status counts as context, not invented tasks.
- Be plain and concise. No greeting, motivational filler, or mention of being an AI.`;

/**
 * Anthropic-backed provider.
 *
 * Uses the SDK's structured-output helper so the model's response is parsed
 * against the Zod schema before it is returned. Any failure — no key, network
 * error, unparseable output — degrades to null rather than throwing, because
 * no caller of this interface is allowed to depend on it succeeding.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic();
  }

  private describe(input: CareerEmailInput): string {
    return [
      `Received: ${input.receivedOn}`,
      `From: ${input.sender}`,
      `Subject: ${input.subject}`,
      `Excerpt: ${input.snippet}`,
    ].join("\n");
  }

  async classifyCareerEmail(input: CareerEmailInput): Promise<CareerClassification | null> {
    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 1024,
        system: CLASSIFY_SYSTEM,
        output_config: { format: zodOutputFormat(CareerClassification) },
        messages: [{ role: "user", content: this.describe(input) }],
      });
      return response.parsed_output ?? null;
    } catch (err) {
      console.warn("classifyCareerEmail failed:", err);
      return null;
    }
  }

  async extractCareerEvent(input: CareerEmailInput): Promise<CareerEvent | null> {
    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 1024,
        system: EXTRACT_SYSTEM,
        output_config: { format: zodOutputFormat(CareerEvent) },
        messages: [{ role: "user", content: this.describe(input) }],
      });
      return response.parsed_output ?? null;
    } catch (err) {
      console.warn("extractCareerEvent failed:", err);
      return null;
    }
  }

  async summarizeToday(facts: BriefingFact[]): Promise<string | null> {
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 300,
        system: BRIEFING_SYSTEM,
        messages: [
          {
            role: "user",
            content: facts.length
              ? facts.map((f) => `- ${f.title}${f.detail ? ` (${f.detail})` : ""}`).join("\n")
              : "(no facts)",
          },
        ],
      });
      const block = response.content.find((c) => c.type === "text");
      return block && block.type === "text" ? block.text.trim() : null;
    } catch (err) {
      console.warn("summarizeToday failed:", err);
      return null;
    }
  }
}
