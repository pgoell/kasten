/**
 * How a list of todos reads: which group a row belongs to, and which rows are
 * not work yet.
 *
 * Pure, and shared rather than owned by the pane, because the editor reads the
 * same rules. `sectionOf` lived in `todo-pane.tsx` while the pane was the only
 * caller; the dates and the tree gave it three more.
 */

import { shiftDay } from "@/lib/clock";
import { isOpen, type Todo } from "@/lib/todo";

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

/** One todo and where it sits in its note. Lines count from one, as a hit does. */
export interface Placed {
  line: number;
  todo: Todo;
}

export interface Node extends Placed {
  children: Node[];
}

/**
 * The forest one note's todos make, read off nothing but their indents.
 *
 * A todo is a child of the nearest todo above it carrying a smaller indent.
 * Prose between two todos ends nothing: the pane is handed todo lines and never
 * sees that prose, and the editor has to read the same tree it does.
 */
export function treeOf(placed: Placed[]): Node[] {
  const roots: Node[] = [];
  // The todos still open above this one, shallowest first, which is the path
  // down from the root. Popping back to a smaller indent is the whole rule.
  const path: Node[] = [];

  for (const entry of placed) {
    const node: Node = { ...entry, children: [] };
    while (path.length > 0 && (path[path.length - 1]?.todo.indent ?? 0) >= entry.todo.indent) {
      path.pop();
    }
    (path[path.length - 1]?.children ?? roots).push(node);
    path.push(node);
  }

  return roots;
}

/** Every todo under `node`, depth first, `node` itself left out. */
export function descendants(node: Node): Node[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** How many descendants are closed, and how many there are. Null with none. */
export function progressOf(node: Node): { closed: number; total: number } | null {
  const under = descendants(node);
  if (under.length === 0) return null;
  // Every descendant rather than the direct children, because that is what the
  // cascade ticks and the two have to count the same thing.
  const closed = under.filter(({ todo }) => !isOpen(todo)).length;
  return { closed, total: under.length };
}
