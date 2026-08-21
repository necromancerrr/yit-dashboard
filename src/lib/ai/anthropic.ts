import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  CareerClassification,
  CareerEvent,
  type AIProvider,
  type BriefingFact,
  ScreenshotCrypto,
  ScreenshotTransactions,
  type CareerEmailInput,
  type ScreenshotImage,
  type ScreenshotKind,
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

const BRIEFING_SYSTEM = `You write a two-sentence focus note for a personal dashboard.

You are given a list of facts already computed from the user's own data.
- Use ONLY those facts. Never add a task, deadline, or number that is not listed.
- Say which to do first and why, plainly. No greetings, no motivational filler.
- If the list is empty, say the day looks clear.`;

/**
 * Anthropic-backed provider.
 *
 * Uses the SDK's structured-output helper so the model's response is parsed
 * against the Zod schema before it is returned. Any failure — no key, network
 * error, unparseable output — degrades to null rather than throwing, because
 * no caller of this interface is allowed to depend on it succeeding.
 */
const SCREENSHOT_SYSTEM = `You read screenshots of financial apps and turn them into structured data.

Rules:
- Transcribe only what is visibly present. Never invent, complete, or estimate a value that is not shown.
- Ignore aggregate rows: portfolio totals, "today" summaries, and headline balances are not holdings.
- Percentages next to an amount are usually a 24h change, not a quantity. Do not confuse them.
- If a number is cut off, obscured, or you are unsure, omit that row and say so in notes.
- It is far better to return fewer rows than to return a wrong number.`;

function screenshotPrompt(kind: ScreenshotKind, today: string): string {
  return kind === "crypto"
    ? `Extract every individual crypto holding from this screenshot. Today's date is ${today}.`
    : `Extract every individual transaction from this screenshot. Today's date is ${today}. Use it for any row with no visible date.`;
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly supportsVision = true;
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

  async extractFromScreenshot(
    image: ScreenshotImage,
    kind: ScreenshotKind,
    today: string
  ): Promise<ScreenshotCrypto | ScreenshotTransactions | null> {
    try {
      const response = await this.client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        system: SCREENSHOT_SYSTEM,
        output_config: {
          format: zodOutputFormat(kind === "crypto" ? ScreenshotCrypto : ScreenshotTransactions),
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                  data: image.base64,
                },
              },
              { type: "text", text: screenshotPrompt(kind, today) },
            ],
          },
        ],
      });
      return response.parsed_output ?? null;
    } catch (err) {
      console.warn("extractFromScreenshot failed:", err);
      return null;
    }
  }
}
