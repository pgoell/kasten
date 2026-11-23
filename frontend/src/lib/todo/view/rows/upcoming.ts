/** The Upcoming tab's days: which day a todo falls on, and how full each day of the week is. */

import type { TodoRow } from "@/lib/core/api";
import { shiftDay } from "@/lib/core/clock";
import { dayMonth } from "@/lib/todo/view/rows/row-facts";

/** Days drawn one by one; the week after them shares one group. */
export const DAYS_AHEAD = 7;
/** How far Upcoming looks: the next seven days and the week after. */
export const LAST_AHEAD = 14;
/** Planned time that fills a day's bar. */
const FULL_DAY_MINUTES = 6 * 60;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The planned day, else the parent's: a part plans with the todo above it. */
export function plannedOf(row: TodoRow, byId: Map<string, TodoRow>): string | null {
  for (let at: TodoRow | undefined = row; at; ) {
    if (at.planned !== null) return at.planned;
    at = at.parent_id === null ? undefined : byId.get(at.parent_id);
  }
  return null;
}

/**
 * The day Upcoming files a todo under: its plan, else a hard due date. A soft due date is the
 * store's fallback two weeks out, so it would file every undated todo there.
 */
export function dayOf(row: TodoRow, byId: Map<string, TodoRow>): string | null {
  return plannedOf(row, byId) ?? (row.due_hard ? row.due : null);
}

export function weekdayName(day: string): string {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()] ?? "";
}

/** The group a day goes in: the day itself in the week ahead, else the week after. */
export function dayGroupKey(day: string, today: string): string {
  return day <= shiftDay(today, DAYS_AHEAD) ? day : "later";
}

/** A day group's name and the dates beside it. */
export function dayHeading(key: string, today: string): { label: string; sub: string } {
  if (key === "later") {
    const from = shiftDay(today, DAYS_AHEAD + 1);
    const to = shiftDay(today, LAST_AHEAD);
    return { label: "The week after", sub: `${dayMonth(from)} to ${dayMonth(to)}` };
  }
  const label = key === shiftDay(today, 1) ? "Tomorrow" : weekdayName(key);
  return { label, sub: `${weekdayName(key).slice(0, 3)} ${dayMonth(key)}` };
}

export interface WeekDay {
  day: string;
  count: number;
  minutes: number;
  /** A todo filed on it is hard due on it, the rule its group's heading counts by. */
  deadline: boolean;
  /** How full the day is, 0 to 1. */
  load: number;
}

/** Each day of the week ahead with the todos Upcoming lists on it and the time they are given. */
export function weekStrip(listed: TodoRow[], byId: Map<string, TodoRow>, today: string): WeekDay[] {
  return Array.from({ length: DAYS_AHEAD }, (_, at) => {
    const day = shiftDay(today, at + 1);
    const on = listed.filter((row) => dayOf(row, byId) === day);
    const minutes = on.reduce((sum, row) => sum + (row.estimate ?? 0), 0);
    const deadline = on.some((row) => row.due_hard && row.due === day);
    const load = Math.min(1, Math.max(minutes / FULL_DAY_MINUTES, on.length * 0.06));
    return { day, count: on.length, minutes, deadline, load };
  });
}
