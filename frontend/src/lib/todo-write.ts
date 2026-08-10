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

import { cycleLine, formatTodo, isOpen, parseTodo, type Todo } from "@/lib/todo";
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

/** Any heading, which is what ends the section above it. */
const HEADING = /^#{1,6} /;

/** A log line, which is deliberately not a checkbox. See `doneLine`. */
const LOGGED = "- ✅";

/** One edit as a range in the old text and what replaces it. */
export interface Edit {
  from: number;
  to: number;
  insert: string;
}

/**
 * The edit that puts `line` under `heading`, rather than the text it produces.
 *
 * Offsets because the editor needs them: a todo in today's own note logs itself
 * into the buffer being typed into, and one CodeMirror change over a range is
 * what keeps the undo history and the cursor whole. `appendUnder` is this
 * applied.
 */
export function appendUnderEdit(text: string, heading: string, line: string): Edit {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);

  if (at === -1) {
    // No section, so it is made at the end, off a blank line from whatever the
    // note already ends with.
    const trimmed = text.replace(/\n+$/, "");
    return { from: trimmed.length, to: text.length, insert: `\n\n${heading}\n${line}\n` };
  }

  let end = at + 1;
  while (end < lines.length && !HEADING.test(lines[end] ?? "")) end += 1;
  while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;

  // Nothing follows the section, so the line goes on the end with a newline in
  // front of it rather than behind.
  if (end === lines.length) return { from: text.length, to: text.length, insert: `\n${line}` };

  let offset = 0;
  for (let index = 0; index < end; index += 1) offset += (lines[index] ?? "").length + 1;
  return { from: offset, to: offset, insert: `${line}\n` };
}

/**
 * Put `line` at the end of `heading`'s section, making the section where there
 * is none.
 *
 * The blank line before the next heading stays where it is: a section is read
 * by eye as much as by this, and a log line pushed under the gap would read as
 * belonging to the heading below.
 */
export function appendUnder(text: string, heading: string, line: string): string {
  const { from, to, insert } = appendUnderEdit(text, heading, line);
  return text.slice(0, from) + insert + text.slice(to);
}

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
}: CycleLinesInput): Map<number, string> {
  const before = lines[line - 1] ?? "";
  const was = parseTodo(before);
  const cycled = cycleLine(before, today, id);
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

  return moved;
}

/** Every note one press of the cycle changes, in the order they should be sent. */
export function cycleTodoWrites(input: CycleInput): Write[] {
  const { path, text, line, dailyPath, dailyText, logged, today, id, closed } = input;

  const lines = text.split("\n");
  const was = parseTodo(lines[line - 1] ?? "");
  // The line the press was on, read on its own: its entry in the map can hold
  // the recurrence copy as well, and the log is about the todo that was ticked.
  const now = parseTodo(cycleLine(lines[line - 1] ?? "", today, id));

  for (const [at, insert] of cycleLines({ lines, line, today, id, closed })) {
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
