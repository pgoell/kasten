/**
 * The writes that change one listed todo's own line, and nothing beyond it. Unlike
 * `todo-api.ts`, none makes a daily note or uses a path list.
 */

import { fetchNote, fetchTodos, type SearchHit, saveNote, updateNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { isOpen, newId, parseTodo, patchLine } from "@/lib/todo/todo";
import { blockLine, type Closed, closedAmong, unblockedEdit } from "@/lib/todo/todo-blocked";
import { expandShorthand } from "@/lib/todo/todo-shorthand";
import { insertSubtask, otherTodoWithId } from "@/lib/todo/todo-write";

/**
 * Put one edited line back where the row found it, with no reformatting. A blocked line
 * whose last `⛔` was deleted is opened here, and the old line is checked against the row first.
 */
export async function editTodoInVault(hit: SearchHit, line: string): Promise<void> {
  await updateNote(hit.path, (text) => {
    const lines = text.split("\n");
    if (lines[hit.line - 1] !== hit.text) return null;

    lines[hit.line - 1] = unblockedEdit(hit.text, line);
    return lines.join("\n");
  });
}

/**
 * Add `⛔` and the blocker's id to the row's line, and an id to the blocker. The blocker is
 * written first, so a failed write leaves an unused id, not a `⛔` naming nothing.
 */
export async function blockTodoInVault(hit: SearchHit, blocker: SearchHit): Promise<void> {
  const blockerText = await fetchNote(blocker.path);
  const blockerLines = blockerText.split("\n");
  const named = parseTodo(blocker.text);
  if (named === null || blockerLines[blocker.line - 1] !== blocker.text) return;

  // One note holding both is read once and written once, the second read
  // being older than the first write otherwise.
  const same = hit.path === blocker.path;
  const text = same ? blockerText : await fetchNote(hit.path);
  const lines = same ? blockerLines : text.split("\n");
  if (lines[hit.line - 1] !== hit.text) return;

  // A blocker whose id another todo line carries too is refused before any
  // write: the `⛔` could not say which of the two it waits on.
  const todos = await fetchTodos();
  if (named.id !== undefined) {
    const other = otherTodoWithId(named.id, blocker.path, blocker.line, todos, blockerText);
    if (other !== null) throw new Error(other);
  }

  const id = named.id ?? newId();
  const seen = closedAmong(todos.flatMap((found) => parseTodo(found.text) ?? []));
  // The blocker answers off its own line: the id may be minutes old or new.
  const closed: Closed = (asked) => (asked === id ? !isOpen(named) : seen(asked));
  const held = blockLine(hit.text, id, closed);
  if (held === null) return;

  if (named.id === undefined) {
    blockerLines[blocker.line - 1] = patchLine(blocker.text, { ...named, id });
    if (!same) await saveNote(blocker.path, blockerLines.join("\n"), false, noteBase(blockerText));
  }
  lines[hit.line - 1] = held;
  // Each write names the text it was read from, so a note that moved under
  // either is refused rather than written over.
  await saveNote(hit.path, lines.join("\n"), false, noteBase(text));
}

/**
 * Put a typed todo into the row's note as a part of it, with the add prompt's shorthand.
 * The parent's line is checked against its row first, since the part hangs off it.
 */
export async function addSubtaskInVault(
  hit: SearchHit,
  input: string,
  today: string,
): Promise<void> {
  await updateNote(hit.path, (text) =>
    text.split("\n")[hit.line - 1] === hit.text
      ? insertSubtask(text, hit.line, expandShorthand(input, today))
      : null,
  );
}
