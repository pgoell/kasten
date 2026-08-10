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

import { cycleLine, formatTodo, parseTodo, type Todo } from "@/lib/todo";

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

/** Every note one press of the cycle changes, in the order they should be sent. */
export function cycleTodoWrites(input: CycleInput): Write[] {
  const { path, text, line, dailyPath, dailyText, logged, today, id } = input;

  const lines = text.split("\n");
  const was = parseTodo(lines[line - 1] ?? "");
  const cycled = cycleLine(lines[line - 1] ?? "", today, id);
  lines[line - 1] = cycled;
  const now = parseTodo(cycled);
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
