/**
 * How a list of todos reads: which group a row belongs to, and which rows are
 * not work yet.
 *
 * Pure, and shared rather than owned by the pane, because the editor reads the
 * same rules. `sectionOf` lived in `todo-pane.tsx` while the pane was the only
 * caller; the dates and the tree gave it three more.
 */

import { shiftDay } from "@/lib/clock";
import type { Todo } from "@/lib/todo";

export type Section = "overdue" | "today" | "week" | "later" | "none";

/** In the order the pane draws them: what is late first, what has no date last. */
export const SECTIONS: readonly Section[] = ["overdue", "today", "week", "later", "none"];

export const HEADING: Record<Section, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

/**
 * Which group a row belongs to.
 *
 * Off the scheduled date where there is one and off the due date otherwise: a
 * task due Friday and scheduled Tuesday is Tuesday's work. A due date in the
 * past wins over both and lands the row in Overdue. ISO dates sort as strings,
 * which is the whole of the maths.
 */
export function sectionOf(todo: Todo, today: string): Section {
  if (todo.due !== undefined && todo.due < today) return "overdue";

  const on = todo.scheduled ?? todo.due;
  if (on === undefined) return "none";
  if (on < today) return "overdue";
  if (on === today) return "today";
  // The window `due:<7d` names, so the seventh day out is already later.
  return on < shiftDay(today, 7) ? "week" : "later";
}

/** Waiting on a start date that has not arrived, so no list shows the row. */
export function waiting(todo: Todo, today: string): boolean {
  return todo.start !== undefined && todo.start > today;
}
