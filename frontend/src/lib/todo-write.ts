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

/**
 * Put `line` at the end of `heading`'s section, making the section where there
 * is none.
 *
 * The blank line before the next heading stays where it is: a section is read
 * by eye as much as by this, and a log line pushed under the gap would read as
 * belonging to the heading below.
 */
export function appendUnder(text: string, heading: string, line: string): string {
  const lines = text.split("\n");
  const at = lines.indexOf(heading);

  if (at === -1) {
    // No section, so it is made at the end, off a blank line from whatever the
    // note already ends with.
    return `${text.replace(/\n+$/, "")}\n\n${heading}\n${line}\n`;
  }

  let end = at + 1;
  while (end < lines.length && !HEADING.test(lines[end] ?? "")) end += 1;
  while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;

  lines.splice(end, 0, line);
  return lines.join("\n");
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

/** Drop every `- ✅` line naming `id`. Null where the note holds none. */
export function dropDone(text: string, id: string): string | null {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !(line.trimStart().startsWith(LOGGED) && line.includes(id)));
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

/** Every note one press of the cycle changes, in the order they should be sent. */
export function cycleTodoWrites(input: CycleInput): Write[] {
  const { path, text, line, dailyPath, dailyText, logged, today, id } = input;

  const lines = text.split("\n");
  const was = parseTodo(lines[line - 1] ?? "");
  const cycled = cycleLine(lines[line - 1] ?? "", today, id);
  lines[line - 1] = cycled;
  const now = parseTodo(cycled);

  // Keyed by path, so a note that both holds the todo and holds its log line
  // is one write rather than two that overwrite each other.
  const writes = new Map<string, string>([[path, lines.join("\n")]]);

  if (now?.state === "done" && path !== dailyPath) {
    // Already logged, from an earlier tick that was taken back and put on
    // again. Ticking twice leaves one line rather than a pile.
    const already = Object.values(logged).some((note) => dropDone(note, now.id ?? "") !== null);
    if (!already) {
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
