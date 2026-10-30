/**
 * Which todo a `⛔` holds shut, and the state each line with one settles in.
 * Pure, as `todo-write.ts` is: answers go in, the lines to change come out.
 */

import { isOpen, parseTodo, patchLine, type Todo } from "@/lib/todo/todo";

/**
 * Whether a blocker is closed. Nothing, where the caller cannot see it, reads as open,
 * so a dependent is never opened on a guess. `"twinned"` has no answer either.
 */
export type Closed = (id: string) => boolean | "twinned" | undefined;

/**
 * An id none of the todos carries answers nothing. An id two carry answers
 * `"twinned"`, not whichever was listed last.
 */
export function closedAmong(todos: Todo[]): Closed {
  const states = new Map<string, boolean | "twinned">();
  for (const todo of todos) {
    if (todo.id === undefined) continue;
    states.set(todo.id, states.has(todo.id) ? "twinned" : !isOpen(todo));
  }
  return (id) => states.get(id);
}

/**
 * Each `⛔` line whose state disagrees with its blockers, keyed by line number. Only
 * `[ ]` and `[b]` move. A line with a twinned blocker is left alone unless another is open.
 */
export function blockedLines(lines: string[], closed: Closed): Map<number, string> {
  const moved = new Map<number, string>();

  for (const [index, text] of lines.entries()) {
    const todo = parseTodo(text);
    if (todo === null || todo.blockedBy.length === 0) continue;
    if (todo.state !== "open" && todo.state !== "blocked") continue;

    const answers = todo.blockedBy.map(closed);
    // Every blocker has to be closed, and one this cannot see reads as open.
    const held = answers.some((answer) => answer === false || answer === undefined);
    if (!held && answers.includes("twinned")) continue;
    const state = held ? "blocked" : "open";
    if (todo.state !== state) moved.set(index + 1, patchLine(text, { ...todo, state }));
  }

  return moved;
}

/** `blockedLines` applied to a note. Null where nothing moved, as `dropDone` is. */
export function applyBlocked(text: string, closed: Closed): string | null {
  const lines = text.split("\n");
  const moved = blockedLines(lines, closed);
  if (moved.size === 0) return null;

  for (const [at, insert] of moved) lines[at - 1] = insert;
  return lines.join("\n");
}

/**
 * `line` with one more blocker, in the state `blockedLines` calls for. Null where it is
 * no todo or already names `id`. Open turns blocked under an open blocker; others keep theirs.
 */
export function blockLine(line: string, id: string, closed: Closed): string | null {
  const todo = parseTodo(line);
  if (todo === null || todo.blockedBy.includes(id)) return null;

  const named = patchLine(line, { ...todo, blockedBy: [...todo.blockedBy, id] });
  return blockedLines([named], closed).get(1) ?? named;
}

/**
 * An edited line, opened where the edit took the last `⛔` off a blocked todo, since
 * nothing else would move it. A `[b]` that never had one waits outside the vault and stays.
 */
export function unblockedEdit(before: string, after: string): string {
  const was = parseTodo(before);
  const now = parseTodo(after);
  if (was === null || now === null) return after;
  if (was.state !== "blocked" || now.state !== "blocked") return after;
  if (was.blockedBy.length === 0 || now.blockedBy.length > 0) return after;

  return patchLine(after, { ...now, state: "open" });
}
