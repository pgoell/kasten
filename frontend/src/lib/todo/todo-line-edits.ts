/**
 * The writes that change one listed todo's own line, and nothing beyond it. Unlike
 * `todo-api.ts`, none makes a daily note or uses a path list.
 */

import { fetchNote, fetchTodos, type SearchHit, saveNote, updateNote } from "@/lib/core/api";
import { noteBase } from "@/lib/notes/note-base";
import { isOpen, newId, parseTodo, patchLine } from "@/lib/todo/todo";
import { blockLine, type Closed, closedAmong, unblockedEdit } from "@/lib/todo/todo-blocked";
import { inTurn, landedRow } from "@/lib/todo/todo-press-echo";
import { lineOf } from "@/lib/todo/todo-refile";
import { expandShorthand } from "@/lib/todo/todo-shorthand";
import { insertSubtask, otherTodoWithId } from "@/lib/todo/todo-write";

const CHANGED = "that line has changed since it was listed";

/**
 * The row where it stands in `text`: where an `x` or a stamp left it, else by its words on exactly
 * one line, as `t` finds it. Null where no line says it: its words changed, or twins share them (#2212).
 */
function rowNow(text: string, hit: SearchHit): SearchHit | null {
  const { row } = landedRow(text, hit);
  const line = lineOf(text, row.line, row.text);
  return line === null ? null : { ...row, line };
}

/**
 * Put one edited line back where the row found it, with no reformatting. A blocked line
 * whose last `⛔` was deleted is opened here, and the old line is checked against the row first.
 * The edit was typed over the row's words, so a line an `x` changed since takes none of it, and this answers false.
 */
export async function editTodoInVault(hit: SearchHit, line: string): Promise<boolean> {
  const written = await inTurn(() =>
    updateNote(hit.path, (text) => {
      const lines = text.split("\n");
      const at = landedRow(text, hit).row.line;
      if (lines[at - 1] !== hit.text) return null;

      lines[at - 1] = unblockedEdit(hit.text, line);
      return lines.join("\n");
    }),
  );
  return written !== null;
}

/**
 * Add `⛔` and the blocker's id to the row's line, and an id to the blocker. The blocker is
 * written first, so a failed write leaves an unused id, not a `⛔` naming nothing.
 */
export function blockTodoInVault(hit: SearchHit, blocker: SearchHit): Promise<void> {
  return inTurn(() => blockTodo(hit, blocker));
}

async function blockTodo(listed: SearchHit, blocker: SearchHit): Promise<void> {
  const blockerText = await fetchNote(blocker.path);
  const blockerLines = blockerText.split("\n");
  const picked = rowNow(blockerText, blocker);
  if (picked === null) throw new Error("the blocker's line has changed since it was listed");
  // Off the line as it stands: an `x` may have closed the blocker since it was listed.
  const named = parseTodo(picked.text);
  if (named === null) return;

  // One note holding both is read once and written once, the second read
  // being older than the first write otherwise.
  const same = listed.path === blocker.path;
  const text = same ? blockerText : await fetchNote(listed.path);
  const lines = same ? blockerLines : text.split("\n");
  const hit = rowNow(text, listed);
  if (hit === null) throw new Error(CHANGED);

  // A blocker whose id another todo line carries too is refused before any
  // write: the `⛔` could not say which of the two it waits on.
  const todos = await fetchTodos();
  if (named.id !== undefined) {
    const other = otherTodoWithId(named.id, blocker.path, picked.line, todos, blockerText);
    if (other !== null) throw new Error(other);
  }

  const id = named.id ?? newId();
  const seen = closedAmong(todos.flatMap((found) => parseTodo(found.text) ?? []));
  // The blocker answers off its own line: the id may be minutes old or new.
  const closed: Closed = (asked) => (asked === id ? !isOpen(named) : seen(asked));
  const held = blockLine(hit.text, id, closed);
  if (held === null) return;

  if (named.id === undefined) {
    blockerLines[picked.line - 1] = patchLine(picked.text, { ...named, id });
    if (!same) await saveNote(blocker.path, blockerLines.join("\n"), false, noteBase(blockerText));
  }
  lines[hit.line - 1] = held;
  // Each write names the text it was read from, so a note that moved under
  // either is refused rather than written over.
  await saveNote(hit.path, lines.join("\n"), false, noteBase(text));
}

/**
 * Put a typed todo into the row's note as a part of it, with the add prompt's shorthand.
 * The parent's line is checked against its row first, since the part hangs off it; in turn, as an `x` before it may move it (#2210).
 * Throws where the parent's line changed, so the prompt can keep what was typed (#2212).
 */
export async function addSubtaskInVault(
  hit: SearchHit,
  input: string,
  today: string,
): Promise<void> {
  const written = await inTurn(() =>
    updateNote(hit.path, (text) => {
      const parent = rowNow(text, hit);
      return parent === null
        ? null
        : insertSubtask(text, parent.line, expandShorthand(input, today));
    }),
  );
  if (written === null) throw new Error(CHANGED);
}
