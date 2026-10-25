/**
 * The numbers the overview's cards show, worked out from what the vault holds: the
 * review days off the flashcard schedules, the todos done by their `✅` date, and the
 * notes written by the day each one counts on. Pure, so the pane passes in what the
 * reads answered and each rule here is checked on plain input.
 */

import type { LineHit, TodoHit } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import { isOpen, parseTodo } from "@/lib/todo";
import { sectionOf } from "@/lib/todo-view";

const DAY_MS = 86_400_000;

/**
 * One schedule comment on a line: a plain card's `<!--SR:!due,interval,ease-->` or a
 * cloze's `<!--SR:cN!due,interval,ease-->`. Global, because a cloze line holds one per number.
 */
const SCHEDULE = /<!--SR:(?:c\d+)?!(\d{4}-\d{2}-\d{2}),(\d+),\d+-->/g;

/** One bar of a chart: where it stands in the range, and its value. */
export interface Bar {
  index: number;
  amount: number;
}

/** The `days` days ending on `today`, oldest first, today last. */
export function daysBack(today: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => shiftDay(today, index + 1 - days));
}

/** One bar per day of `days`, a day with no count standing at zero. */
export function barsOf(days: string[], counts: Map<string, number>): Bar[] {
  return days.map((day, index) => ({ index, amount: counts.get(day) ?? 0 }));
}

/** Adds one to a day's count. */
function tally(counts: Map<string, number>, day: string, by = 1): void {
  counts.set(day, (counts.get(day) ?? 0) + by);
}

/**
 * How many days in a row `counted` holds, back from today. Today with nothing yet is
 * skipped rather than read as the break, so a streak does not drop to zero in the morning.
 */
export function runOf(counted: (day: string) => boolean, today: string): number {
  let day = counted(today) ? today : shiftDay(today, -1);
  let run = 0;
  while (counted(day)) {
    run += 1;
    day = shiftDay(day, -1);
  }
  return run;
}

/**
 * The day each card's last rating fell on, and how many cards that was. A rating writes
 * the due date as the rating's day plus the interval, so the day is the due date less the
 * interval. Every schedule on a line counts, a cloze's included, and a parked card too.
 */
export function reviewCounts(hits: LineHit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    for (const [, due = "", interval = "0"] of hit.text.matchAll(SCHEDULE)) {
      tally(counts, shiftDay(due, -Number(interval)));
    }
  }
  return counts;
}

/** The todos whose `[x]` line carries a `✅` date, counted on that date. */
export function doneCounts(todos: TodoHit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const hit of todos) {
    const todo = parseTodo(hit.text);
    if (todo?.state === "done" && todo.done !== undefined) tally(counts, todo.done);
  }
  return counts;
}

/** How many todos are open, and how many of those are overdue, today. */
export function todoTally(todos: TodoHit[], today: string): { open: number; overdue: number } {
  let open = 0;
  let overdue = 0;
  for (const hit of todos) {
    const todo = parseTodo(hit.text);
    if (todo === null || !isOpen(todo)) continue;
    open += 1;
    if (sectionOf(todo, today) === "overdue") overdue += 1;
  }
  return { open, overdue };
}

/**
 * The day each note counts on, as `GET /api/written` answers it. A `YYYY-MM-DD` is that
 * day; an instant is the reader's own local day, read the way `readClock` reads one.
 */
export function writtenCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    tally(counts, /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : readClock(new Date(value)).date);
  }
  return counts;
}

/** The notes written this year, and the days this year has had so far, today included. */
export function yearTally(
  counts: Map<string, number>,
  today: string,
): { total: number; onDays: number; days: number } {
  const year = today.slice(0, 4);
  let total = 0;
  let onDays = 0;
  for (const [day, count] of counts) {
    if (!day.startsWith(`${year}-`)) continue;
    total += count;
    onDays += 1;
  }
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - start) / DAY_MS) + 1;
  return { total, onDays, days };
}
