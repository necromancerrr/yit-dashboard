/**
 * The client-safe shape of a trust rule.
 *
 * `trust.ts` imports the database; a client component importing it drags Node
 * built-ins into the browser bundle and fails the build outright. Same reason
 * `digest-types.ts` and `search-types.ts` exist.
 */

export type RuleMode = "ask" | "auto" | "never";

export interface RuleVerdict {
  trusted: boolean;
  /** Confirmations still standing today, after lapse. */
  standing: number;
  needed: number;
  /** The same sentence the pipeline enforced. */
  reason: string;
}

export interface AutomationRuleView {
  id: number;
  domain: string;
  scopeKey: string;
  confirms: number;
  corrections: number;
  mode: RuleMode;
  lastConfirmedAt: string | null;
  lastAppliedAt: string | null;
  verdict: RuleVerdict;
}
