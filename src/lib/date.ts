// All "what day is it" logic lives here.
//
// `new Date().toISOString().slice(0, 10)` looks like today's date but is
// actually the date in *UTC* — so logging a workout at 8pm in New York would
// be filed under tomorrow, breaking the gym streak and putting the dot on the
// wrong heatmap square.
//
// The obvious fix is to read the server's local date, but the server's clock
// is not something you can always control: Vercel runs functions in UTC and
// *reserves* the `TZ` variable, so you cannot override it there. Instead the
// day is resolved against an explicitly named zone, `APP_TIMEZONE`
// (e.g. "America/New_York"), which works on any host. Unset it and the
// machine's own timezone is used, which is the right default locally and in
// Docker.

const RAW_TIMEZONE = process.env.APP_TIMEZONE?.trim();

/** `undefined` means "use the machine's local timezone". */
const TIME_ZONE: string | undefined = (() => {
  if (!RAW_TIMEZONE) return undefined;
  try {
    // Throws RangeError on an unknown zone. Better to find out once, at module
    // load, than on every request.
    new Intl.DateTimeFormat("en-CA", { timeZone: RAW_TIMEZONE });
    return RAW_TIMEZONE;
  } catch {
    console.warn(
      `APP_TIMEZONE="${RAW_TIMEZONE}" is not a recognized IANA timezone; falling back to the server's local time.`
    );
    return undefined;
  }
})();

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (n: number) => String(n).padStart(2, "0");

/** Format an instant as YYYY-MM-DD in the configured zone, never in UTC. */
export function toISODate(date: Date = new Date()): string {
  // Assembled from parts rather than trusting the locale's ordering.
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

/** Today's date as YYYY-MM-DD in the configured zone. */
export function todayISO(): string {
  return toISODate();
}

/**
 * Move a YYYY-MM-DD string by a whole number of days.
 *
 * Done as pure calendar arithmetic in UTC space rather than by adding hours to
 * an instant, so a day that is 23 or 25 hours long across a daylight-saving
 * boundary still counts as exactly one day.
 */
export function shiftISODate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** The date `n` days before today, as YYYY-MM-DD. */
export function daysAgoISO(n: number): string {
  return shiftISODate(todayISO(), -n);
}

/** Parse a YYYY-MM-DD string as local midnight (not UTC midnight). */
export function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
