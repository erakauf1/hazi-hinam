import { HaziHinamError } from "./errors.js";

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, "ראשון": 0,
  monday: 1, mon: 1, "שני": 1,
  tuesday: 2, tue: 2, "שלישי": 2,
  wednesday: 3, wed: 3, "רביעי": 3,
  thursday: 4, thu: 4, "חמישי": 4,
  friday: 5, fri: 5, "שישי": 5,
  saturday: 6, sat: 6, "שבת": 6,
};

export function parseSiteDate(date: string): string {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new HaziHinamError("BAD_DATE", `Unexpected date format from the site: "${date}"`);
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

export function todayInIsrael(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(now);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A weekday returns the next two occurrences: "next Thursday" said on a Tuesday can mean either one,
// so the caller shows both and lets the user choose.
export function resolveDay(input: string, now: Date): string[] {
  const text = input.trim().toLowerCase().replace(/^(next|this|יום)\s+/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return [text];
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) return [parseSiteDate(text)];

  const weekday = Object.hasOwn(WEEKDAYS, text) ? WEEKDAYS[text] : undefined;
  if (weekday === undefined) {
    throw new HaziHinamError("BAD_DATE", `Unrecognized day "${input}". Use a weekday name or a date like 2026-10-08.`);
  }
  const today = todayInIsrael(now);
  const todayWeekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const first = addDays(today, (weekday - todayWeekday + 7) % 7 || 7);
  return [first, addDays(first, 7)];
}
