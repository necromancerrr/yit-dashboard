// Single source of truth for the personalized bits of the UI (name shown in
// the greeting, nav, login screen, page title, and the generated app icons).
// Configure via NEXT_PUBLIC_DISPLAY_NAME so one env var drives everywhere —
// no name hardcoded in components.

export function getDisplayName(): string {
  return process.env.NEXT_PUBLIC_DISPLAY_NAME?.trim() || "You";
}

export function getBrandName(): string {
  const name = getDisplayName();
  return name === "You" ? "Your Dashboard" : `${name}'s Dashboard`;
}

export function getInitial(): string {
  const name = getDisplayName();
  return name.charAt(0).toUpperCase();
}
