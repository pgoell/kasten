/**
 * Days between two dates, and how far off a due date reads on the overview.
 * Dates are `YYYY-MM-DD` in the vault's calendar, read at UTC midnight so daylight saving cannot move a count.
 */

const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Whole days from `from` to `to`, negative when `to` is the earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * How far off `due` is from `today`, in the words a row carries.
 * A week reads as its weekday, so no date needs working out. Past a fortnight the day and month say it.
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
 * An interval as the overview states it: days, then weeks, months and years, each taking over
 * where the next reads better. So a fortnight is `2w`, not `14d`, and a year is `1.4y`.
 */
export function intervalWords(days: number): string {
  // Again on a card in learning, which comes back in this sitting.
  if (days === 0) return "today";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
