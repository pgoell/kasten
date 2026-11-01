/**
 * How a list of todos reads: which group a row belongs to, and which rows are not work yet.
 * Pure, and shared with the editor so both read the same rules.
 */

import { shiftDay } from "@/lib/clock";
import { bodyFences } from "@/lib/note-section";
import { isOpen, parseTodo, type Todo } from "@/lib/todo/todo";
// The type alone, so this module loads nothing from todo-blocked.
import type { Closed } from "@/lib/todo/todo-blocked";
import { plainLinks } from "@/lib/wikilink";

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
 * Which group a row belongs to: the scheduled date, else the due date. A due date in the past wins over both and lands in Overdue.
 * ISO dates sort as strings, so comparing them is the whole of the date maths.
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

/** A line that is no todo but ends the parts above it, at its indent. */
export interface Stop {
  line: number;
  indent: number;
}

/** A step down the path: a todo, or a stop that holds what sits under it away from the todos above. */
interface Step {
  indent: number;
  node: Node | null;
}

/** Pops back to `indent`, steps in, and answers the todo that now holds the step, if any. */
function stepIn(path: Step[], indent: number, node: Node | null): Node | null {
  while (path.length > 0 && (path[path.length - 1]?.indent ?? 0) >= indent) path.pop();
  const parent = path[path.length - 1]?.node ?? null;
  path.push({ indent, node });
  return parent;
}

/**
 * The forest one note's todos make, read off the indents: a todo is the child of the nearest todo above it with a smaller indent.
 * Prose between todos ends nothing. `stops`, in line order, are the lines that do end the parts (#1306); the pane has none to pass.
 */
export function treeOf(placed: Placed[], stops: readonly Stop[] = []): Node[] {
  const roots: Node[] = [];
  // The todos and stops still open above this one, shallowest first. Popping
  // back to a smaller indent is the whole rule.
  const path: Step[] = [];
  let next = 0;

  for (const entry of placed) {
    for (; next < stops.length && (stops[next]?.line ?? 0) < entry.line; next++) {
      stepIn(path, stops[next]?.indent ?? 0, null);
    }
    const node: Node = { ...entry, children: [] };
    (stepIn(path, entry.todo.indent, node)?.children ?? roots).push(node);
  }

  return roots;
}

/** A heading sits shallower than any line, so it ends every part above it. */
const HEADING_LINE = /^ {0,3}#{1,6}(?:[ \t]|$)/;

/** A list item of any kind, cut to its indent. Read after `parseTodo`, so a match is one that is no todo. */
const ITEM = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)/;

/**
 * The forest of a whole note, with its parts ended as Obsidian ends them: by a heading or a list item that is no todo.
 * A fenced line is no todo, found as `bodyFences` finds it.
 */
export function noteTree(lines: string[]): Node[] {
  const { above, coded } = bodyFences(lines);
  const placed: Placed[] = [];
  const stops: Stop[] = [];

  for (const [index, text] of lines.entries()) {
    if (index < above || coded.has(index)) continue;
    const todo = parseTodo(text);
    const item = ITEM.exec(text);
    if (todo !== null) placed.push({ line: index + 1, todo });
    else if (HEADING_LINE.test(text)) stops.push({ line: index + 1, indent: -1 });
    else if (item !== null) stops.push({ line: index + 1, indent: (item[1] ?? "").length });
  }

  return treeOf(placed, stops);
}

/**
 * The tag that marks client work, which sorts ahead of internal work. Fixed, not a setting, because the agents plan from the same lines.
 */
export const CLIENT = "#client";

/** Whether a todo is client work, by its own tag or by the one a parent passed down. */
export function isClient(todo: Todo): boolean {
  return todo.tags.includes(CLIENT);
}

/**
 * The forest with each part's missing dates and priority filled from its parent. Only those pass down: the other fields describe one line.
 * Read here, not written into the note, so a moved parent date moves every part. Not in `treeOf`, which writes its nodes back out.
 */
