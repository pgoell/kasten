/**
 * The year review's numbers, worked out from what the vault holds over one stretch of
 * days: the todos done and the time on them, the notes written and the projects they
 * sit in, the tags, the flashcards and the log days. Pure, as `overview.ts` is, so the
 * block passes in what the reads answered and each rule here is checked on plain input.
 */

import type { LineHit, TodoHit } from "@/lib/api";
import type { LogDay } from "@/lib/log/food-api";
import { dayOf, reviewCounts, writtenCounts } from "@/lib/overview";
import { parseTodo, type Todo } from "@/lib/todo/todo";
import { parseDuration } from "@/lib/todo/todo-time";

/** One note `GET /api/written/notes` answers, with the day it counts on. */
export interface WrittenNote {
  path: string;
  /** A `YYYY-MM-DD`, or an instant, as `GET /api/written` answers. */
  day: string;
  tags: string[];
  project: string | null;
}

/** Whether a `YYYY-MM-DD` falls from `from` to `to`, both included. ISO days order as text. */
export function inRange(day: string, from: string, to: string): boolean {
  return day >= from && day <= to;
}

/** Ascending order of two strings, by code point rather than by locale, so a sort reads the same everywhere. */
export function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The days a year review covers: Jan 1 to Dec 31 of a past year, Jan 1 to today of this one, none of a year not begun. */
export function yearRange(year: number, today: string): { from: string; to: string } | null {
  const current = Number(today.slice(0, 4));
  if (year > current) return null;
  return { from: `${year}-01-01`, to: year === current ? today : `${year}-12-31` };
}

/** A todo ticked done in the range, with its record and its `✅` date. */
export interface DoneTodo {
  hit: TodoHit;
  todo: Todo;
  done: string;
}

/**
 * The todos whose `[x]` line carries a `✅` date in the range. A todo with a `⏱` and
 * no `✅` is not done, so it is left out.
 */
export function doneTodos(todos: TodoHit[], from: string, to: string): DoneTodo[] {
  const found: DoneTodo[] = [];
  for (const hit of todos) {
    const todo = parseTodo(hit.text);
    if (todo === null || todo.state !== "done" || todo.done === undefined) continue;
    if (!inRange(todo.done, from, to)) continue;
    found.push({ hit, todo, done: todo.done });
  }
  return found;
}

/** The minutes a todo's `⏱` says, or none where it has none the parser reads. */
function minutesOf(todo: Todo): number {
  return parseDuration(todo.worked ?? "") ?? 0;
}

export interface ProjectRow {
  project: string;
  /** The folder's last part, `FDE` for `02 Projects/FDE`. */
  name: string;
  done: number;
  minutes: number;
  notes: number;
}

/**
 * One row per project with a todo done in the range or a note written in it, sorted by
 * minutes, then done todos, then notes, all most first, then by name. Todos and notes
 * with no project make no row.
 */
export function projectRows(
  todos: TodoHit[],
  notes: WrittenNote[],
  from: string,
  to: string,
): ProjectRow[] {
  const rows = new Map<string, { done: number; minutes: number; notes: number }>();
  const rowOf = (project: string) => {
    const found = rows.get(project) ?? { done: 0, minutes: 0, notes: 0 };
    rows.set(project, found);
    return found;
  };

  for (const { hit, todo } of doneTodos(todos, from, to)) {
    if (hit.project === null) continue;
    const found = rowOf(hit.project);
    found.done += 1;
    found.minutes += minutesOf(todo);
  }
  for (const note of notes) {
    if (note.project === null || !inRange(dayOf(note.day), from, to)) continue;
    rowOf(note.project).notes += 1;
  }

  return [...rows]
    .map(([project, found]) => ({
      project,
      name: project.slice(project.lastIndexOf("/") + 1),
      ...found,
    }))
    .sort(
      (a, b) =>
        b.minutes - a.minutes || b.done - a.done || b.notes - a.notes || byText(a.name, b.name),
    );
}

/**
 * The notes written in each month of `year` up to `to`, twelve numbers from January. A note
 * counts on the day `dayOf` gives it, so an instant near midnight lands in the reader's month.
 * `to` is the last day counted, so a note made ahead (tomorrow's daily note) is left out the
 * way Notes made leaves it out.
 */
export function monthCounts(written: string[], year: number, to: string): number[] {
  const counts = new Map<string, number>();
  for (const [day, count] of writtenCounts(written)) {
    if (!inRange(day, `${year}-01-01`, to)) continue;
    const month = day.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + count);
  }
  return Array.from(
    { length: 12 },
    (_, index) => counts.get(`${year}-${String(index + 1).padStart(2, "0")}`) ?? 0,
  );
}

/**
 * How many notes in the range carry each tag, most first and ties by tag. A tag a note
 * repeats counts once for that note.
 */
export function topTags(
  notes: WrittenNote[],
  from: string,
  to: string,
  limit = 10,
): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const note of notes) {
    if (!inRange(dayOf(note.day), from, to)) continue;
    for (const tag of new Set(note.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || byText(a.tag, b.tag))
    .slice(0, limit);
}

/** The numbers beside the year review's charts. */
export interface YearNumbers {
  todosDone: number;
  minutes: number;
  notes: number;
  flashcards: number;
  daysLogged: number;
}

/**
 * The year's numbers over `from` to `to`. Flashcards are a lower bound: `reviewCounts`
 * counts each card once, on the day of its last rating, so a card reviewed earlier in
 * the range and rated again after it is missed.
 */
export function yearNumbers(input: {
  todos: TodoHit[];
  written: string[];
  cards: LineHit[];
  days: LogDay[];
  from: string;
  to: string;
}): YearNumbers {
  const { todos, written, cards, days, from, to } = input;
  const done = doneTodos(todos, from, to);

  let flashcards = 0;
  for (const [day, count] of reviewCounts(cards)) {
    if (inRange(day, from, to)) flashcards += count;
  }

  return {
    todosDone: done.length,
    minutes: done.reduce((sum, { todo }) => sum + minutesOf(todo), 0),
    notes: written.filter((value) => inRange(dayOf(value), from, to)).length,
    flashcards,
    // A log day counts when its `## Log` holds at least one line the parser reads.
    daysLogged: days.filter((day) => inRange(day.date, from, to) && day.entries.length > 0).length,
  };
}

/** Minutes in words as a person reads them: `0m`, `45m`, `3h`, `12h 30m`. */
export function minutesWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
