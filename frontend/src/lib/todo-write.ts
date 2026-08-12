/**
 * One press, and the notes it writes.
 *
 * Pure: no server, no editor and no clock, which is what lets a rule about
 * three notes at once be tested with a string per note. `todo-api.ts` is the
 * impure half that reads what these need and sends what they answer.
 *
 * Ticking a todo done can move two notes, the todo's own and the daily note
 * holding the log, and un-ticking one can move any note the log line landed in.
 * This is the one module that knows that.
 */

import { appendUnder, type Edit } from "@/lib/note-section";
import { dailyDate } from "@/lib/periodic";
import {
  cycleLine,
  formatTodo,
  isOpen,
  parseTodo,
  setStateOn,
  type Todo,
  type TodoState,
} from "@/lib/todo";
import { nextOccurrence } from "@/lib/todo-recur";
import {
  formatDuration,
  formatSession,
  minutesBetween,
  parseSession,
  type Session,
} from "@/lib/todo-time";
import { descendants, type Node, type Placed, treeOf } from "@/lib/todo-view";

/** One note as a write: where it goes and the whole of its new text. */
export interface Write {
  path: string;
  text: string;
}

export interface CycleInput {
  /** Where the todo lives, and the whole of that note. */
  path: string;
  text: string;
  /** Which line the todo is on, counting from one. */
  line: number;
  /** Today's daily note, and its text, or `periodicNote` body where the vault has none. */
  dailyPath: string;
  dailyText: string;
  /** Every note holding a `- ✅` line naming this todo's id, keyed by path. */
  logged: Record<string, string>;
  today: string;
  /** A fresh id, used only when the todo enters done carrying none. */
  id: string;
  /** Whether a blocker is closed, as far as the caller can see. */
  closed: Closed;
  /** The state the key named, or nothing where the key walks the cycle. */
  state?: TodoState;
}

export interface AddInput {
  dailyPath: string;
  dailyText: string;
  todo: Todo;
}

/** The heading the done log lives under, made on first write. */
const DONE = "## Done";

/** Where the add prompt writes. `periodic.ts` puts it in a fresh daily note. */
const TODOS = "## TODOs";

/** The heading the time log lives under, made on first write as `## Done` is. */
const TIME = "## Time";

/** The latest a session could have run on the day its note is named for. */
const LAST_MINUTE = "23:59";

/** A log line, which is deliberately not a checkbox. See `doneLine`. */
const LOGGED = "- ✅";

/**
 * The line the done log carries: what was finished, where it lives, and its id.
 *
 * Not a checkbox, and that is the whole reason it is spelled this way:
 * `GET /api/todos` matches the shape of a checkbox line, so a `- [x]` here
 * would put every finished todo in the pane twice, once as itself and once as
 * its own log entry, with nothing on either line to tell them apart.
 */
export function doneLine(todo: Todo, notePath: string, dailyPath: string, today: string): string {
  const parts = [LOGGED, today, todo.text];
  // A note pointing at itself records nothing.
  if (notePath !== dailyPath) parts.push(`[[${notePath.replace(/\.md$/, "")}]]`);
  if (todo.id !== undefined) parts.push(todo.id);
  return parts.join(" ");
}

/** Whether a line is the log's, and names this todo. One reader, two callers. */
function namesInLog(line: string, id: string): boolean {
  return line.trimStart().startsWith(LOGGED) && line.includes(id);
}

/** Every `- ✅` line naming `id`, as the edit that takes it out. Newest last. */
export function doneLineEdits(text: string, id: string): Edit[] {
  const edits: Edit[] = [];
  let offset = 0;

  for (const line of text.split("\n")) {
    // The newline goes with the line, or taking one out leaves a blank behind.
    if (namesInLog(line, id))
      edits.push({ from: offset, to: offset + line.length + 1, insert: "" });
    offset += line.length + 1;
  }

  return edits;
}

/** Drop every `- ✅` line naming `id`. Null where the note holds none. */
export function dropDone(text: string, id: string): string | null {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !namesInLog(line, id));
  return kept.length === lines.length ? null : kept.join("\n");
}

/**
 * The one note the add prompt writes: today's, with the todo under `## TODOs`.
 *
 * A list of one, so the caller sends what this answers the way it sends what
 * `cycleTodoWrites` answers. A daily note the vault does not hold yet arrives
 * here as `periodicNote`'s body, which already carries the heading.
 */
export function addTodoWrites({ dailyPath, dailyText, todo }: AddInput): Write[] {
  return [{ path: dailyPath, text: appendUnder(dailyText, TODOS, formatTodo(todo)) }];
}

/** How far one step of nesting shifts a line. Two spaces, as the vault writes them. */
const STEP = 2;

