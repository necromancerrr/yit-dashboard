// All "what day is it" logic lives here.
//
// `new Date().toISOString().slice(0, 10)` looks like today's date but is
// actually the date in *UTC* — so logging a workout at 8pm in New York would
// have been filed under tomorrow, breaking the gym streak and putting the dot
// on the wrong heatmap square. These helpers use local calendar parts instead.
//
// "Local" on the server means the server's timezone, so set the `TZ` env var
// (e.g. TZ=America/New_York) wherever you deploy — otherwise the server rolls
// over to a new day at UTC midnight rather than yours.

/** Format a Date as YYYY-MM-DD using its local calendar date, not UTC. */
export function toISODate(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayISO(): string {
  return toISODate();
}

/** The local calendar date `n` days before today, as YYYY-MM-DD. */
export function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

/** Parse a YYYY-MM-DD string as local midnight (not UTC midnight). */
export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
