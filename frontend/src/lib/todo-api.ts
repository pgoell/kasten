/**
 * The impure half of a write: read what the press needs, and send what it says.
 *
 * `todo-write.ts` holds the rules and touches nothing. This holds the reads and
 * the writes and holds no rule, which is what keeps the rules testable with no
 * server in front of them.
 */

import { createNote, fetchNote, type SearchHit, saveNote, searchNotes } from "@/lib/api";
import { periodicNote } from "@/lib/periodic";
import { newId, parseTodo } from "@/lib/todo";
import { cycleTodoWrites } from "@/lib/todo-write";

/** Read what the press needs, work out the writes, and send them. */
export async function cycleTodoInVault(
  hit: SearchHit,
  today: string,
  paths: string[],
): Promise<void> {
  // The vault, not the row: the list is as old as the last fetch, and the note
  // is what the press is about to overwrite.
  const text = await fetchNote(hit.path);
  const todo = parseTodo(text.split("\n")[hit.line - 1] ?? "");
  // The line moved, or somebody edited it into prose. Cycling whatever is there
  // now is not what was asked for.
  if (todo === null) return;

  // Only a press that enters or leaves done touches the log, and only a todo
  // that already carries an id can be named by a line already written. A todo
  // entering done with none needs no search: nothing can name a todo that has
  // never had a name.
  const named =
    (todo.state === "doing" || todo.state === "done") && todo.id !== undefined
      ? new Set((await searchNotes(todo.id)).map((found) => found.path))
      : new Set<string>();

  const logged: Record<string, string> = {};
  for (const path of named) {
    logged[path] = path === hit.path ? text : await fetchNote(path);
  }

  // The clock is read here rather than off `today`, `periodicNote` wanting a
  // date. Both come from the same wall clock one render apart.
  const daily = periodicNote("daily", new Date());
  const dailyText =
    logged[daily.path] ??
    // The leading newline is the create's, the way `follow` writes one: the
    // body lands under a frontmatter block and wants a line between.
    (paths.includes(daily.path) ? await fetchNote(daily.path) : `\n${daily.body}`);

  const writes = cycleTodoWrites({
    path: hit.path,
    text,
    line: hit.line,
    dailyPath: daily.path,
    dailyText,
    logged,
    today,
    id: newId(),
  });

  for (const write of writes) {
    // A path the vault does not hold is only ever today's daily note, which a
    // create makes along with the folders on the way to it.
    if (paths.includes(write.path)) await saveNote(write.path, write.text);
    else await createNote(write.path, write.text);
  }
}
