import { getAIProvider, type AIProvider } from "@/lib/ai";
import { classifyDeterministic } from "@/lib/ingest/classify";
import type { CareerSignal, NormalizedMessage } from "@/lib/ingest/types";

/**
 * Use rules to reject obvious noise, then let the configured model review every
 * recruiting-positive message. The model is especially useful for employer and
 * role names hidden behind ATS sender domains; rules retain literal deadlines
 * and remain the fallback when AI is unavailable.
 */
export async function classifyCareerMessage(
  message: NormalizedMessage,
  provider: AIProvider | null = getAIProvider()
): Promise<CareerSignal | null> {
  const deterministic = classifyDeterministic(message);
  if (deterministic && !deterministic.isCareerRelated) return deterministic;
  if (!provider) return deterministic;

  const result = await provider.classifyCareerEmail({
    subject: message.subject,
    sender:
      message.senderName && message.senderEmail
        ? `${message.senderName} <${message.senderEmail}>`
        : message.senderEmail ?? message.senderName ?? "unknown",
    snippet: message.snippet,
    receivedOn: message.receivedOn,
  });
  if (!result) return deterministic;

  // A positive rule match is strong evidence that this is application mail.
  // DeepSeek enriches it, but a single model disagreement cannot silently hide
  // a real application update. For rule gaps, the model owns the full result.
  const isCareerRelated = deterministic?.isCareerRelated ?? result.isCareerRelated;
  const trustAIFields = result.isCareerRelated && result.confidence >= 0.65;

  return {
    isCareerRelated,
    company: trustAIFields
      ? result.company ?? deterministic?.company ?? null
      : deterministic?.company ?? null,
    role: trustAIFields
      ? result.role ?? deterministic?.role ?? null
      : deterministic?.role ?? null,
    status: trustAIFields
      ? result.proposedStatus ?? deterministic?.status ?? null
      : deterministic?.status ?? null,
    // Only the deterministic parser may supply a deadline. The classifier is
    // not allowed to invent a date that would surface as a task in Today.
    deadline: deterministic?.deadline ?? null,
    confidence: deterministic
      ? Math.min(deterministic.confidence, result.confidence)
      : result.confidence,
    method: "ai",
    reasoning:
      deterministic && !result.isCareerRelated
        ? deterministic.reasoning
        : result.reasoning,
  };
}
