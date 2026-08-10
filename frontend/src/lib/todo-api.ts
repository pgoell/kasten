/**
 * The impure half of a write: read what the press needs, and send what it says.
 *
 * `todo-write.ts` holds the rules and touches nothing. This holds the reads and
 * the writes and holds no rule, which is what keeps the rules testable with no
 * server in front of them.
 */

import {
  createNote,
  fetchNote,
  fetchTodos,
  type SearchHit,
  saveNote,
  searchNotes,
} from "@/lib/api";
import { periodicNote } from "@/lib/periodic";
import { cycleLine, isOpen, newId, parseTodo, setStateOn, type TodoState } from "@/lib/todo";
import type { TodoCycle } from "@/lib/todo-commands";
import { expandShorthand } from "@/lib/todo-shorthand";
import { parseSession } from "@/lib/todo-time";
import {
  addTodoWrites,
  applyBlocked,
  type Closed,
  closedAmong,
  cycleTodoWrites,
  doneLogWrites,
  type SessionHit,
  timerWrites,
  type Write,
} from "@/lib/todo-write";

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

/**
 * Point every dependent of the todo that just moved at its new state.
 *
 * One `GET /api/todos` answers both halves of the question: which lines name
 * this id, and whether each other blocker they name is closed. Only the notes
 * holding a dependent are read and only the ones that change are written, which
 * is how `links.py` narrows a vault-wide rewrite and for the same reason.
 *
 * No `paths` and no `send`: a dependent lives in a note the vault already
 * holds, so every write here is a save and none of them can be a create.
 */
async function writeBackBlocked(
  blockerId: string,
  closedNow: boolean,
  skip: string,
): Promise<void> {
  const todos = await fetchTodos();
  const seen = closedAmong(todos.flatMap((hit) => parseTodo(hit.text) ?? []));
  // The press is newer than the fetch, which is a render older than the line
  // it just wrote.
  const closed: Closed = (id) => (id === blockerId ? closedNow : seen(id));

  const dependents = new Set(
    todos
      .filter(
        (hit) => hit.path !== skip && parseTodo(hit.text)?.blockedBy.includes(blockerId) === true,
      )
      .map((hit) => hit.path),
  );

  for (const path of dependents) {
    const moved = applyBlocked(await fetchNote(path), closed);
    if (moved !== null) await saveNote(path, moved);
  }
}

/**
 * The notes a `<leader>x` moves besides the one it was typed into.
 *
 * The buffer already carries the cycled line and autosave writes it, so this
 * writes the `## Done` log and the dependents living in other notes. It reads
 * the vault only for a press that enters or leaves done or moves a blocker,
 * which is three presses out of six.
 *
 * A write to the note the key was typed into is dropped: the buffer owns that
 * note, and a `PUT` over it would land on text somebody is still typing. The
 * dependents in there travelled with the press for the same reason.
 */
export async function cycleTodoAside(
  path: string,
  cycle: TodoCycle,
  today: string,
  paths: string[],
): Promise<void> {
  const was = parseTodo(cycle.before);
  const now = parseTodo(cycle.after);

  if (was?.state === "done" || now?.state === "done") {
    const id = now?.state === "done" ? now.id : was?.id;
    const logged: Record<string, string> = {};
    if (id !== undefined) {
      for (const found of await searchNotes(id)) {
        if (found.path !== path) logged[found.path] ??= await fetchNote(found.path);
      }
    }

    const daily = await dailyNote(paths, logged);
    const writes = doneLogWrites({
      was,
      now,
      path,
      dailyPath: daily.path,
      dailyText: daily.text,
      logged,
      today,
    });

    await send(
      writes.filter((write) => write.path !== path),
      paths,
    );
  }

  // Only a press that closed or reopened a todo something can name moves what
  // waits on it. The dependents in this very note travelled with the press.
  if (was !== null && now?.id !== undefined && isOpen(was) !== isOpen(now)) {
    await writeBackBlocked(now.id, !isOpen(now), path);
  }
}

/** Read what the press needs, work out the writes, and send them. */
export async function cycleTodoInVault(
  hit: SearchHit,
  today: string,
  paths: string[],
  state?: TodoState,
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
  const id = newId();
  // The whole vault's blockers, off the one pass the pane already asked for.
  // The pressed todo answers off the press itself, inside `cycleLines`.
  const closed = closedAmong((await fetchTodos()).flatMap((found) => parseTodo(found.text) ?? []));

  const writes = cycleTodoWrites({
    path: hit.path,
    text,
    line: hit.line,
    dailyPath: daily.path,
    dailyText: daily.text,
    logged,
    today,
    id,
    closed,
    state,
  });

  await send(writes, paths);

  // After the send, so the dependents in this note are read as the write above
  // left them. No note is skipped: this half can see every blocker, where the
  // press could see only the ones in the note it moved.
  const line = text.split("\n")[hit.line - 1] ?? "";
  const now = parseTodo(
    state === undefined ? cycleLine(line, today, id) : setStateOn(line, state, today, id),
  );
  if (now?.id !== undefined && isOpen(todo) !== isOpen(now)) {
    await writeBackBlocked(now.id, !isOpen(now), "");
  }
}

/**
 * Start a session on one todo, or close the ones it has running.
 *
 * One narrow pass rather than the vault-wide scan: `searchNotes(id)` answers
 * with every line naming this todo, which is the whole of its log, and only the
 * notes holding an open session are then read. A todo carrying no id is
 * unambiguously a start, and nothing can name it, so it asks the vault nothing
 * at all beyond its own note and today's.
 */
export async function toggleTimerInVault(
  hit: SearchHit,
  clock: { date: string; time: string },
  paths: string[],
): Promise<void> {
  // The vault, not the row: the list is as old as the last fetch.
  const text = await fetchNote(hit.path);
  const todo = parseTodo(text.split("\n")[hit.line - 1] ?? "");
  if (todo === null) return;

  const notes: Record<string, string> = { [hit.path]: text };
  const sessions: SessionHit[] =
    todo.id === undefined
      ? []
      : (await searchNotes(todo.id)).map((found) => ({ path: found.path, text: found.text }));

  // Only the notes a close would rewrite. The closed lines are read for their
  // minutes alone, and the search already answered with those whole.
  for (const found of sessions) {
    const session = parseSession(found.text);
    if (session === null || session.end !== undefined) continue;
    notes[found.path] ??= await fetchNote(found.path);
  }

  const daily = await dailyNote(paths, notes);
  notes[daily.path] = daily.text;

  const writes = timerWrites({
    path: hit.path,
    line: hit.line,
    dailyPath: daily.path,
    notes,
    sessions,
    today: clock.date,
    now: clock.time,
    id: newId(),
  });

  await send(writes, paths);
}
