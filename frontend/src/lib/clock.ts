/**
 * The wall clock in the status bar's shape. Spelled out, not from `toLocaleDateString`, so no
 * browser locale changes it.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_MS = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The ISO week of a date and the year it belongs to. A week belongs to the year holding its
 * Thursday, so 2027-01-01 is week 53 of 2026. Counted in UTC: a DST change moves no day.
 */
export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  // `getUTCDay` gives 0 on Sunday, which ISO calls day 7.
  const weekday = new Date(thursday).getUTCDay() || 7;
  const thisWeeksThursday = thursday + (4 - weekday) * DAY_MS;
  const year = new Date(thisWeeksThursday).getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);

  // Floor, not round: rounding a part-week up puts every week of the year one too high.
  return { year, week: Math.floor((thisWeeksThursday - yearStart) / DAY_MS / 7) + 1 };
}

/** A `YYYY-MM-DD` moved by whole days, in UTC, so a DST change cannot shift the day. */
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
