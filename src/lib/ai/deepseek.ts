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
import type { z } from "zod";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.AI_MODEL ?? "deepseek-v4-flash";

/**
 * DeepSeek's chat models are text-only, so screenshot import is off for this
 * provider unless you name a vision-capable model yourself. Opt in with
 * DEEPSEEK_VISION_MODEL rather than having the app guess and fail per request:
 * a text model does not politely decline an image, it either errors or answers
 * from the prompt alone — which would invent holdings it never saw.
 */
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL?.trim() || null;

const SCREENSHOT_SYSTEM = `You read screenshots of financial apps and turn them into structured data.

Rules:
- Transcribe only what is visibly present. Never invent, complete, or estimate a value that is not shown.
- Ignore aggregate rows: portfolio totals, "today" summaries, and headline balances are not holdings.
- Percentages next to an amount are usually a 24h change, not a quantity. Do not confuse them.
- If a number is cut off, obscured, or you are unsure, omit that row and say so in notes.
- It is far better to return fewer rows than to return a wrong number.
- Respond in valid JSON only.`;

const CLASSIFY_SYSTEM = `You classify recruiting emails for a personal job-application tracker.

Return only JSON matching this shape:
{
  "isCareerRelated": boolean,
  "company": string | null,
  "role": string | null,
  "proposedStatus": "Applied" | "OA" | "Phone Screen" | "Technical" | "Onsite" | "Offer" | "Rejected" | "Withdrawn" | null,
  "confidence": number,
  "reasoning": string
}

Rules:
- Report only what the message states. Never infer a company or role that is not written.
- A rejection is only a rejection if the text says so. "We will be in touch" is not.
- An automated "we received your application" is status Applied, not an interview.
- If the message is a newsletter, job alert, or marketing, isCareerRelated is false.
- When unsure, lower the confidence rather than guessing a status.`;

const EXTRACT_SYSTEM = `You extract dated facts from a recruiting email.

Return only JSON matching this shape:
{
  "occurredOn": "YYYY-MM-DD" | null,
  "deadline": "YYYY-MM-DD" | null,
  "summary": string
}

Rules:
- Only transcribe dates that appear in the text. Never estimate or compute one.
- If no date is present, return null. A wrong deadline is worse than no deadline.
- Keep the summary factual and under 20 words.`;

const BRIEFING_SYSTEM = `You write a two-sentence focus note for a personal dashboard.

You are given a list of facts already computed from the user's own data.
- Use ONLY those facts. Never add a task, deadline, or number that is not listed.
- Say which to do first and why, plainly. No greetings, no motivational filler.
- If the list is empty, say the day looks clear.`;

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

/**
 * DeepSeek-backed provider using its OpenAI-compatible Chat Completions API.
 *
 * JSON-mode responses are still validated with Zod before they cross the
 * AIProvider boundary. Any provider/API/schema failure degrades to null so AI
 * remains optional for every caller.
 */
export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";
  readonly supportsVision = VISION_MODEL !== null;

  private describe(input: CareerEmailInput): string {
    return [
      `Received: ${input.receivedOn}`,
      `From: ${input.sender}`,
      `Subject: ${input.subject}`,
      `Excerpt: ${input.snippet}`,
    ].join("\n");
  }

  private async requestText(system: string, content: string, maxTokens: number): Promise<string | null> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content },
        ],
        max_tokens: maxTokens,
        stream: false,
        thinking: { type: "disabled" },
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API returned ${response.status}`);
    }

    const json = (await response.json()) as DeepSeekResponse;
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  }

  private async requestJSON<T>(
    system: string,
    content: string,
    schema: z.ZodType<T>
  ): Promise<T | null> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: `${content}\n\nRespond in valid JSON only.` },
        ],
        max_tokens: 1024,
        response_format: { type: "json_object" },
        stream: false,
        thinking: { type: "disabled" },
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API returned ${response.status}`);
    }

    const json = (await response.json()) as DeepSeekResponse;
    const raw = json.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  async classifyCareerEmail(input: CareerEmailInput): Promise<CareerClassification | null> {
    try {
      return await this.requestJSON(CLASSIFY_SYSTEM, this.describe(input), CareerClassification);
    } catch (err) {
      console.warn("classifyCareerEmail failed:", err);
      return null;
    }
  }

  async extractCareerEvent(input: CareerEmailInput): Promise<CareerEvent | null> {
    try {
      return await this.requestJSON(EXTRACT_SYSTEM, this.describe(input), CareerEvent);
    } catch (err) {
      console.warn("extractCareerEvent failed:", err);
      return null;
    }
  }

  async summarizeToday(facts: BriefingFact[]): Promise<string | null> {
    try {
      return await this.requestText(
        BRIEFING_SYSTEM,
        facts.length
          ? facts.map((f) => `- ${f.title}${f.detail ? ` (${f.detail})` : ""}`).join("\n")
          : "(no facts)",
        300
      );
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
    if (!VISION_MODEL) return null;

    const schema = kind === "crypto" ? ScreenshotCrypto : ScreenshotTransactions;
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: VISION_MODEL,
          messages: [
            { role: "system", content: SCREENSHOT_SYSTEM },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
                },
                { type: "text", text: kind === "crypto"
                    ? `Extract every individual crypto holding from this screenshot. Today's date is ${today}.`
                    : `Extract every individual transaction from this screenshot. Today's date is ${today}. Use it for any row with no visible date.` },
              ],
            },
          ],
          max_tokens: 8000,
          response_format: { type: "json_object" },
          stream: false,
        }),
      });

      if (!response.ok) throw new Error(`DeepSeek API returned ${response.status}`);

      const json = (await response.json()) as DeepSeekResponse;
      const raw = json.choices?.[0]?.message?.content;
      if (!raw) return null;

      // JSON mode is a request, not a guarantee, so the schema is the contract.
      const parsed = schema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    } catch (err) {
      console.warn("extractFromScreenshot failed:", err);
      return null;
    }
  }
}
