/**
 * The weeks the search histogram counts lines into, and the dates that place a
 * line in one of them.
 *
 * Weeks are ISO weeks named the way the weekly notes are, so a bar and the note
 * behind it carry the same name. The counting is `isoWeek`'s, which reads the
 * calendar day of a `YYYY-MM-DD` rather than the instant it parses to.
 */

import { isoWeek } from "@/lib/clock";

/** How many bars the histogram draws. */
export const WEEKS = 14;

/** An ISO week as the weekly notes name it, `2026-W38`. */
export type WeekKey = string;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The week a local calendar day falls in, named as the weekly notes name it. */
function keyOf(day: Date): WeekKey {
  const { year, week } = isoWeek(day);
  return `${year}-W${pad(week)}`;
}

/**
 * The ISO week of a date, or nothing where the string is neither.
 *
 * A `YYYY-MM-DD` is the day it names, whatever the zone. An instant with an
 * offset is read as the reader's own day: the server cannot know the zone, so a
 * late Sunday in UTC is Monday in Berlin, and the bar it counts in is the Berlin one.
 */
export function weekOf(date: string): WeekKey | undefined {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!found) {
    const at = new Date(date);
    return Number.isNaN(at.getTime()) ? undefined : keyOf(at);
  }
  const [year, month, day] = found.slice(1).map(Number) as [number, number, number];
  // Built from local parts, the way `isoWeek` reads its date. Reading back the
  // parts catches the days a calendar does not have, such as February the 30th,
  // which the Date constructor would otherwise roll into March.
  const at = new Date(year, month - 1, day);
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) {
    return undefined;
  }
  return keyOf(at);
}

/**
 * The last `count` weeks, oldest first, with the week holding `now` last.
 *
 * Stepped back a week at a time from `now`'s own day, so a year boundary needs no
 * case of its own: each step lands on a day `isoWeek` already knows how to name.
 */
export function lastWeeks(now: Date, count: number = WEEKS): WeekKey[] {
  const weeks: WeekKey[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back * 7);
    weeks.push(keyOf(day));
  }
  return weeks;
}

/** The number in a week's name, `38` for `2026-W38`. */
export function weekNumber(week: WeekKey): number {
  return Number(week.slice(-2));
}

/**
 * The week a value names, or nothing where it names none.
 *
 * The week has to exist in its year: a year has 53 weeks only when it is one of
 * the long years, and the last of them always holds the 28th of December.
 */
export function parseWeek(value: unknown): WeekKey | undefined {
  if (typeof value !== "string") return undefined;
  const found = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(value);
  if (!found) return undefined;
  const year = Number(found[1]);
  const week = Number(found[2]);
  const weeksInYear = isoWeek(new Date(year, 11, 28)).week;
  return week <= weeksInYear ? value : undefined;
}

/**
 * The Monday to Sunday a week covers, in words.
 *
 * Written with the word `to` rather than a dash, so the range reads the same
 * whatever the dash would have joined.
 */
export function weekRange(week: WeekKey): string {
  const year = Number(week.slice(0, 4));
  // The first week of a year is the one holding its 4th of January, so counting
  // from that Monday gives the Monday of any week in the year.
  const jan4 = new Date(year, 0, 4);
  const firstMonday = 4 - ((jan4.getDay() || 7) - 1);
  const monday = new Date(year, 0, firstMonday + (weekNumber(week) - 1) * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

  const from = `${monday.getDate()} ${MONTHS[monday.getMonth()]}`;
  const until = `${sunday.getDate()} ${MONTHS[sunday.getMonth()]} ${sunday.getFullYear()}`;
  if (monday.getFullYear() !== sunday.getFullYear()) {
    return `${from} ${monday.getFullYear()} to ${until}`;
  }
  if (monday.getMonth() !== sunday.getMonth()) {
    return `${from} to ${until}`;
  }
  return `${monday.getDate()} to ${until}`;
}

/**
 * One count per week, in the order the weeks are given. A date outside them, or
 * missing, counts in none.
 */
export function linesPerWeek(dates: (string | null | undefined)[], weeks: WeekKey[]): number[] {
  const counts = new Map<WeekKey, number>();
  for (const date of dates) {
    if (!date) continue;
    const week = weekOf(date);
    if (week === undefined) continue;
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }
  return weeks.map((week) => counts.get(week) ?? 0);
}
