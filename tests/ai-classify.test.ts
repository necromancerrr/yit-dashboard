import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type {
  AIProvider,
  BriefingFact,
  CareerClassification,
  CareerEmailInput,
  CareerEvent,
} from "@/lib/ai/types";
import { classifyCareerMessage } from "@/lib/ingest/classify-with-ai";
import type { NormalizedMessage } from "@/lib/ingest/types";

class FakeProvider implements AIProvider {
  readonly name = "fake";
  calls = 0;

  constructor(private result: CareerClassification | null) {}

  async classifyCareerEmail(_input: CareerEmailInput): Promise<CareerClassification | null> {
    this.calls += 1;
    return this.result;
  }

  async extractCareerEvent(_input: CareerEmailInput): Promise<CareerEvent | null> {
    return null;
  }

  async summarizeToday(_facts: BriefingFact[]): Promise<string | null> {
    return null;
  }
}

function message(over: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    providerMessageId: "ai-001",
    threadId: "ai-thread",
    receivedOn: "2026-08-20",
    subject: "",
    senderName: null,
    senderEmail: null,
    snippet: "",
    ...over,
  };
}

describe("AI-assisted career classification", () => {
  test("DeepSeek-style review enriches a deterministic ATS message", async () => {
    const provider = new FakeProvider({
      isCareerRelated: true,
      company: "SAP",
      role: "iXp Full-Stack Software Engineer Intern",
      proposedStatus: "Rejected",
      confidence: 0.94,
      reasoning: "The message rejects the stated SAP internship application.",
    });

    const signal = await classifyCareerMessage(
      message({
        subject: "Your Application for SAP iXp Intern - Full-Stack Software Engineer",
        senderName: "SAP SuccessFactors",
        senderEmail: "notifications@successfactors.com",
        snippet: "Unfortunately, we will not be moving forward with your application.",
      }),
      provider
    );

    assert.equal(provider.calls, 1, "a positive rule match must still reach the AI provider");
    assert.equal(signal?.company, "SAP");
    assert.equal(signal?.role, "iXp Full-Stack Software Engineer Intern");
    assert.equal(signal?.status, "Rejected");
    assert.equal(signal?.method, "ai");
  });

  test("obvious job alerts are ignored without spending an AI call", async () => {
    const provider = new FakeProvider(null);
    const signal = await classifyCareerMessage(
      message({
        subject: "10 new jobs matching your search",
        senderEmail: "jobs-noreply@linkedin.com",
        snippet: "Recommended jobs for you. Apply now to view all jobs.",
      }),
      provider
    );

    assert.equal(provider.calls, 0);
    assert.equal(signal?.isCareerRelated, false);
  });

  test("rules remain the fallback when the AI provider is unavailable", async () => {
    const signal = await classifyCareerMessage(
      message({
        subject: "Thank you for applying to NVIDIA",
        senderEmail: "careers@nvidia.com",
        snippet: "We have received your application and will review it shortly.",
      }),
      null
    );

    assert.equal(signal?.status, "Applied");
    assert.equal(signal?.method, "deterministic");
  });
});
