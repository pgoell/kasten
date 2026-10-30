/**
 * The notes named for a stretch of time: a day sits in a week, a week in a month, a month in a
 * quarter, a quarter in a year. Links are written whether or not the notes exist; the editor draws
 * a missing one dotted and `gf` creates it, so one key walks the chain it made.
 */

import { isoWeek, readClock, shiftDay } from "@/lib/clock";
import { PERIODIC } from "@/lib/layout";

export type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

/** The folder each kind lives in, under the periodic folder. The numbers keep the vault's order. */
const FOLDER: Record<Period, string> = {
  daily: "00 Daily",
  weekly: "01 Weekly",
  monthly: "02 Monthly",
  quarterly: "03 Quarterly",
  yearly: "04 Yearly",
};

/** The folder holding one kind, read at call time so the served layout counts. */
function folder(period: Period): string {
  return `${PERIODIC}/${FOLDER[period]}`;
}

/** The day a daily note is named for, or null where the path is not one. */
export function dailyDate(path: string): string | null {
  const inside = insideFolder("daily", path);
  if (inside === null) return null;
  return /^(\d{4}-\d{2}-\d{2})\.md$/.exec(inside)?.[1] ?? null;
}

/**
 * The part of `path` after one kind's folder, or null where it is not inside. Compared as text,
 * since a folder name may hold a `.` or `(` that a pattern would read as regex.
 */
function insideFolder(period: Period, path: string): string | null {
  const prefix = `${folder(period)}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The year a yearly note is named for, or null where the path is not `YYYY.md` in that folder. */
export function yearlyYear(path: string): number | null {
  const inside = insideFolder("yearly", path);
  const found = inside === null ? null : /^(\d{4})\.md$/.exec(inside);
  return found === null ? null : Number(found[1]);
}

/**
 * The ISO week a weekly note is named for, with its Monday and Sunday, or null where the name is
 * not a real week of that year. The Thursday check refuses `W00` and a `W53` in a 52-week year.
 */
export function weeklyWeek(
  path: string,
): { year: number; week: number; monday: string; sunday: string } | null {
  const inside = insideFolder("weekly", path);
  const found = inside === null ? null : /^(\d{4})-W(\d{2})\.md$/.exec(inside);
  if (found === null) return null;
  const jan4 = `${found[1]}-01-04`;
  const weekday = new Date(`${jan4}T00:00:00Z`).getUTCDay() || 7;
  const week = Number(found[2]);
  const monday = shiftDay(jan4, 1 - weekday + (week - 1) * 7);
  if (shiftDay(monday, 3).slice(0, 4) !== found[1]) return null;
  return { year: Number(found[1]), week, monday, sunday: shiftDay(monday, 6) };
}

/** What holds each kind, which the note links up to. A year is held by nothing. */
const ABOVE: Record<Period, Period | null> = {
  daily: "weekly",
  weekly: "monthly",
  monthly: "quarterly",
  quarterly: "yearly",
  yearly: null,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The day one step of `period` away. Built from calendar parts, since adding milliseconds can land
 * on the day before across a daylight saving change. Larger periods step to the 1st of the month.
 */
function step(period: Period, date: Date, by: number): Date {
  const year = date.getFullYear();
  const month = date.getMonth();

  switch (period) {
    case "daily":
      return new Date(year, month, date.getDate() + by);
    case "weekly":
      return new Date(year, month, date.getDate() + by * 7);
    case "monthly":
      return new Date(year, month + by, 1);
    case "quarterly":
      return new Date(year, month + by * 3, 1);
    case "yearly":
      return new Date(year + by, 0, 1);
  }
}

/** The Thursday of the week the date is in, which is the day ISO counts weeks by. */
function thursday(date: Date): Date {
  // `getDay` is 0 on Sunday, which ISO calls day 7 and the end of the week.
  const weekday = date.getDay() || 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 4 - weekday);
}

function name(period: Period, date: Date): string {
  switch (period) {
    case "daily":
      return readClock(date).date;
    case "weekly": {
      const { year, week } = isoWeek(date);
      return `${year}-W${pad(week)}`;
    }
    case "monthly":
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
    case "quarterly":
      return `${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`;
    case "yearly":
      return String(date.getFullYear());
  }
}

function link(period: Period, date: Date): string {
  return `[[${folder(period)}/${name(period, date)}]]`;
}

/** Where the note covering `now` lives, and the text it starts life with. */
export function periodicNote(period: Period, now: Date): { path: string; body: string } {
  const above = ABOVE[period];
  // The weekday: the vault's daily notes have always carried it.
  const heading =
    period === "daily" ? `${name(period, now)} ${readClock(now).weekday}` : name(period, now);

  const nav = [link(period, step(period, now, -1))];
  if (above !== null) {
    // A week's month is that of its Thursday, as ISO counts weeks by Thursday.
    nav.push(link(above, period === "weekly" ? thursday(now) : now));
  }
  nav.push(link(period, step(period, now, 1)));

  // Only the day gets a TODOs section, the add prompt's target. Empty headings would clutter
  // every unused week; `## Done` and `## Time` come with their writes.
  const todos = period === "daily" ? "\n## TODOs\n" : "";

  // The backend reads the block only at the first line, so the template keeps the fence there.
  return {
    path: `${folder(period)}/${name(period, now)}.md`,
    body: `---\ntype: Periodic Note\n---\n\n# ${heading}\n\n${nav.join(" | ")}\n${todos}`,
  };
}
