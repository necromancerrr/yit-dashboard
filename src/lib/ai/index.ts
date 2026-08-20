import type { AIProvider } from "@/lib/ai/types";
import { AnthropicProvider } from "@/lib/ai/anthropic";
import { DeepSeekProvider } from "@/lib/ai/deepseek";

export type { AIProvider } from "@/lib/ai/types";

/**
 * Resolve the configured AI provider, or null when none is usable.
 *
 * Provider choice is configuration (`AI_PROVIDER`), never a hardcoded call
 * site — nothing outside this folder should import a vendor SDK. Adding a
 * vendor means adding a class that satisfies AIProvider and a case here; no
 * feature code changes.
 *
 * Returning null when unconfigured is the point: every caller must already
 * handle "no AI available", so the dashboard works fully without a key.
 *
 * Server-only. There is no client-side path to this module, and no provider
 * key is ever exposed to the browser.
 */
export function getAIProvider(): AIProvider | null {
  const configured = (process.env.AI_PROVIDER ?? "deepseek").toLowerCase();

  switch (configured) {
    case "none":
      return null;
    case "deepseek":
      return process.env.DEEPSEEK_API_KEY ? new DeepSeekProvider() : null;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? new AnthropicProvider() : null;
    default:
      console.warn(`AI_PROVIDER="${configured}" is not a known provider; AI features are off.`);
      return null;
  }
}

/** Whether any AI feature can run right now. Cheap enough to call per request. */
export function isAIConfigured(): boolean {
  return getAIProvider() !== null;
}