/**
 * The note with `todo` written in as a part of the todo on `line`. Null where
 * that line is not one, as `dropDone` is null where nothing moved.
 *
 * A part is an indent and nothing else, so the whole of this is where the line
 * goes and how far in. It goes after the parts the parent already has rather
 * than straight under it, which is where a list you are adding to grows, and one
 * step past the parent's own indent however deep that already runs.
 */
export function insertSubtask(text: string, line: number, todo: Todo): string | null {
  const lines = text.split("\n");
  const parent = parseTodo(lines[line - 1] ?? "");
  if (parent === null) return null;

  // The tree rather than the lines below it: a part can be several lines down
  // with prose between, which `treeOf` reads through and a scan would stop at.
  const node = nodeAt(lines, line);
  const under = node === null ? [] : descendants(node);
  const at = under.reduce((last, part) => Math.max(last, part.line), line);

  lines.splice(at, 0, formatTodo({ ...todo, indent: parent.indent + STEP }));
  return lines.join("\n");
}

export interface LogInput {
  /** The todo as the line read before the press, or null where it was not one. */
  was: Todo | null;
  /** The todo as the line reads after it, or null where it is no longer one. */
  now: Todo | null;
  /** Where the todo lives, which is what the log line links to. */
  path: string;
  dailyPath: string;
  dailyText: string;
  /** Every note holding a `- ✅` line naming this todo's id, keyed by path. */
  logged: Record<string, string>;
  today: string;
}

/**
 * Every note the `## Done` log moves, and nothing else.
 *
 * Its own function because the two keys that cycle a todo need different halves
 * of a press. The pane's `x` writes the todo's note itself; `<leader>x` edits
 * the buffer and leaves that note to autosave, so it needs this half alone.
 *
 * A press that touches neither end of done answers nothing, which is what lets
 * the caller skip reading the vault for four presses out of six.
 */
export function doneLogWrites(input: LogInput): Write[] {
  const { was, now, path, dailyPath, dailyText, logged, today } = input;

  // Keyed by path, so a note that both holds the todo and holds its log line
  // is one write rather than two that overwrite each other.
  const writes = new Map<string, string>();

  if (now?.state === "done") {
    // Already logged, from an earlier tick that was taken back and put on
    // again. Ticking twice leaves one line rather than a pile.
    const already = Object.values(logged).some((note) => dropDone(note, now.id ?? "") !== null);
    if (!already) {
      // A todo living in today's note is logged there like any other. The
      // daily note is where most todos are written, so skipping it would leave
      // `## Done` empty for the commonest way of working. What such a line does
      // not need is the link, and `doneLine` leaves that off on its own.
      writes.set(dailyPath, appendUnder(dailyText, DONE, doneLine(now, path, dailyPath, today)));
    }
  }

  // Leaving done drops the line wherever it turns up, which is what lets you
  // un-tick something you finished last Tuesday.
  if (was?.state === "done" && was.id !== undefined) {
    for (const [loggedPath, loggedText] of Object.entries(logged)) {
      const dropped = dropDone(writes.get(loggedPath) ?? loggedText, was.id);
      if (dropped !== null) writes.set(loggedPath, dropped);
    }
  }

  return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
}

/**
 * Whether a blocker is closed, or nothing where the caller cannot see it.
 *
 * Nothing reads as still open, so a dependent is never opened on a guess. The
 * buffer builds this from the document it holds; the vault writer builds it
 * from every todo the vault holds.
 */
export type Closed = (id: string) => boolean | undefined;

/** A resolver over the todos in hand. An id none of them carries answers nothing. */
export function closedAmong(todos: Todo[]): Closed {
  const states = new Map<string, boolean>();
  for (const todo of todos) if (todo.id !== undefined) states.set(todo.id, !isOpen(todo));
  return (id) => states.get(id);
}

/**
 * Every `⛔` line in `lines` whose state kasten owns and whose blockers
 * disagree with it, keyed by line number.
 *
 * `⛔` on a line means kasten owns the choice between `[ ]` and `[b]` there.
 * `[/]`, `[x]` and `[-]` are never touched, so a state set by hand cannot be
 * destroyed by a blocker moving.
 */
