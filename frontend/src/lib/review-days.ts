/**
 * Days between two dates, and how far off a due date reads on the overview.
 *
 * Every date here is a `YYYY-MM-DD` in the vault's own calendar, so each one is
 * read at UTC midnight. Counting in local time would let a daylight saving change
 * shorten or stretch a day and move the answer by one.
 */

const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days from `from` to `to`, negative when `to` is the earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * How far off `due` is, from `today`, in the words a row carries.
 *
 * A week reads as its weekday, so the name answers the question "when is that"
 * without a date to work out. Past a fortnight the day and month say it, and the
 * year is named only when it is not this one.
 */
export function dayWords(due: string, today: string): string {
  const days = daysBetween(today, due);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  const at = new Date(`${due}T00:00:00Z`);
  const weekday = WEEKDAYS[at.getUTCDay()];
  if (days <= 6) return weekday ?? "";
  if (days <= 13) return `next ${weekday}`;
  const day = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  return due.slice(0, 4) === today.slice(0, 4) ? day : `${day} ${at.getUTCFullYear()}`;
}

/**
 * An interval as the overview states it: days, then weeks, months and years.
 *
 * Each unit takes over at the point the next one reads better, so a fortnight is
 * `2w` and not `14d`, and a year is `1.4y` where a count of days would be too long
 * to take in at a glance.
 */
export function intervalWords(days: number): string {
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
