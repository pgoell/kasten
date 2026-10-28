/**
 * The week review's tiles and charts, worked out from one week's log days, its daily
 * notes, its todos and its flashcard reviews. Pure, as `review-year.ts` is, so the block
 * passes in what the reads answered.
 */

import type { LineHit, TodoHit } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/log/food-api";
import type { LogConfig, LogKind } from "@/lib/log/log-kinds";
import { tenth } from "@/lib/log/log-lines";
import { hasFood, within } from "@/lib/log/log-streak";
import { valueOn } from "@/lib/log/log-weight";
import { noteSectionOf } from "@/lib/note-section";
import { type Bar, barsOf, doneCounts, reviewCounts } from "@/lib/overview/overview";
import { byText, doneTodos, inRange } from "@/lib/review/review-year";
import { isOpen, parseTodo } from "@/lib/todo/todo";
import { minutesBetween, parseSession } from "@/lib/todo/todo-time";

/**
 * The minutes of the closed sessions under `## Time` in one daily note. A session still
 * running counts nothing, and so does one that ends before it starts, which
 * `minutesBetween` floors at zero.
 */
export function sessionMinutes(text: string): number {
  const section = noteSectionOf(text, "Time");
  if (section === null) return 0;
  let total = 0;
  for (const line of section.text.split("\n")) {
    const session = parseSession(line);
    if (session === null || session.end === undefined) continue;
    total += minutesBetween(session.start, session.end);
  }
  return total;
}

export interface WeekTiles {
  todosDone: number;
  minutes: number;
  /** Days of the week with a food line within the kcal goal; null with no kcal goal. */
  withinKcal: number | null;
  loggedDays: number;
  /** The change in the last kind's weight, to a tenth; null where there is not one to read. */
  weightChange: number | null;
}

/**
 * The change in a last kind's weight over the week, to a tenth: the last weigh-in on or
 * before `to`, less the last one before `from`. With none before the week, the first
 * weigh-in in the week stands in. Null unless the two are different weigh-ins.
 */
function weightChangeOf(kind: LogKind, days: LogDay[], from: string, to: string): number | null {
  const weighed = days
    .flatMap((day) => {
      const value = valueOn(kind, day);
      return value === null || day.date > to ? [] : [{ date: day.date, value }];
    })
    .sort((a, b) => byText(a.date, b.date));
  const end = weighed.at(-1);
  const start =
    weighed.filter((entry) => entry.date < from).at(-1) ??
    weighed.find((entry) => entry.date >= from);
  if (end === undefined || start === undefined || start.date === end.date) return null;
  return tenth(end.value - start.value);
}

/**
 * The week's tiles. `days` may reach back before `from`, which the weight change reads;
 * `notes` are the seven daily notes' texts, a missing one as "".
 */
export function weekTiles(input: {
  todos: TodoHit[];
  days: LogDay[];
  config: LogConfig;
  notes: string[];
  from: string;
  to: string;
}): WeekTiles {
  const { todos, days, config, notes, from, to } = input;
  const week = days.filter((day) => inRange(day.date, from, to) && day.entries.length > 0);
  const goal = config.food.kcal;
  const lastKind = config.kinds.find((kind) => kind.last === true);

  return {
    todosDone: doneTodos(todos, from, to).length,
    minutes: notes.reduce((sum, text) => sum + sessionMinutes(text), 0),
    withinKcal:
      goal === undefined
        ? null
        : week.filter((day) => hasFood(day) && within(day.totals.food.kcal ?? 0, goal)).length,
    loggedDays: week.length,
    weightChange: lastKind === undefined ? null : weightChangeOf(lastKind, days, from, to),
  };
}

/**
 * One bar per day of `dates` with a food line, at its kcal, with no bar for a day without one
 * (no log, drinks only or weight only). A food line of 0 kcal still draws a bar, a stub. The
 * goal is drawn by the chart, so `config` is named for the signature the view codes to
 * and not read here.
 */
export function kcalPerDay(days: LogDay[], _config: LogConfig, dates: string[]): Bar[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return dates.flatMap((date, index) => {
    const day = byDate.get(date);
    if (day === undefined || !hasFood(day)) return [];
    return [{ index, amount: day.totals.food.kcal ?? 0 }];
  });
}

/**
 * The days of `dates` up to `today`. A day still to come gets no bar, as a stub there would
 * read as a day with nothing done rather than one not yet lived. `dates` run oldest first,
 * so the days kept keep their index.
 */
function begun(dates: string[], today: string): string[] {
  return dates.filter((date) => date <= today);
}

/** The todos done on each of `dates` up to `today`, a day with none standing at zero. */
export function todosPerDay(todos: TodoHit[], dates: string[], today: string): Bar[] {
  return barsOf(begun(dates, today), doneCounts(todos));
}

/** The flashcard reviews on each of `dates` up to `today`, a day with none standing at zero. */
export function cardsPerDay(cards: LineHit[], dates: string[], today: string): Bar[] {
  return barsOf(begun(dates, today), reviewCounts(cards));
}

/** The todos ticked done in the range, oldest first. */
export function doneIn(todos: TodoHit[], from: string, to: string): TodoHit[] {
  return doneTodos(todos, from, to)
    .sort((a, b) => byText(a.done, b.done))
    .map(({ hit }) => hit);
}

/**
 * The todos still open (neither done nor rejected) with a due (`📅`) or scheduled (`⏳`)
 * date from `from` to the earlier of `to` and the day before `today`, so a todo dated
 * today or later is not carried over yet. A todo counts on the earliest of its dates
 * that falls in that window, and the list runs earliest date first.
 */
export function carriedOver(todos: TodoHit[], from: string, to: string, today: string): TodoHit[] {
  const yesterday = shiftDay(today, -1);
  const last = to < yesterday ? to : yesterday;
  return todos
    .flatMap((hit) => {
      const todo = parseTodo(hit.text);
      if (todo === null || !isOpen(todo)) return [];
      const early = [todo.due, todo.scheduled]
        .filter((day): day is string => day !== undefined && inRange(day, from, last))
        .sort(byText)[0];
      return early === undefined ? [] : [{ hit, date: early }];
    })
    .sort((a, b) => byText(a.date, b.date))
    .map(({ hit }) => hit);
}
