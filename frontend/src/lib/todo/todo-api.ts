/**
 * The impure half of a write: the reads and writes, with no rules. That keeps the
 * rules in `todo-write.ts` testable with no server in front of them.
 */

import {
  createNote,
  fetchNote,
  fetchTodos,
  NoteExists,
  NoteMissing,
  type SearchHit,
  saveNote,
  searchNotes,
  updateNote,
} from "@/lib/api";
import { noteBase } from "@/lib/note-base";
import { periodicNote } from "@/lib/periodic";
import { isOpen, newId, parseTodo, type Todo, type TodoState } from "@/lib/todo/todo";
import { agentPress } from "@/lib/todo/todo-agent";
import { applyBlocked, type Closed, closedAmong } from "@/lib/todo/todo-blocked";
import type { TodoCycle } from "@/lib/todo/todo-commands";
import { lineOf } from "@/lib/todo/todo-refile";
import { expandShorthand } from "@/lib/todo/todo-shorthand";
import { parseSession } from "@/lib/todo/todo-time";
import { type SessionHit, timerWrites } from "@/lib/todo/todo-timer";
import {
  addTodoWrites,
  cycleTodoWrites,
  doneLogWrites,
  otherTodoWithId,
  pressedLine,
  type Write,
} from "@/lib/todo/todo-write";

/**
 * Today's daily note and its text, which every write here lands in or beside. `known`
 * is a note the caller has read already, so it is not asked for twice.
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
 * Send each write, one note at a time. `read` is the text each write was worked out
 * from; a note that moved since is refused with `ChangedOnDisk`, never written over.
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
 * Point every dependent of a todo that just moved at its new state. Only the notes that
 * change are written, as `links.py` does.
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
 * The notes a `<leader>x` moves besides the one it was typed into. Presses run in the
 * order made, and a write that is refused re-reads its note first (#538).
 */
export function cycleTodoAside(
  path: string,
  cycle: TodoCycle,
  today: string,
  paths: string[],
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ASIDE_WAIT_MS);
  });
  const turn = Promise.race([asideTurns, bound])
    .finally(() => clearTimeout(timer))
    .then(() => cycleAside(path, cycle, today, paths));
  // Settled either way, so the next press waits on this one and never on why
  // it failed.
  asideTurns = Promise.allSettled([turn]);
  return turn;
}

/** The press before this one, which the next waits on. */
let asideTurns: Promise<unknown> = Promise.resolve();

/**
 * How long a press waits on the one before it, then goes on alone. The api client has
 * no timeout, so a lost answer would otherwise hold every later press until reload.
 */
const ASIDE_WAIT_MS = 10_000;

async function cycleAside(
  path: string,
  cycle: TodoCycle,
  today: string,
  paths: string[],
): Promise<void> {
  const was = parseTodo(cycle.before);
  const now = parseTodo(cycle.after);
  const logs = was?.state === "done" || now?.state === "done";
  const flips = was !== null && now?.id !== undefined && isOpen(was) !== isOpen(now);

  // Only an id the line had before the press can stand anywhere else, and only
  // a press that moves another note needs to know. The buffer keeps its line:
  // the refusal covers what this would write beyond it. This note is asked of
  // the buffer, which the index can be an autosave behind.
  if (was?.id !== undefined && (logs || flips)) {
    const other = otherTodoWithId(was.id, path, cycle.line, await fetchTodos(), cycle.doc);
    if (other !== null) throw new Error(other);
  }

  if (logs) await writeDoneLogs(path, was, now, today, paths);

  // Only a press that closed or reopened a todo something can name moves what
  // waits on it. The dependents in this very note travelled with the press.
  if (flips && now?.id !== undefined) {
    await writeBackBlocked(now.id, !isOpen(now), path);
  }
}

/** The text of every note but `path` whose lines name `id`, by path. */
async function loggedNotes(id: string | undefined, path: string): Promise<Record<string, string>> {
  const logged: Record<string, string> = {};
  if (id === undefined) return logged;
  for (const found of await searchNotes(id)) {
    if (found.path !== path) logged[found.path] ??= await fetchNote(found.path);
  }
  return logged;
}

/** The done log's writes for one press into or out of done, one note at a time. */
async function writeDoneLogs(
  path: string,
  was: Todo | null,
  now: Todo | null,
  today: string,
  paths: string[],
): Promise<void> {
  const logged = await loggedNotes(now?.state === "done" ? now.id : was?.id, path);

  const daily = periodicNote("daily", new Date());
  // One note's write, worked out with `text` standing for that note. Today's
  // note goes into `logged` too, so a retry reading the line an earlier press
  // wrote there neither logs it twice nor misses it on a reopen. Visiting
  // another note, `daily.body` only fills a write that `find` throws away.
  const change = (notePath: string) => (text: string) =>
    doneLogWrites({
      was,
      now,
      path,
      dailyPath: daily.path,
      dailyText: notePath === daily.path ? text : daily.body,
      logged: { ...logged, [notePath]: text },
      today,
    }).find((write) => write.path === notePath)?.text ?? null;

  const visits = new Set([daily.path, ...Object.keys(logged)]);
  visits.delete(path);
  for (const notePath of visits) {
    // `paths` can be a listing behind a press that just made today's note,
    // so a note it leaves out may still be on disk.
    const unlisted = notePath === daily.path && !paths.includes(notePath);
    await writeLog(notePath, change(notePath), unlisted, daily.body);
  }
}

