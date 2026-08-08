/**
 * The notes named for a stretch of time rather than for a subject.
 *
 * Five of them, each holding the one below it: a day sits in a week, a week in
 * a month, a month in a quarter, a quarter in a year. A leader key opens the
 * one covering today and this says where it lives and what it starts with.
 *
 * The links are written whether or not the notes on either side exist yet.
 * Tomorrow's note is a note nobody has written, which the editor draws dotted
 * and `gf` turns into a note, so one key made yesterday's chain and the same
 * key walks it. Nothing goes back to rewrite the note behind: a note this made
 * already carries both directions.
 */

import { isoWeek, readClock } from "@/lib/clock";

export type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

const ROOT = "01 Periodic";

/** Where each kind lives. The numbers order the folders the way the vault does. */
const FOLDER: Record<Period, string> = {
  daily: `${ROOT}/00 Daily`,
  weekly: `${ROOT}/01 Weekly`,
  monthly: `${ROOT}/02 Monthly`,
  quarterly: `${ROOT}/03 Quarterly`,
  yearly: `${ROOT}/04 Yearly`,
};

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
 * The day one step of `period` away, forwards or back.
 *
 * Built from calendar parts rather than by adding milliseconds, so the hour a
 * daylight saving change takes away cannot land the answer on the day before.
 * The larger periods step to the first of a month because only the year, the
 * month and the quarter are read back off them.
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

/** What the note is called, which is the whole of its filename. */
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

/** A `[[link]]` to one periodic note, spelled as the path it is. */
function link(period: Period, date: Date): string {
  return `[[${FOLDER[period]}/${name(period, date)}]]`;
}

/** Where the note covering `now` lives, and the text it starts life with. */
export function periodicNote(period: Period, now: Date): { path: string; body: string } {
  const above = ABOVE[period];
  // The weekday, because a date alone says nothing about which day it was and
  // the vault's daily notes have carried it from the start.
  const heading =
    period === "daily" ? `${name(period, now)} ${readClock(now).weekday}` : name(period, now);

  const nav = [link(period, step(period, now, -1))];
  if (above !== null) {
    // The month over a week is the month of that week's Thursday, for the
    // reason the week itself is counted from one: the days on either side of
    // New Year belong to the week, and so to the month, on the other side.
    nav.push(link(above, period === "weekly" ? thursday(now) : now));
  }
  nav.push(link(period, step(period, now, 1)));

  return {
    path: `${FOLDER[period]}/${name(period, now)}.md`,
    body: `# ${heading}\n\n${nav.join(" | ")}\n`,
  };
}
