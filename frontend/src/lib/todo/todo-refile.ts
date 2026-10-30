/**
 * The refile key's two notes: the todo out of one, into its project's.
 *
 * Pure over strings, as `todo-write.ts` is. The route reads the notes, sends
 * what these answer, and owns the order the two writes go in.
 */

import { appendUnder } from "@/lib/note-section";
import { parseTodo } from "@/lib/todo/todo";
import { laneName } from "@/lib/todo/todo-board";

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
 * The line the row read, or where a write has shifted it, the one line still saying `text`.
 * Only root todos are searched: a part's words can repeat under another parent.
 */
export function lineOf(text: string, line: number, want: string): number | null {
  const lines = text.split("\n");
  if (lines[line - 1] === want) return line;
  if (/^[ \t]/.test(want)) return null;
  const found = lines.flatMap((each, index) => (each === want ? [index + 1] : []));
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * Move of the todo on `line` into `project`, or null where it is no todo. The block is the
 * todo and its deeper-indented lines; what stays must not be a checkbox, or Tasks counts it twice.
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
 * The project's note with the block under `## TODOs`, or null if it already holds the block
 * whole, so a second press can finish a move. A wrong null loses the todo; a wrong copy only doubles it.
 */
export function fileUnderTodos(text: string, block: string): string | null {
  const want = block.split("\n");
  const lines = text.split("\n");
  const there =
    parseTodo(want[0] ?? "")?.id !== undefined &&
    lines.some((_, at) => want.every((each, offset) => lines[at + offset] === each));
  return there ? null : appendUnder(text, TODOS, block);
}
