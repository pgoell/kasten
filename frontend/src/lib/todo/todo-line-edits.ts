/**
 * The writes that change one listed todo's own line, and none beyond it.
 *
 * Each one checks the line against the row the prompt opened on, then writes
 * the note it came from. None of them makes a daily note or sends a write
 * through a path list, which is what keeps them apart from `todo-api.ts`.
 */

import { fetchNote, fetchTodos, type SearchHit, saveNote, updateNote } from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { isOpen, newId, parseTodo, patchLine } from "@/lib/todo/todo";
import { blockLine, type Closed, closedAmong, unblockedEdit } from "@/lib/todo/todo-blocked";
import { expandShorthand } from "@/lib/todo/todo-shorthand";
import { insertSubtask, otherTodoWithId } from "@/lib/todo/todo-write";

/**
 * Put one edited line back where the row found it, exactly as it was left.
 *
 * No reformatting: the line is the whole record, so an edit is the line itself
 * and whatever it now says is what kasten will read out of it next. That is
 * what reaches the fields the shorthand does not spell, `🔁` and `⏳` among
 * them. One rule: a blocked line whose last `⛔` the edit deleted is opened,
 * nothing else being left to open it, and that one line is rebuilt in the
 * field order.
 *
 * The note is read again and the old line checked against the row the prompt
 * opened on, which is stricter than the guard the cycle uses and has to be: a
 * cycle rewrites the line it finds, where this replaces it, so a note that
 * moved under a stale row would lose whatever now sits at that number.
 *
 * No `paths` and no `send`: the line came out of a note the vault holds.
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
 * Say that the row's todo waits for another: `⛔` and the blocker's id on its
 * line, and an id on the blocker where it has none.
 *
 * Both lines are checked against their rows before anything is written, for
 * the reason an edit checks its one. Then the blocker first: a write that
 * fails between the two leaves an id nothing names, where the other order
 * would leave a `⛔` naming nothing.
 *
 * No `paths` and no `send`: both lines came out of notes the vault holds.
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
 * Put a typed todo into the note the row's todo lives in, as a part of it.
 *
 * The same shorthand the add prompt takes, so a part arrives with its date and
 * its priority already on it. The old line is checked against the row for the
 * reason an edit checks it: the part is placed off the parent's own line, so a
 * note that moved under a stale row would hang it under whatever now sits
 * there.
 *
 * No `paths` and no `send`: the parent came out of a note the vault holds.
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
