/**
 * Which todo a `⛔` holds shut, and the state each line with one settles in.
 *
 * Pure, as `todo-write.ts` is: a closed-or-open answer per id goes in, the
 * lines that must change come out.
 */

import { isOpen, parseTodo, patchLine, type Todo } from "@/lib/todo/todo";

/**
 * Whether a blocker is closed, or nothing where the caller cannot see it.
 *
 * Nothing reads as still open, so a dependent is never opened on a guess. The
 * buffer builds this from the document it holds; the vault writer builds it
 * from every todo the vault holds.
 *
 * `"twinned"` is an id two todos carry. Neither can be told from the other, so
 * whether it is closed has no answer, and reading it as open would block a
 * dependent nobody asked to move.
 */
export type Closed = (id: string) => boolean | "twinned" | undefined;

/**
 * A resolver over the todos in hand. An id none of them carries answers
 * nothing, and an id two of them carry answers `"twinned"` rather than going by
 * whichever was listed last.
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
 * Every `⛔` line in `lines` whose state kasten owns and whose blockers
 * disagree with it, keyed by line number.
 *
 * `⛔` on a line means kasten owns the choice between `[ ]` and `[b]` there.
 * `[/]`, `[x]` and `[-]` are never touched, so a state set by hand cannot be
 * destroyed by a blocker moving.
 *
 * A line whose other blockers are all closed is not touched where one more is
 * twinned: one twin may be open and the other closed, and either state written
 * here would be a guess at which one the `⛔` meant. An open blocker beside it
 * holds the line whichever twin was meant.
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
 * `line` naming one more blocker, in the state its blockers now call for.
 *
 * Null where the line is no todo or names `id` already. The state is
 * `blockedLines`' own choice, so a line this writes and a line a blocker's
 * press rewrites cannot disagree: open becomes blocked under a blocker still
 * open, and doing, waiting, done and rejected keep the state they have.
 */
export function blockLine(line: string, id: string, closed: Closed): string | null {
  const todo = parseTodo(line);
  if (todo === null || todo.blockedBy.includes(id)) return null;

  const named = patchLine(line, { ...todo, blockedBy: [...todo.blockedBy, id] });
  return blockedLines([named], closed).get(1) ?? named;
}

/**
 * An edited line, opened where the edit took the last `⛔` off a blocked todo.
 *
 * Deleting the `⛔` is how a dependency is taken back, and nothing would move
 * the line afterwards: the cascade runs off a blocker's press and finds the
 * dependents by their `⛔`. A `[b]` that never carried one waits on something
 * outside the vault, and stays as it was typed.
 */
export function unblockedEdit(before: string, after: string): string {
  const was = parseTodo(before);
  const now = parseTodo(after);
  if (was === null || now === null) return after;
  if (was.state !== "blocked" || now.state !== "blocked") return after;
  if (was.blockedBy.length === 0 || now.blockedBy.length > 0) return after;

  return patchLine(after, { ...now, state: "open" });
}
