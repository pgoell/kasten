/**
 * The todo writes the pane, the board and the prompts make, each one call to the todo store,
 * which applies the rules itself. `cycleTodoAside` alone still writes notes, for a checkbox typed in one.
 */

import type { QueryClient } from "@tanstack/react-query";
import {
  addTodoLine,
  changeTodoLine,
  createNote,
  cycleStoreTodo,
  fetchNote,
  fetchTodos,
  NoteExists,
  NoteMissing,
  patchTodo,
  type SearchHit,
  searchNotes,
  setTodoState,
  type TodoHit,
  type TodoRow,
  toggleTodoTimer,
  updateNote,
} from "@/lib/core/api";
import { periodicNote } from "@/lib/notes/text/periodic";
import {
  formatTodo,
  isOpen,
  newId,
  parseTodo,
  setStateOn,
  type Todo,
  type TodoState,
} from "@/lib/todo/todo";
import { agentPress } from "@/lib/todo/todo-agent";
import { applyBlocked, type Closed, closedAmong, unblockedEdit } from "@/lib/todo/todo-blocked";
import type { TodoCycle } from "@/lib/todo/todo-commands";
import { inTurn } from "@/lib/todo/todo-press-echo";
import { expandShorthand } from "@/lib/todo/todo-shorthand";
import { parseSession } from "@/lib/todo/todo-time";
import { doneLogWrites, otherTodoWithId } from "@/lib/todo/todo-write";

/** A listed line, with the store row behind it where the listing sent one. */
type Listed = SearchHit & { todo?: TodoRow | null };

/**
 * The store id behind a row: its row first, since a press drawn ahead of the store can leave
 * plain words; else the `🆔` every todo line carries, or a timer line's id.
 */
export function todoIdOf(hit: Listed): string {
  const id = hit.todo?.id ?? parseTodo(hit.text)?.id ?? parseSession(hit.text)?.id;
  if (id === undefined) throw new Error("that line names no todo");
  return id;
}

/**
 * The line of `path` that embeds the todo listed at `line`, or the todo it is a part of: a store
 * todo's listed line counts todos, not the note's lines. Any line no todo is listed at stays.
 */
export function noteLineOf(
  client: QueryClient,
  path: string,
  line: number,
): number | Promise<number> {
  const hits = client
    .getQueriesData<TodoHit[]>({ queryKey: ["todos"] })
    .flatMap(([, h]) => h ?? []);
  const listed = hits.find((hit) => hit.path === path && hit.line === line)?.todo;
  // Answered now where nothing needs reading, so a plain open stays synchronous.
  if (!listed) return line;
  const rows = new Map(hits.flatMap((hit) => (hit.todo ? [[hit.todo.id, hit.todo] as const] : [])));
  return client
    .ensureQueryData({ queryKey: ["note", path], queryFn: () => fetchNote(path) })
    .then((text) => {
      const lines = text.split("\n");
      for (let row = rows.get(listed.id); row; ) {
        const embed = `![[${row.id}]]`;
        const at = lines.findIndex((each) => each.includes(embed));
        if (at >= 0) return at + 1;
        row = row.parent_id === null ? undefined : rows.get(row.parent_id);
      }
      return 1;
    });
}

/**
 * The note line a todo's `![[kt-…]]` sits on, or its parent's for a part, which has none. A
 * listing's `line` counts todos, not note lines (#2191); no embed opens the note at its top.
 */
export async function embedLineOf(hit: Listed): Promise<number | undefined> {
  const id = hit.todo?.id ?? parseTodo(hit.text)?.id;
  if (id === undefined) return undefined;
  let lines: string[];
  try {
    lines = (await fetchNote(hit.path)).split("\n");
  } catch (error) {
    if (error instanceof NoteMissing) return undefined;
    throw error;
  }
  for (const each of [id, hit.todo?.parent_id]) {
    const at = lines.findIndex((line) => line.includes(`![[${each}]]`));
    if (each && at >= 0) return at + 1;
  }
  return undefined;
}

/** Open a listed todo's note at its embed, else at its listed line. */
export function openTodo(hit: Listed, onOpen: (path: string, line: number) => void): void {
  // With no embed, a line the note still holds is where the listing found it.
  void embedLineOf(hit).then((line) => onOpen(hit.path, line ?? hit.line));
}

/** The store row behind an id, as the listing last read it; a `PATCH` needs its version. */
export type RowOf = (id: string) => TodoRow | undefined;

function rowNamed(rowOf: RowOf, id: string): TodoRow {
  const row = rowOf(id);
  if (row === undefined) throw new Error("that todo is not in the list yet");
  return row;
}

