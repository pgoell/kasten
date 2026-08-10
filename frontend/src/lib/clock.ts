/**
 * The wall clock, in the shape the status bar shows it.
 *
 * Spelled out here rather than left to `toLocaleDateString`, so the strip reads
 * the same whatever locale the browser is set to, and the date matches the
 * shape the daily notes are named in.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The ISO 8601 week the date falls in, and the year that week belongs to.
 *
 * A week belongs to the year holding its Thursday, which is why this counts
 * from that Thursday rather than from the first of January. Without it the last
 * days of December and the first of January land in the wrong week, and both
 * happen every few years. That is also why the year comes back beside the
 * number: 2027-01-01 sits in the 53rd week of 2026, and the note named for that
 * week is `2026-W53`. The strip shows the number alone.
 *
 * Done in UTC so a daylight saving change cannot shorten one of the days being
 * counted and drag the division a week off.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // `getUTCDay` is 0 on Sunday, which ISO calls day 7 and the end of the week.
  const weekday = new Date(thursday).getUTCDay() || 7;
  const thisWeeksThursday = thursday + (4 - weekday) * DAY_MS;
  const year = new Date(thisWeeksThursday).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);

  // Floor, not round. The first of the ISO year is rarely a Thursday, so the
  // gap between it and this week's Thursday is rarely a whole number of weeks,
  // and rounding a part-week up puts every week of that year one too high.
  return { year, week: Math.floor((thisWeeksThursday - yearStart) / DAY_MS / 7) + 1 };
}

/**
 * A `YYYY-MM-DD` moved by whole days.
 *
 * UTC throughout, so the hour a daylight saving change takes away cannot land
 * the answer on the day before, which is the same care `isoWeek` takes above.
 */
export function shiftDay(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export interface Clock {
  weekday: string;
  /** ISO 8601, the shape the vault names its daily notes in. */
  date: string;
  /** The ISO week, which is the one people mean by "CW". */
  week: number;
  /** 24 hour, because the bar has no room to spend on am and pm. */
  time: string;
}

export function readClock(now: Date): Clock {
  return {
    weekday: WEEKDAYS[now.getDay()] ?? "",
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    week: isoWeek(now).week,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}
