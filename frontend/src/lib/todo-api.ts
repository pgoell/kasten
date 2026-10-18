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
  updateNote,
} from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { isOpen, newId, parseTodo, patchLine, type TodoState } from "@/lib/todo";
import type { TodoCycle } from "@/lib/todo-commands";
import { lineOf } from "@/lib/todo-refile";
import { expandShorthand } from "@/lib/todo-shorthand";
import { parseSession } from "@/lib/todo-time";
import {
  addTodoWrites,
  applyBlocked,
  blockLine,
  type Closed,
  closedAmong,
  cycleTodoWrites,
  doneLogWrites,
  insertSubtask,
  pressedLine,
  type SessionHit,
  timerWrites,
  unblockedEdit,
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
    // The body goes over as it stands, the way `follow` sends one: `periodic.ts`
    // opens it with the frontmatter block, and a line in front of that fence
    // would leave the note untyped.
    (paths.includes(daily.path) ? await fetchNote(daily.path) : daily.body);
  return { path: daily.path, text };
}

/**
 * Send each write, one note at a time.
 *
 * `read` is the text each write was worked out from, and names its base: a
 * note that moved since is refused with `ChangedOnDisk` rather than written
 * over, and the press fails the way any other failed write does.
 */
async function send(writes: Write[], paths: string[], read: Record<string, string>): Promise<void> {
  for (const write of writes) {
    // A path the vault does not hold is only ever today's daily note, which a
    // create makes along with the folders on the way to it.
    if (!paths.includes(write.path)) {
      await createNote(write.path, write.text);
      continue;
    }
    const text = read[write.path];
    if (text === undefined) throw new Error(`no read of ${write.path} to name as its base`);
    await saveNote(write.path, write.text, false, noteBase(text));
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
  await send(writes, paths, { [daily.path]: daily.text });
}

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

  const id = named.id ?? newId();
  const seen = closedAmong((await fetchTodos()).flatMap((found) => parseTodo(found.text) ?? []));
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

  for (const path of dependents) await updateNote(path, (text) => applyBlocked(text, closed));
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
      { ...logged, [daily.path]: daily.text },
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
  // The row's own line, by its words where a write since has shifted it: a
  // card held through a drag, or a key pressed just after an agent wrote above
  // it, would otherwise set whatever todo sits at that number now.
  const at = lineOf(text, hit.line, hit.text);
  if (at === null) throw new Error("that line has changed since it was listed");
  const line = text.split("\n")[at - 1] ?? "";
  const todo = parseTodo(line);
  // Only a row whose own words are no todo, which the listing never hands over.
  if (todo === null) return;

  // The id goes only into the write, so stamping it before the search changes
  // nothing; it lets the press be read here, ahead of the search, as it will land.
  const id = newId();
  const pressed = pressedLine(line, today, id, state);
  // A press that leaves the line as it is, such as `X` on a done todo, has
  // nothing to log, unblock or write, so it costs no search and no save.
  if (pressed === null) return;
  const now = parseTodo(pressed);

  // Only a press that enters or leaves done touches the log, and any todo with
  // an id that does may be named by a line already written: a hand or an agent
  // can move a ticked todo to any state with its log line left in place, so the
  // state it comes from says nothing. A todo with no id needs no search, since
  // nothing can name a todo that has never had a name.
  const named =
    (todo.state === "done" || now?.state === "done") && todo.id !== undefined
      ? new Set((await searchNotes(todo.id)).map((found) => found.path))
      : new Set<string>();

  const logged: Record<string, string> = {};
  for (const path of named) {
    logged[path] = path === hit.path ? text : await fetchNote(path);
  }

  const daily = await dailyNote(paths, logged);
  // The whole vault's blockers, off the one pass the pane already asked for.
  // The pressed todo answers off the press itself, inside `cycleLines`.
  const closed = closedAmong((await fetchTodos()).flatMap((found) => parseTodo(found.text) ?? []));

  const writes = cycleTodoWrites({
    path: hit.path,
    text,
    line: at,
    dailyPath: daily.path,
    dailyText: daily.text,
    logged,
    today,
    id,
    closed,
    state,
  });

  await send(writes, paths, { ...logged, [hit.path]: text, [daily.path]: daily.text });

  // After the send, so the dependents in this note are read as the write above
  // left them. No note is skipped: this half can see every blocker, where the
  // press could see only the ones in the note it moved.
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

  await send(writes, paths, notes);
}