/** Each `id@version` a write from here produced, so an edit read before one is not refused for it. */
const ours = new Set<string>();
/** Far above the writes out during one edit; dropping on the event would refuse an edit opened before it. */
const KEPT = 200;

/** Run one store write in turn, noting the versions it produced. */
function ownTurn(work: () => Promise<TodoRow[]>): Promise<TodoRow[]> {
  return inTurn(async () => {
    const rows = await work();
    for (const row of rows) ours.add(`${row.id}@${row.version}`);
    for (const old of ours) {
      if (ours.size <= KEPT) break;
      ours.delete(old);
    }
    return rows;
  });
}

/** The version a line read at `read` is sent at: past each change since that a write from here made. */
function sentAt(id: string, read: number | undefined): number {
  if (read === undefined) throw new Error("that todo is not in the list yet");
  let at = read;
  while (ours.has(`${id}@${at + 1}`)) at += 1;
  return at;
}

/** Put what was typed into today's note. */
export function addTodoInVault(input: string, today: string): Promise<TodoRow[]> {
  return ownTurn(() => addTodoLine(formatTodo(expandShorthand(input, today))));
}

/** Put a typed todo under the row's todo as a part of it. */
export function addSubtaskInVault(
  hit: SearchHit,
  input: string,
  today: string,
): Promise<TodoRow[]> {
  return ownTurn(() => addTodoLine(formatTodo(expandShorthand(input, today)), todoIdOf(hit)));
}

/** Walk one todo on, or set the state a key named; a state it is in already sends nothing. */
export function cycleTodoInVault(hit: Listed, state?: TodoState): Promise<TodoRow[]> {
  return ownTurn(async () => {
    const id = todoIdOf(hit);
    if (state === undefined) return cycleStoreTodo(id);
    if (parseTodo(hit.text)?.state === state) return [];
    return setTodoState(id, state);
  });
}

/** Start a session on one todo, or close the ones it has running. */
export function toggleTimerInVault(hit: SearchHit): Promise<TodoRow[]> {
  return ownTurn(() => toggleTodoTimer(todoIdOf(hit)));
}

/**
 * Change the todo to what the edited line says, box and fields included, as read at `read`. A `[b]`
 * whose last `⛔` the edit took off goes as open, or the store would block it again by its box.
 */
export function editTodoInVault(
  hit: Listed,
  line: string,
  read = hit.todo?.version,
): Promise<TodoRow[]> {
  return ownTurn(async () => {
    const id = todoIdOf(hit);
    return changeTodoLine(id, unblockedEdit(hit.text, line), sentAt(id, read));
  });
}

/** Make the row's todo wait on the blocker picked. */
export function blockTodoInVault(
  hit: SearchHit,
  blocker: SearchHit,
  rowOf: RowOf,
): Promise<TodoRow[]> {
  return ownTurn(async () => {
    const row = rowNamed(rowOf, todoIdOf(hit));
    const by = todoIdOf(blocker);
    if (row.blocked_by.includes(by)) return [];
    return patchTodo(row.id, { version: row.version, blocked_by: [...row.blocked_by, by] });
  });
}

/** Move the row's todo into `note` under `project`; a part leaves its parent, or it would stay drawn there. */
export function moveTodoInVault(
  hit: SearchHit,
  move: { project: string; note: string },
  rowOf: RowOf,
): Promise<TodoRow[]> {
  return ownTurn(async () => {
    const row = rowNamed(rowOf, todoIdOf(hit));
    const parent = row.parent_id === null ? {} : { parent_id: null };
    return patchTodo(row.id, { version: row.version, ...move, ...parent });
  });
}

/**
 * Hand one todo to the agent worker, or take it back, by `#agent` in its line. `lines` is the
 * row's note as listed, so a client tag on a todo above it counts.
 */
export function agentTodoInVault(
  hit: Listed,
  lines: string[],
  today: string,
  rowOf: RowOf,
  sent?: (line: string) => void,
): Promise<TodoRow[]> {
  return ownTurn(async () => {
    const id = todoIdOf(hit);
    // The line sends its box, and an `x` just before may have moved the todo past the one drawn (#2084).
    const row = rowOf(id);
    const state = row?.state;
    const read = [...lines];
    read[hit.line - 1] = state === undefined ? hit.text : setStateOn(hit.text, state, today, id);
    const pressed = agentPress(read, hit.line, today, newId());
    if ("why" in pressed) throw new Error(pressed.why);
    sent?.(pressed.line);
    return changeTodoLine(id, pressed.line.trimStart(), sentAt(id, (row ?? hit.todo)?.version));
  });
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
  return inTurn(() => cycleAside(path, cycle, today, paths));
}

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
