/**
 * A recurrence read off a line, and the copy a tick of it writes.
 *
 * The obsidian-tasks grammar cut to what kasten writes back: `every day`,
 * `every 3 weeks`, the days a week or a month rule names, and the `when done`
 * suffix. A rule this cannot read stays on the line as text, which is what
 * makes a typo visible rather than lost.
 */

import { shiftDay } from "@/lib/clock";
import type { Todo } from "@/lib/todo/todo";

/**
 * The days a rule names, where it names any.
 *
 * `-1` is the last one: the last day of the month, or the last Friday in it.
 * Weekdays count the way `Date.getUTCDay` does, Sunday being 0.
 */
export type RecurrenceOn =
  | { kind: "weekdays"; days: number[] }
  | { kind: "day"; day: number }
  | { kind: "nth"; nth: number; weekday: number };

export interface Recurrence {
  /** How many units on. One where the text names no number. */
  every: number;
  unit: "day" | "week" | "month" | "year";
  /** Count the next date from the day it was done rather than from the date it carried. */
  whenDone: boolean;
  /** Absent where the rule only counts periods, as `every 3 weeks` does. */
  on?: RecurrenceOn;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const ORDINALS = ["1st", "2nd", "3rd", "4th"];

const RULE = /^every (?:(\d+) )?(day|week|month|year)s?(?: on (.+))?$/;

const DAY_MS = 86_400_000;

/** `friday` or `fri` as the number `getUTCDay` gives it. Null for any other word. */
function readWeekday(word: string): number | null {
  const found = WEEKDAYS.findIndex((name) => {
    const lower = name.toLowerCase();
    return word === lower || word === lower.slice(0, 3);
  });
  return found === -1 ? null : found;
}

/** `monday, thursday` in week order, or null where one of the words is not a day. */
function readWeekdays(list: string): RecurrenceOn | null {
  const days = list.split(/, ?/).map(readWeekday);
  if (days.some((day) => day === null)) return null;

  // Monday first, the way the week is counted below, so a list typed in any
  // order is written back in one.
  const sorted = [...new Set(days as number[])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  return { kind: "weekdays", days: sorted };
}

/** What follows `on the` in a month rule: `15th`, `last`, `2nd friday`, `last friday`. */
function readMonthDay(text: string): RecurrenceOn | null {
  if (text === "last") return { kind: "day", day: -1 };

  const day = /^(\d{1,2})(?:st|nd|rd|th)$/.exec(text);
  if (day !== null) {
    const value = Number(day[1]);
    return value >= 1 && value <= 31 ? { kind: "day", day: value } : null;
  }

  const [which = "", name = "", ...rest] = text.split(" ");
  const weekday = readWeekday(name);
  const nth = which === "last" ? -1 : ORDINALS.indexOf(which) + 1;
  if (rest.length > 0 || weekday === null || nth === 0) return null;

  return { kind: "nth", nth, weekday };
}

/**
 * `every week`, `every 3 days`, `every weekday`, `every 2 weeks on Friday`,
 * `every month on the 15th`, each with or without `when done`. Null where it
 * does not parse.
 *
 * Read without regard to case or to how many spaces stand between the words,
 * since obsidian-tasks reads it that way and the line was typed by hand.
 */
export function parseRecurrence(text: string): Recurrence | null {
  const words = text
    .trim()
    .toLowerCase()
    .split(/[ \t]+/)
    .join(" ");
  const whenDone = words.endsWith(" when done");
  const rule = whenDone ? words.slice(0, -" when done".length) : words;

  if (rule === "every weekday") {
    return { every: 1, unit: "week", whenDone, on: { kind: "weekdays", days: [1, 2, 3, 4, 5] } };
  }

  const found = RULE.exec(rule);
  if (found === null) {
    // `every Sunday` is the plugin's own first example, and means every week.
    const on = rule.startsWith("every ") ? readWeekdays(rule.slice("every ".length)) : null;
    return on === null ? null : { every: 1, unit: "week", whenDone, on };
  }

  const every = found[1] === undefined ? 1 : Number(found[1]);
  // Nothing comes back after no time at all, and the count below would never end.
  if (every < 1) return null;

  const unit = found[2] as Recurrence["unit"];
  const named = found[3];
  if (named === undefined) return { every, unit, whenDone };

  let on: RecurrenceOn | null = null;
  if (unit === "week") on = readWeekdays(named);
  if (unit === "month" && named.startsWith("the ")) on = readMonthDay(named.slice("the ".length));

  return on === null ? null : { every, unit, whenDone, on };
}

function ordinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

/**
 * The rule as obsidian-tasks writes it back, which is the one spelling kasten
 * writes: `every 2 weeks on Monday, Thursday`.
 */
export function formatRecurrence(rule: Recurrence): string {
  const done = rule.whenDone ? " when done" : "";
  const { on } = rule;
  if (rule.every === 1 && on?.kind === "weekdays" && on.days.join() === "1,2,3,4,5") {
    return `every weekday${done}`;
  }

  const period = rule.every === 1 ? rule.unit : `${rule.every} ${rule.unit}s`;
  let named = "";
  if (on?.kind === "weekdays") named = ` on ${on.days.map((day) => WEEKDAYS[day]).join(", ")}`;
  if (on?.kind === "day") named = ` on the ${on.day === -1 ? "last" : ordinal(on.day)}`;
  if (on?.kind === "nth") {
    named = ` on the ${on.nth === -1 ? "last" : ORDINALS[on.nth - 1]} ${WEEKDAYS[on.weekday]}`;
  }

  return `every ${period}${named}${done}`;
}

/**
 * The rules worth offering for a todo counted from `date`, as text.
 *
 * The four plain periods and `every weekday` always, then the ones that name
 * the day `date` is: its weekday, its day of the month, and which of that
 * weekday in the month it is. A rule naming the day the todo already has is
 * the one somebody means, and seven weekdays times every shape would be a
 * list nobody reads.
 */
export function offeredRules(date: string): string[] {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const weekday = weekdayOf(date);
  const last = lastDay(year, month);
  const rule = (unit: Recurrence["unit"], on?: RecurrenceOn, every = 1): Recurrence => ({
    every,
    unit,
    whenDone: false,
    on,
  });

  const rules = [
    rule("day"),
    rule("week"),
    rule("month"),
    rule("year"),
    rule("week", { kind: "weekdays", days: [1, 2, 3, 4, 5] }),
    rule("week", { kind: "weekdays", days: [weekday] }),
    rule("week", { kind: "weekdays", days: [weekday] }, 2),
  ];
  // Past the twenty-eighth a numbered day is one some months lack, and the
  // rule would pass those months over. The last day is offered in its place.
  if (day <= 28) {
    rules.push(rule("month", { kind: "day", day }));
    rules.push(rule("month", { kind: "nth", nth: Math.ceil(day / 7), weekday }));
  }
  if (day > last - 7) rules.push(rule("month", { kind: "nth", nth: -1, weekday }));
  if (day === last) rules.push(rule("month", { kind: "day", day: -1 }));

  return rules.map(formatRecurrence);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The last day of a month, `month` counting from one and free to run past twelve. */
function lastDay(year: number, month: number): number {
  // Day zero of the month after is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * The first of the named weekdays after `date`, in a week the rule counts.
 *
 * The weeks are counted from the one `date` is in, Monday first, so `every 2
 * weeks on Friday` counted from a Wednesday lands two days on and from a
 * Friday fourteen. That is how rrule, the library obsidian-tasks counts with,
 * reads an interval of weeks.
 */
function nextWeekday(date: string, every: number, days: number[]): string {
  const monday = shiftDay(date, -((weekdayOf(date) + 6) % 7));
  for (let ahead = 1; ; ahead++) {
    const day = shiftDay(date, ahead);
    const week = Math.floor(daysBetween(monday, day) / 7);
    if (week % every === 0 && days.includes(weekdayOf(day))) return day;
  }
}

/** The day of one month a rule names, or null where that month has no such day. */
function dayIn(year: number, month: number, on: RecurrenceOn): number | null {
  const last = lastDay(year, month);
  if (on.kind === "day") {
    if (on.day === -1) return last;
    return on.day > last ? null : on.day;
  }
  if (on.kind !== "nth") return null;

  if (on.nth === -1) {
    const back = (weekdayOf(`${year}-${pad(month)}-${pad(last)}`) - on.weekday + 7) % 7;
    return last - back;
  }
  const first = (on.weekday - weekdayOf(`${year}-${pad(month)}-01`) + 7) % 7;
  return 1 + first + (on.nth - 1) * 7;
}

/**
 * How many periods a month rule looks through before giving up. A rule naming
 * a day its months never have, `every 12 months on the 30th` counted from a
 * February, would otherwise look for ever. Four leap cycles is past any gap a
 * day that does exist can leave.
 */
const PERIODS = 48;

/**
 * The next date a rule lands on after `date`. Null where it never does.
 *
 * A rule naming its days lands on the first of them after `date`, so the date
 * a todo carried need not be one of them. A month lacking the day named is
 * passed over rather than clamped: `on the 31st` means the thirty-first, which
 * is what obsidian-tasks takes it to mean, and `on the last` is the way to say
 * the end of the month.
 *
 * A rule naming none counts whole periods. It is built from calendar parts
 * rather than by adding milliseconds, the way `periodic.ts` builds its own,
 * and clamped to the last day of the month where the day does not exist: the
 * thirty-first of January one month on is the twenty-eighth of February, not
 * the third of March.
 */
export function nextDate(date: string, rule: Recurrence): string | null {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const { on } = rule;

  if (on?.kind === "weekdays") return nextWeekday(date, rule.every, on.days);

  if (on !== undefined) {
    for (let period = 0; period < PERIODS; period++) {
      const months = month - 1 + period * rule.every;
      const onYear = year + Math.floor(months / 12);
      const onMonth = (months % 12) + 1;
      const onDay = dayIn(onYear, onMonth, on);
      const found = onDay === null ? null : `${onYear}-${pad(onMonth)}-${pad(onDay)}`;
      if (found !== null && found > date) return found;
    }
    return null;
  }

  if (rule.unit === "day") return shiftDay(date, rule.every);
  if (rule.unit === "week") return shiftDay(date, rule.every * 7);

  const months = month - 1 + (rule.unit === "month" ? rule.every : rule.every * 12);
  const onYear = year + Math.floor(months / 12);
  const onMonth = (months % 12) + 1;

  return `${onYear}-${pad(onMonth)}-${pad(Math.min(day, lastDay(onYear, onMonth)))}`;
}

/** Whole days from one date to another, both read in UTC as `shiftDay` reads them. */
function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
}

/**
 * The fresh copy a tick of a recurring todo writes above the completed line.
 *
 * Null where the todo does not recur, where its rule never lands again, or
 * where it carries no date to count from: there would be nothing to count
 * from, and a copy with no date is the same todo written twice. Every date it does carry moves by the same number of days, so
 * the gaps between due, scheduled and start survive the period.
 */
export function nextOccurrence(todo: Todo, today: string): Todo | null {
  const rule = parseRecurrence(todo.recurrence ?? "");
  if (rule === null) return null;

  const anchor = todo.due ?? todo.scheduled ?? todo.start;
  if (anchor === undefined) return null;

  const next = nextDate(rule.whenDone ? today : anchor, rule);
  if (next === null) return null;

  const shift = daysBetween(anchor, next);
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
