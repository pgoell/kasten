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

/** The tag that says which part to do first, whatever the order says. */
const NEXT = "#next";

/**
 * The one thing that could be done next under `node`.
 *
 * `#next` on any descendant wins. Otherwise it is the first open leaf, depth
 * first. A todo with no children is its own next action. Null where nothing
 * under it can be started, which is every part done, rejected or waiting on a
 * start date that has not arrived.
 */
export function nextActionOf(node: Node, today: string): Node | null {
  const startable = [node, ...descendants(node)].filter(
    (one) => isOpen(one.todo) && !waiting(one.todo, today),
  );

  return (
    startable.find((one) => one.todo.tags.includes(NEXT)) ??
    // A leaf, so the answer is a thing you can sit down to rather than a
    // heading over three more questions.
    startable.find((one) => one.children.length === 0) ??
    null
  );
}

/** Where the vault keeps its named filters. One note, not a setting. */
export const VIEWS_NOTE = "99 Misc/01 Config/todo-views.md";

/**
 * What the first `v` writes into a vault holding no views note.
 *
 * One view per family of term, so the note a reader opens to change teaches the
 * syntax they are about to write.
 */
export const DEFAULT_VIEWS = `# Todo views

- today: due:today
- doing: /doing
- important: !highest !high
`;

/** One named filter, the filter kept as written and read by `parseFilter`. */
export interface View {
  name: string;
  filter: string;
}

/** A view: a list item at the left margin, a name, a colon, then the terms. */
const VIEW = /^- ([^:]+):[ \t]*(\S.*)$/;

/**
 * The views a note holds, in the order it holds them.
 *
 * A line that does not fit is skipped rather than reported: the note is edited
 * by hand, so it is half written most of the times this reads it, and a heading
 * or a paragraph in it is not a mistake. `[^:]+` cannot cross a colon, so the
 * split lands on the first one and a filter carrying its own, `due:<7d`,
 * survives on the right of it.
 */
export function parseViews(text: string): View[] {
  const views: View[] = [];
  for (const line of text.split("\n")) {
    const found = VIEW.exec(line);
    if (found?.[1] !== undefined && found[2] !== undefined) {
      views.push({ name: found[1].trim(), filter: found[2].trim() });
    }
  }
  return views;
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