/** One note's log write: made from `body` where the listing lacks the note. */
async function writeLog(
  notePath: string,
  change: (text: string) => string | null,
  unlisted: boolean,
  body: string,
): Promise<void> {
  if (unlisted) {
    const text = change(body);
    if (text !== null) {
      try {
        await createNote(notePath, text);
        return;
      } catch (error) {
        // A press just before this one made today's note: write into it.
        if (!(error instanceof NoteExists)) throw error;
      }
    }
  }
  try {
    await updateNote(notePath, change);
  } catch (error) {
    // A reopen on a day with no note yet has no line to drop.
    if (!(unlisted && error instanceof NoteMissing)) throw error;
  }
}

/**
 * Whether the row's line still holds the row's todo: the same words and depth,
 * and the same id where both carry one. A press stamps the id the first time.
 */
function sameTodo(text: string, hit: SearchHit): boolean {
  const was = parseTodo(hit.text);
  const now = parseTodo(text.split("\n")[hit.line - 1] ?? "");
  if (was === null || now === null) return false;
  if (was.id !== undefined && now.id !== undefined && was.id !== now.id) return false;
  return was.text === now.text && was.indent === now.indent;
}

/**
 * The line the row's todo sits on now, or null where the note no longer says. Lines
 * shift with each write, so the words decide; twins, which share words, go by rank.
 */
function rowLine(text: string, hit: SearchHit, twins?: number[]): number | null {
  if (twins !== undefined && twins.length > 1) {
    const now = text.split("\n").flatMap((line, index) => (line === hit.text ? [index + 1] : []));
    if (now.length !== twins.length) return null;
    return now[twins.indexOf(hit.line)] ?? null;
  }
  return lineOf(text, hit.line, hit.text) ?? (sameTodo(text, hit) ? hit.line : null);
}

/**
 * The note as `@` leaves it, and the line it wrote. Runs inside the route's write queue,
 * and a second press keeps that line, since twins cannot be told apart.
 */
export function agentTodoIn(
  text: string,
  hit: SearchHit,
  today: string,
  twins?: number[],
): { text: string; line: string } | { why: string } {
  const at = rowLine(text, hit, twins);
  if (at === null) return { why: "that line has changed since it was listed" };
  const lines = text.split("\n");
  const pressed = agentPress(lines, at, today, newId());
  if ("why" in pressed) return pressed;
  lines[at - 1] = pressed.line;
  return { text: lines.join("\n"), line: pressed.line };
}

/** Read what the press needs, work out the writes, and send them. */
export async function cycleTodoInVault(
  hit: SearchHit,
  today: string,
  paths: string[],
  state?: TodoState,
  twins?: number[],
): Promise<void> {
  // The vault, not the row: the list is as old as the last fetch, and the note
  // is what the press is about to overwrite.
  const text = await fetchNote(hit.path);
  const at = rowLine(text, hit, twins);
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

  // The whole vault's todos, off the one pass the pane already asked for: they
  // answer for the blockers, and for whether the id is this todo's alone.
  const todos = await fetchTodos();
  if (todo.id !== undefined) {
    const other = otherTodoWithId(todo.id, hit.path, at, todos, text);
    if (other !== null) throw new Error(other);
  }

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
  // The pressed todo answers off the press itself, inside `cycleLines`.
  const closed = closedAmong(todos.flatMap((found) => parseTodo(found.text) ?? []));

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
 * Start a session on one todo, or close the ones it has running. Reads only the notes
 * naming its id, not the vault. A todo with no id is always a start.
 */
export async function toggleTimerInVault(
  hit: SearchHit,
  clock: { date: string; time: string },
  paths: string[],
  twins?: number[],
): Promise<void> {
  // The vault, not the row: the list is as old as the last fetch.
  const text = await fetchNote(hit.path);
  // The same reading a state press makes, so `t` never times another todo.
  const at = rowLine(text, hit, twins);
  if (at === null) throw new Error("that line has changed since it was listed");
  const todo = parseTodo(text.split("\n")[at - 1] ?? "");
  if (todo === null) return;

  const notes: Record<string, string> = { [hit.path]: text };
  const hits = todo.id === undefined ? [] : await searchNotes(todo.id);
  // Sessions are found by id, so a second todo carrying it would have its
  // session closed and its minutes written onto this line.
  if (todo.id !== undefined) {
    const other = otherTodoWithId(todo.id, hit.path, at, hits, text);
    if (other !== null) throw new Error(other);
  }
  const sessions: SessionHit[] = hits.map((found) => ({ path: found.path, text: found.text }));

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
    line: at,
    dailyPath: daily.path,
    notes,
    sessions,
    today: clock.date,
    now: clock.time,
    id: newId(),
  });

  await send(writes, paths, notes);
}
