/**
 * A recurrence read off a line, and the copy a tick of it writes.
 *
 * The obsidian-tasks grammar cut to what kasten writes back: `every day`,
 * `every 3 weeks`, and the `when done` suffix. A rule this cannot read stays on
 * the line as text, which is what makes a typo visible rather than lost.
 */

import { shiftDay } from "@/lib/clock";
import type { Todo } from "@/lib/todo";

export interface Recurrence {
  /** How many units on. One where the text names no number. */
  every: number;
  unit: "day" | "week" | "month" | "year";
  /** Count the next date from the day it was done rather than from the date it carried. */
  whenDone: boolean;
}

const RULE = /^every[ \t]+(?:(\d+)[ \t]+)?(day|week|month|year)s?(?:[ \t]+(when done))?$/;

const DAY_MS = 86_400_000;

/** `every week`, `every 3 days`, `every month when done`. Null where it does not parse. */
export function parseRecurrence(text: string): Recurrence | null {
  const found = RULE.exec(text.trim());
  if (found === null) return null;

  return {
    every: found[1] === undefined ? 1 : Number(found[1]),
    unit: found[2] as Recurrence["unit"],
    whenDone: found[3] !== undefined,
  };
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * `date` one period on.
 *
 * Built from calendar parts rather than by adding milliseconds, the way
 * `periodic.ts` builds its own, and clamped to the last day of the month where
 * the day does not exist: the thirty-first of January one month on is the
 * twenty-eighth of February, not the third of March.
 */
export function nextDate(date: string, rule: Recurrence): string {
  if (rule.unit === "day") return shiftDay(date, rule.every);
  if (rule.unit === "week") return shiftDay(date, rule.every * 7);

  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const months = month - 1 + (rule.unit === "month" ? rule.every : rule.every * 12);
  const onYear = year + Math.floor(months / 12);
  const onMonth = (months % 12) + 1;
  // Day zero of the month after is the last day of this one, which is where a
  // thirty-first lands in a month that has thirty.
  const last = new Date(Date.UTC(onYear, onMonth, 0)).getUTCDate();

  return `${onYear}-${pad(onMonth)}-${pad(Math.min(day, last))}`;
}

/** Whole days from one date to another, both read in UTC as `shiftDay` reads them. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/**
 * The fresh copy a tick of a recurring todo writes above the completed line.
 *
 * Null where the todo does not recur, or carries no date to count from: there
 * would be nothing to count from, and a copy with no date is the same todo
 * written twice. Every date it does carry moves by the same number of days, so
 * the gaps between due, scheduled and start survive the period.
 */
export function nextOccurrence(todo: Todo, today: string): Todo | null {
  const rule = parseRecurrence(todo.recurrence ?? "");
  if (rule === null) return null;

  const anchor = todo.due ?? todo.scheduled ?? todo.start;
  if (anchor === undefined) return null;

  const shift = daysBetween(anchor, nextDate(rule.whenDone ? today : anchor, rule));
  const move = (date: string | undefined) =>
    date === undefined ? undefined : shiftDay(date, shift);

  return {
    ...todo,
    state: "open",
    due: move(todo.due),
    scheduled: move(todo.scheduled),
    start: move(todo.start),
    // The id names the instance that was finished, which the done log links to,
    // and the two clocks belong to it as well. The created date stays: it is
    // the recurrence's own birthday and reads as such.
    done: undefined,
    cancelled: undefined,
    id: undefined,
    worked: undefined,
  };
}
