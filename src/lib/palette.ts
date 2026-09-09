import {
  Sun,
  Inbox,
  Briefcase,
  GraduationCap,
  HeartPulse,
  Wallet,
  Sprout,
  CheckSquare,
  Search,
  Fingerprint,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

/**
 * Where the command palette can take you, and what typing finds each one.
 *
 * Split out from the component so the matching is testable without a DOM, and
 * so the catalog is one obvious place to update when a section is added — the
 * sidebar and the palette drifting apart is the failure this prevents.
 *
 * `keywords` is deliberately what you would *type*, not what the section is
 * called: nobody searches "Growth" looking for LeetCode.
 */

export interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords: string;
}

export const DESTINATIONS: Destination[] = [
  { href: "/", label: "Today", icon: Sun, keywords: "home overview attention" },
  { href: "/inbox", label: "Inbox", icon: Inbox, keywords: "review confirm proposals" },
  { href: "/career", label: "Career", icon: Briefcase, keywords: "applications jobs pipeline" },
  { href: "/school", label: "School", icon: GraduationCap, keywords: "classes deadlines homework" },
  { href: "/health", label: "Health", icon: HeartPulse, keywords: "gym workout streak" },
  {
    href: "/money",
    label: "Money",
    icon: Wallet,
    keywords: "finance spending crypto recurring subscriptions",
  },
  { href: "/growth", label: "Growth", icon: Sprout, keywords: "leetcode practice heatmap" },
  { href: "/checklist", label: "Checklist", icon: CheckSquare, keywords: "habits daily todo" },
  { href: "/search", label: "Search", icon: Search, keywords: "find everything" },
  {
    href: "/security",
    label: "Security",
    icon: Fingerprint,
    keywords: "passkey face id touch id devices",
  },
  {
    href: "/setup",
    label: "Setup",
    icon: SlidersHorizontal,
    keywords: "config api key database timezone",
  },
];

/**
 * Substring, not fuzzy. Fuzzy matching turns a typo into a confident jump to
 * the wrong page, and there are eleven destinations — there is nothing here
 * that substring matching is too weak to find.
 */
export function matchDestinations(query: string): Destination[] {
  const q = query.trim().toLowerCase();
  if (!q) return DESTINATIONS;
  return DESTINATIONS.filter(
    (d) => d.label.toLowerCase().includes(q) || d.keywords.includes(q)
  );
}
