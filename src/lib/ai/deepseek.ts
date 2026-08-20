import {
  CareerClassification,
  CareerEvent,
  type AIProvider,
  type BriefingFact,
  type CareerEmailInput,
} from "@/lib/ai/types";
import type { z } from "zod";

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = process.env.AI_MODEL ?? "deepseek-v4-flash";

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
}
