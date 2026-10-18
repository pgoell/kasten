/**
 * The refile key's two notes: the todo out of one, into its project's.
 *
 * Pure over strings, as `todo-write.ts` is. The route reads the notes, sends
 * what these answer, and owns the order the two writes go in.
 */

import { appendUnder } from "@/lib/note-section";
import { parseTodo } from "@/lib/todo";
import { laneName } from "@/lib/todo-board";

/** Where a new todo lands, and so where a refiled one does. */
const TODOS = "## TODOs";

export interface Refile {
  /** The todo and every line under it, moved left by the todo's own indent. */
  block: string;
  /** The note the todo leaves, with a plain bullet in its place. */
  left: string;
}

/** The note a project's todos are refiled into: the one `p` links to. */
export function projectNote(project: string): string {
  return `${project}/index.md`;
}

/** The leading blanks of a line, as typed. */
function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? "";
}

/**
 * The move of the todo on `line` into `project`, or null where that line is
 * not a todo.
 *
 * The block is the todo and every line indented deeper than it, prose and
 * plain bullets as much as parts: they are what the todo says about itself. A
 * blank line inside the block goes with it; one after it stays. What stays
 * behind is not a checkbox, or Tasks would count the todo twice.
 */
export function refileOf(text: string, line: number, project: string): Refile | null {
  const lines = text.split("\n");
  const head = lines[line - 1] ?? "";
  const todo = parseTodo(head);
  if (todo === null) return null;

  const own = indentOf(head);
  let end = line;
  for (let at = line; at < lines.length; at += 1) {
    const each = lines[at] ?? "";
    if (each.trim() === "") continue;
    if (indentOf(each).length <= own.length) break;
    end = at + 1;
  }

  const block = lines
    .slice(line - 1, end)
    .map((each) => (each.startsWith(own) ? each.slice(own.length) : each.trimStart()))
    .join("\n");

  // The words without the `^block` id, which names the line that moved.
  const words = todo.text.replace(/(?:^|[ \t]+)\^[\w-]+$/, "");
  const link = `[[${project}/index|${laneName(project)}]]`;
  // A todo `p` already linked carries the link in its words.
  const bullet = words.includes(`[[${project}/index`) ? words : `${words} ${link}`.trim();

  lines.splice(line - 1, end - line + 1, `${own}- ${bullet}`);
  return { block, left: lines.join("\n") };
}

/**
 * The project's note with the block under `## TODOs`, or null where the note
 * holds the todo already: by its `🆔` where it has one, else by the line.
 *
 * Null is what lets a second press finish a move whose first press copied the
 * todo and then found its note changed: the copy is not made twice.
 */
export function fileUnderTodos(text: string, block: string): string | null {
  const head = block.split("\n")[0] ?? "";
  const id = parseTodo(head)?.id;
  const there = text
    .split("\n")
    .some((each) => (id === undefined ? each.trim() === head.trim() : parseTodo(each)?.id === id));
  return there ? null : appendUnder(text, TODOS, block);
}
