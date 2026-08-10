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
import { expandShorthand } from "@/lib/todo-shorthand";
import { addTodoWrites, cycleTodoWrites, type Write } from "@/lib/todo-write";

/**
 * Today's daily note, and its text, which every write here lands in or beside.
 *
 * The clock is read here rather than off the caller's `today`, `periodicNote`
 * wanting a date. Both come from the same wall clock one render apart. `known`
 * is what the caller has already read, so a note in hand is not asked for twice.
 */
async function dailyNote(
  paths: string[],
  known: Record<string, string> = {},
): Promise<{ path: string; text: string }> {
  const daily = periodicNote("daily", new Date());
  const text =
    known[daily.path] ??
    // The leading newline is the create's, the way `follow` writes one: the
    // body lands under a frontmatter block and wants a line between.
    (paths.includes(daily.path) ? await fetchNote(daily.path) : `\n${daily.body}`);
  return { path: daily.path, text };
}

/** Send each write, one note at a time. */
async function send(writes: Write[], paths: string[]): Promise<void> {
  for (const write of writes) {
    // A path the vault does not hold is only ever today's daily note, which a
    // create makes along with the folders on the way to it.
    if (paths.includes(write.path)) await saveNote(write.path, write.text);
    else await createNote(write.path, write.text);
  }
}

/** Put what was typed into today's note, under `## TODOs`. */
export async function addTodoInVault(input: string, today: string, paths: string[]): Promise<void> {
  const daily = await dailyNote(paths);
  const writes = addTodoWrites({
    dailyPath: daily.path,
    dailyText: daily.text,
    todo: expandShorthand(input, today),
  });
  await send(writes, paths);
}

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

  const daily = await dailyNote(paths, logged);

  const writes = cycleTodoWrites({
    path: hit.path,
    text,
    line: hit.line,
    dailyPath: daily.path,
    dailyText: daily.text,
    logged,
    today,
    id: newId(),
  });

  await send(writes, paths);
}