export function inherited(roots: Node[], from?: Todo): Node[] {
  return roots.map((node) => {
    const todo: Todo = {
      ...node.todo,
      due: node.todo.due ?? from?.due,
      scheduled: node.todo.scheduled ?? from?.scheduled,
      start: node.todo.start ?? from?.start,
      priority: node.todo.priority ?? from?.priority,
      // Who the work is for is a question about the work too, so a part of a
      // client todo is client work. Into `tags` rather than a field of its
      // own, so `#client` in the filter line finds the parts with the parent.
      // No other tag comes down: `#next` names one line.
      tags:
        from !== undefined && isClient(from) && !isClient(node.todo)
          ? [...node.todo.tags, CLIENT]
          : node.todo.tags,
    };
    // What this one ended up with, not what it was handed, so a part several
    // steps down takes each field off the nearest todo above it carrying one.
    return { ...node, todo, children: inherited(node.children, todo) };
  });
}

/** Every todo under `node`, depth first, `node` itself left out. */
export function descendants(node: Node): Node[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** The tag that says which part to do first, whatever the order says. */
const NEXT = "#next";

/**
 * The one thing to do next under `node`: a `#next` descendant wins, else the first open leaf, depth first.
 * A todo with no children is its own next action. Null when nothing under it can start yet.
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

/** Where the vault keeps its named filters, inside `KASTEN_CONFIG_PATH`. */
export { VIEWS_NOTE } from "@/lib/layout";

/**
 * What the first `v` writes into a vault with no views note. One view per family of term, so the note teaches
 * the syntax a reader is about to write.
 */
export const DEFAULT_VIEWS = `---
type: Reference
---

# Todo views

- today: due:today
- doing: /doing
- review: /review
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
 * The views a note holds, in order. A line that does not fit is skipped, not reported: the note is hand-edited and often half written.
 * The name is split on its first colon, so a filter like `due:<7d` keeps its own.
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

/**
 * What a `[w]` row says about its wait: who it is on and the days it has run. Null for other states, and for a wait naming neither.
 * The days come first so a narrow row cuts the name and keeps the number.
 */
export function waitOf(todo: Todo, today: string): string | null {
  if (todo.state !== "waiting") return null;

  const since = todo.waitingSince;
  const days =
    since === undefined
      ? undefined
      : `${Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000)}d`;
  const who = todo.waitingOn === undefined ? undefined : plainLinks(todo.waitingOn);
  const said = [days, who].filter(Boolean).join(" ");

  return said === "" ? null : `👤 ${said}`;
}

/** Every todo carrying an id, by that id, which is what a `⛔` names. */
export function namedTodos(todos: Todo[]): Map<string, Todo> {
  const named = new Map<string, Todo>();
  for (const todo of todos) if (todo.id !== undefined) named.set(todo.id, todo);
  return named;
}

/**
 * The words of every open blocker a todo still waits for. A blocker no note holds, or that two todos carry, is named by its id.
 * Two todos carrying one id could be either, so neither's words or state may stand for it.
 */
export function waitsFor(todo: Todo, named: Map<string, Todo>, closed: Closed): string[] {
  const held: string[] = [];
  for (const id of todo.blockedBy) {
    const blocker = named.get(id);
    if (blocker === undefined || closed(id) === "twinned") held.push(id);
    else if (isOpen(blocker)) held.push(blocker.text);
  }
  return held;
}

/**
 * The open todos waiting for each open todo, keyed by the blocker's id.
 * An id two todos carry counts as open, since which twin was meant cannot be told.
 */
export function dependentsOf(todos: Todo[], closed: Closed): Map<string, Todo[]> {
  const named = namedTodos(todos);
  const waiters = new Map<string, Todo[]>();
  for (const todo of todos) {
    if (!isOpen(todo)) continue;
    for (const id of todo.blockedBy) {
      const blocker = named.get(id);
      const held = closed(id) === "twinned" || (blocker !== undefined && isOpen(blocker));
      if (!held) continue;
      waiters.set(id, [...(waiters.get(id) ?? []), todo]);
    }
  }
  return waiters;
}
