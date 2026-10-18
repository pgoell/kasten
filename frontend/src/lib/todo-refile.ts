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
 * The line the row read, which a write landing since may have shifted: `line`
 * where it still says `text`, else the one line that does. Null where none
 * does, or several, since then which todo the row meant is a guess.
 */
export function lineOf(text: string, line: number, want: string): number | null {
  const lines = text.split("\n");
  if (lines[line - 1] === want) return line;
  const found = lines.flatMap((each, index) => (each === want ? [index + 1] : []));
  return found.length === 1 ? (found[0] ?? null) : null;
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
    // By the count of blanks, which is how `parseTodo` and `treeOf` read a
    // part, so what moves is what the board counts as the todo's parts.
    if (indentOf(each).length <= own.length) break;
    end = at + 1;
  }

  // A line indented some other way than the todo keeps its blanks as typed:
  // cutting them to fit would move it out of the todo it belongs to.
  const block = lines
    .slice(line - 1, end)
    .map((each) => (each.startsWith(own) ? each.slice(own.length) : each))
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
 * holds this very block already: the todo carries a `🆔` and the note holds
 * every line of the block, in a row, as they stand.
 *
 * Null is what lets a second press finish a move whose first press copied the
 * todo and then found its note changed. Anything short of that appends: the
 * same words can be another todo, a recurring one's earlier copy, and a copy
 * whose parts changed since is not the todo now. The source is taken out once
 * the target has landed, so a wrong null loses the todo, where a wrong copy
 * only doubles it.
 */
export function fileUnderTodos(text: string, block: string): string | null {
  const want = block.split("\n");
  const lines = text.split("\n");
  const there =
    parseTodo(want[0] ?? "")?.id !== undefined &&
    lines.some((_, at) => want.every((each, offset) => lines[at + offset] === each));
  return there ? null : appendUnder(text, TODOS, block);
}
