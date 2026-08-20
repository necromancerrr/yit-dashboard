/**
 * Turning raw message headers into something comparable.
 *
 * All of this is deliberately boring string work rather than model calls: a
 * forwarded subject line is a solved problem, and spending a model round trip
 * on it would be slower, cost money, and occasionally get it wrong.
 */

/** How much of a message body we are ever willing to keep. */
export const MAX_SNIPPET_LENGTH = 300;

const FORWARD_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|rv|enc)\s*(?:\[\d+\])?\s*:\s*)+/i;

/**
 * Strip any depth of Re:/Fwd: prefixes.
 *
 * You forward your own recruiting mail, and mail clients stack prefixes
 * ("Fwd: Re: Fwd:"). Left alone, the same message reads as a different subject
 * each hop and classification rules anchored on the subject stop matching.
 */
export function stripForwardPrefixes(subject: string): string {
  let previous: string;
  let current = subject.trim();
  do {
    previous = current;
    current = current.replace(FORWARD_PREFIX, "").trim();
  } while (current !== previous);
  return current;
}

/** Split `Jane Doe <jane@corp.com>` into its parts. Either may be missing. */
export function parseSender(raw: string): { name: string | null; email: string | null } {
  const angled = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, "").trim();
    return { name: name || null, email: angled[2].trim().toLowerCase() || null };
  }
  const bare = raw.trim();
  if (bare.includes("@")) return { name: null, email: bare.toLowerCase() };
  return { name: bare || null, email: null };
}

/** Domains that say nothing about which company sent the mail. */
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com",
  "icloud.com", "protonmail.com", "me.com", "aol.com",
]);

/** Applicant tracking systems: the sender domain is the vendor, not the employer. */
const ATS_DOMAINS = new Set([
  "greenhouse.io", "us.greenhouse-mail.io", "myworkday.com", "myworkdayjobs.com",
  "lever.co", "hire.lever.co", "ashbyhq.com", "smartrecruiters.com", "icims.com",
  "taleo.net", "successfactors.com", "jobvite.com", "workable.com", "hackerrank.com",
  "codility.com", "hackerearth.com", "karat.io", "codesignal.com",
]);

/** The registrable-ish domain, dropping common mail subdomains. */
export function senderDomain(email: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  const domain = email.split("@").pop()!.toLowerCase();
  return domain.replace(/^(?:mail|email|e|smtp|notifications?|no-?reply|careers|jobs)\./, "");
}

export function isGenericDomain(domain: string | null): boolean {
  return !!domain && GENERIC_DOMAINS.has(domain);
}

/**
 * Whether the sender is an ATS or assessment vendor.
 *
 * These matter because the domain is useless for identifying the employer —
 * a Greenhouse address tells you the message is recruiting mail, and nothing
 * about who is hiring. The company has to come from the subject or body text.
 */
export function isATSDomain(domain: string | null): boolean {
  if (!domain) return false;
  if (ATS_DOMAINS.has(domain)) return true;
  // Sub-domained tenants: acme.greenhouse.io, acme.myworkday.com
  return [...ATS_DOMAINS].some((ats) => domain.endsWith(`.${ats}`));
}

const COMPANY_SUFFIXES =
  /\s*(?:,?\s*(?:inc|llc|ltd|limited|corp|corporation|co|plc|gmbh|group|holdings|technologies|technology|labs|software|systems)\b\.?)+$/i;

/**
 * Reduce a company name to something two spellings of it agree on.
 *
 * "Goldman Sachs & Co." and "Goldman Sachs" must land on the same key, or the
 * same employer becomes two applications and the pipeline silently forks.
 */
export function normalizeCompany(name: string): string {
  return (
    name
      .replace(/&/g, " and ")
      .replace(COMPANY_SUFFIXES, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      // "Goldman Sachs & Co." loses its suffix and would otherwise keep the
      // conjunction that joined it, leaving "goldman sachs and".
      .replace(/\s+and$/, "")
  );
}

/** A company guess from the sender domain, e.g. goldmansachs.com -> goldmansachs. */
export function companyFromDomain(domain: string | null): string | null {
  if (!domain || isGenericDomain(domain) || isATSDomain(domain)) return null;
  const label = domain.split(".")[0];
  return label && label.length > 1 ? label : null;
}

/** Clamp a body excerpt to the maximum we are willing to store. */
export function truncateSnippet(text: string, max = MAX_SNIPPET_LENGTH): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}