export function blockedLines(lines: string[], closed: Closed): Map<number, string> {
  const moved = new Map<number, string>();

  for (const [index, text] of lines.entries()) {
    const todo = parseTodo(text);
    if (todo === null || todo.blockedBy.length === 0) continue;
    if (todo.state !== "open" && todo.state !== "blocked") continue;

    // Every blocker has to be closed, and one this cannot see reads as open.
    const held = todo.blockedBy.some((blocker) => closed(blocker) !== true);
    const state = held ? "blocked" : "open";
    if (todo.state !== state) moved.set(index + 1, formatTodo({ ...todo, state }));
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

export interface CycleLinesInput {
  /** The whole note, split on newlines. */
  lines: string[];
  /** Which line the press is on, counting from one. */
  line: number;
  today: string;
  /** A fresh id, used only when the todo enters done carrying none. */
  id: string;
  /** Whether a blocker is closed. The press's own todo is answered from the press. */
  closed: Closed;
  /** The state the key named, or nothing where the key walks the cycle. */
  state?: TodoState;
}

/** The line one press writes, whether it walks the cycle or names a state. */
function pressed(line: string, today: string, id: string, state?: TodoState): string {
  return state === undefined ? cycleLine(line, today, id) : setStateOn(line, state, today, id);
}

/**
 * The todo the press is on, as a node of its note's tree. Null where it is not
 * one, and null for a todo nothing hangs off, which needs no tree walked.
 */
function nodeAt(lines: string[], line: number): Node | null {
  const placed: Placed[] = [];
  for (const [index, text] of lines.entries()) {
    const todo = parseTodo(text);
    if (todo !== null) placed.push({ line: index + 1, todo });
  }

  for (const root of treeOf(placed)) {
    const found = [root, ...descendants(root)].find((node) => node.line === line);
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * Every line of this note one press rewrites, keyed by line number.
 *
 * One map rather than three passes of edits, so no two rules can claim a line
 * and hand CodeMirror an overlapping change. A value may hold a newline, which
 * is how the recurrence copy arrives above the line it belongs to.
 */
export function cycleLines({
  lines,
  line,
  today,
  id,
  closed,
  state,
}: CycleLinesInput): Map<number, string> {
  const before = lines[line - 1] ?? "";
  const was = parseTodo(before);
  const cycled = pressed(before, today, id, state);
  const now = parseTodo(cycled);
  const moved = new Map<number, string>([[line, cycled]]);

  // Finishing the whole thing finishes the parts, so entering done takes every
  // open descendant with it. Leaving done cascades nothing, and ticking the
  // last part leaves the parent alone: that inference is the one often wrong.
  if (was?.state !== "done" && now?.state === "done") {
    const node = nodeAt(lines, line);
    for (const part of node === null ? [] : descendants(node)) {
      // No id on a part: nothing names it, the log writes one line for the
      // press, and that line names the parent.
      if (isOpen(part.todo)) {
        moved.set(part.line, formatTodo({ ...part.todo, state: "done", done: today }));
      }
    }
  }

  // From the blocker's side and only from there: closing or reopening a todo
  // that carries an id is what moves the lines waiting on it. A press that
  // leaves the line no longer a todo moves nothing, nothing being able to
  // resolve it any more.
  if (was !== null && now?.id !== undefined && isOpen(was) !== isOpen(now)) {
    const after = [...lines];
    for (const [at, insert] of moved) after[at - 1] = insert;
    // The press is newer than whatever the caller can see, so this one id is
    // answered off the line the press just wrote.
    const resolve: Closed = (blocker) => (blocker === now.id ? !isOpen(now) : closed(blocker));

    for (const [at, insert] of blockedLines(after, resolve)) {
      // The press and the cascade keep the lines they claimed. Two rules must
      // never hand CodeMirror one line twice.
      if (!moved.has(at)) moved.set(at, insert);
    }
  }

  // Last, and folded into the pressed line's own entry rather than added beside
  // it: one change over one range, so nothing has to reason about how an
  // insertion and a replacement at one position order. The completed line stays
  // where it is with its `✅`, and the note carries the history in place.
  if (was !== null && was.state !== "done" && now?.state === "done") {
    const fresh = nextOccurrence(was, today);
    if (fresh !== null) moved.set(line, `${formatTodo(fresh)}\n${cycled}`);
  }

  return moved;
}

/** Every note one press of the cycle changes, in the order they should be sent. */
export function cycleTodoWrites(input: CycleInput): Write[] {
  const { path, text, line, dailyPath, dailyText, logged, today, id, closed, state } = input;

  const lines = text.split("\n");
  const was = parseTodo(lines[line - 1] ?? "");
  // The line the press was on, read on its own: its entry in the map can hold
  // the recurrence copy as well, and the log is about the todo that was ticked.
  const now = parseTodo(pressed(lines[line - 1] ?? "", today, id, state));

  for (const [at, insert] of cycleLines({ lines, line, today, id, closed, state })) {
    lines[at - 1] = insert;
  }
  const own = lines.join("\n");

  const writes = new Map<string, string>([[path, own]]);

  // The log reads the cycled text wherever it lands in the same note as the
  // todo, so neither half can throw the other away. That is both the daily
  // note a todo lives in and any note holding a stray log line.
  const seen = logged[path] === undefined ? logged : { ...logged, [path]: own };
  for (const write of doneLogWrites({
    was,
    now,
    path,
    dailyPath,
    dailyText: path === dailyPath ? own : dailyText,
    logged: seen,
    today,
  })) {
    writes.set(write.path, write.text);
  }

  return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
}

/** One line `searchNotes` answered with, and the note it was found in. */
export interface SessionHit {
  path: string;
  text: string;
}

export interface TimerInput {
  /** Where the todo lives, and which line it is on, counting from one. */
  path: string;
  line: number;
  /** Today's daily note, which a start writes into. */
  dailyPath: string;
  /**
   * Every note this may rewrite, keyed by path and read once: the todo's own
   * note, today's daily note, and every note holding an open session for it.
   */
  notes: Record<string, string>;
  /**
   * Every session line naming this todo, as `searchNotes(id)` answered with
   * them, running and closed alike. Empty for a todo carrying no id, which
   * nothing can name and so has no sessions.
   */
  sessions: SessionHit[];
  today: string;
  /** The wall clock as `HH:MM`. */
  now: string;
  /** A fresh id, used only when the todo carries none. */
  id: string;
}

/** The session a start writes: the todo's words, where it lives, and its id. */
export function sessionOf(todo: Todo, notePath: string, dailyPath: string, start: string): Session {
  return {
    start,
    text: todo.text,
    // A note pointing at itself records nothing, the way `doneLine` has it.
    link: notePath === dailyPath ? undefined : notePath.replace(/\.md$/, ""),
    id: todo.id,
  };
}

/** Close every open session naming `id`, at `end`. Null where none moved. */
export function closeSessions(text: string, id: string, end: string): string | null {
  const lines = text.split("\n");
  let moved = false;

  for (const [index, line] of lines.entries()) {
    const session = parseSession(line);
    if (session === null || session.end !== undefined || session.id !== id) continue;
    lines[index] = formatSession({ ...session, end });
    moved = true;
  }

  return moved ? lines.join("\n") : null;
}

/** Every note one press of `t` changes, in the order they should be sent. */
export function timerWrites(input: TimerInput): Write[] {
  const { path, line, dailyPath, notes, sessions, today, now } = input;

  const own = notes[path] ?? "";
  const lines = own.split("\n");
  const todo = parseTodo(lines[line - 1] ?? "");
  // The line moved, or somebody edited it into prose, as `cycleTodoInVault`
  // bails on the same reading.
  if (todo === null) return [];

  const id = todo.id ?? input.id;

  // `searchNotes` answers with every line holding the id, the task line and the
  // done log line among them, so the id is checked here rather than trusted.
  // A session in a note that is not a daily one is somebody's own log: nothing
  // says which day it belongs to, so kasten leaves it alone.
  const mine = sessions.flatMap((hit) => {
    const session = parseSession(hit.text);
    const day = dailyDate(hit.path);
    if (session === null || session.id !== id || day === null) return [];
    return [{ path: hit.path, day, session }];
  });

  // Keyed by path, so a todo living in today's own note produces one write
  // rather than three that overwrite each other.
  const writes = new Map<string, string>();

  const running = mine.filter(({ session }) => session.end === undefined);
  if (running.length === 0) {
    // The session line has to name something, so a start stamps an id the way
    // entering done does.
    if (todo.id === undefined) {
      lines[line - 1] = formatTodo({ ...todo, id });
      writes.set(path, lines.join("\n"));
    }

    const daily = writes.get(dailyPath) ?? notes[dailyPath] ?? "";
    const session = sessionOf({ ...todo, id }, path, dailyPath, now);
    writes.set(dailyPath, appendUnder(daily, TIME, formatSession(session)));

    return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
  }

  // One rule for the timer somebody forgot and for the one that crossed
  // midnight: a session is closed in the note it lives in, at the last minute of
  // the day that note stands for. Every session in one note shares its day.
  const end = (day: string) => (day === today ? now : LAST_MINUTE);

  for (const [notePath, day] of new Map(running.map((found) => [found.path, found.day]))) {
    const closed = closeSessions(writes.get(notePath) ?? notes[notePath] ?? "", id, end(day));
    if (closed !== null) writes.set(notePath, closed);
  }

  // The log is the record, and `⏱` is kasten's summary of it: every stop sums
  // the whole log rather than adding this session to whatever the line carried,
  // so correcting a session line by hand puts the total back in step.
  const total = mine.reduce(
    (sum, { session, day }) => sum + minutesBetween(session.start, session.end ?? end(day)),
    0,
  );

  // The text as the closes left it, because a todo living in today's own note
  // is both the note being closed in and the note carrying the task line.
  const after = (writes.get(path) ?? own).split("\n");
  after[line - 1] = formatTodo({ ...todo, id, worked: formatDuration(total) });
  writes.set(path, after.join("\n"));

  return [...writes].map(([writePath, writeText]) => ({ path: writePath, text: writeText }));
}
