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
import {
  cycleLine,
  formatTodo,
  isOpen,
  parseTodo,
  patchLine,
  setStateOn,
  type Todo,
  type TodoState,
} from "@/lib/todo";
import { blockedLines, type Closed } from "@/lib/todo-blocked";
import { withoutBlockId } from "@/lib/todo-fields";
import { nextOccurrence } from "@/lib/todo-recur";
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
  const parts = [LOGGED, today, withoutBlockId(todo.text)];
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
  /**
   * Whether the pressed todo's id stands on another todo line too, here or in
   * another note. Its dependents may be waiting on the other, so none moves.
   */
  shared?: boolean;
}

/**
 * Whether the todo on `line` carries an id another todo line in `lines` carries
 * too. Such a press cannot tell whose log line or dependents it moves, so it
 * moves only its own line and what hangs off it. See `otherTodoWithId`.
 */
export function twinnedIn(lines: string[], line: number): boolean {
  const id = parseTodo(lines[line - 1] ?? "")?.id;
  return id !== undefined && otherTodoWithId(id, "", line, [], lines.join("\n")) !== null;
}

/** The line one press writes, whether it walks the cycle or names a state. */
function pressed(line: string, today: string, id: string, state?: TodoState): string {
  return state === undefined ? cycleLine(line, today, id) : setStateOn(line, state, today, id);
}

/**
 * The line one press writes, or null where the press leaves it as it is, such
 * as `X` on a done todo. Such a press has nothing to write, log or report, and
 * both the pane and the editor stop on the null before they read anything more.
 */
export function pressedLine(
  line: string,
  today: string,
  id: string,
  state?: TodoState,
): string | null {
  const after = pressed(line, today, id, state);
  return after === line ? null : after;
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
  shared = false,
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
        // A part that was waiting on somebody is finished with the rest, and
        // its `👤` goes as it does when a key sets the state.
        const freed =
          part.todo.state === "waiting"
            ? { ...part.todo, waitingSince: undefined, waitingOn: undefined }
            : part.todo;
        moved.set(
          part.line,
          patchLine(lines[part.line - 1] ?? "", { ...freed, state: "done", done: today }),
        );
      }
    }
  }

  // From the blocker's side and only from there: closing or reopening a todo
  // that carries an id is what moves the lines waiting on it. A press that
  // leaves the line no longer a todo moves nothing, nothing being able to
  // resolve it any more. Nor does one whose id is `shared`.
  if (!shared && was !== null && now?.id !== undefined && isOpen(was) !== isOpen(now)) {
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
    // A new line, so written in the field order, but at the indent the ticked
    // one carries as typed.
    if (fresh !== null) {
      const indent = /^[ \t]*/.exec(before)?.[0] ?? "";
      const text = withoutBlockId(fresh.text);
      moved.set(line, `${indent}${formatTodo({ ...fresh, indent: 0, text })}\n${cycled}`);
    }
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

/** One line the vault answered with, where it was found. */
export interface LineHit {
  path: string;
  line: number;
  text: string;
}

/**
 * Where else `id` stands on a todo line, as the sentence a refused press says.
 * Null where the pressed todo is the only one carrying it.
 *
 * Sessions, log lines and dependents name the id without carrying it, and none
 * of them parses to a todo with this id, so none counts. A press goes by id to
 * find its sessions and its dependents, and a pasted copy of the line would
 * share both: neither line can be told from the other, so the press refuses
 * rather than guess, and re-stamping one would break whatever names the id.
 *
 * `text` is the pressed note as the press just read it, or the buffer it was
 * typed into, and its other lines win over the hits for that note, which can
 * lag a write behind.
 */
export function otherTodoWithId(
  id: string,
  path: string,
  line: number,
  hits: LineHit[],
  text: string,
): string | null {
  const carries = (found: string) => parseTodo(found)?.id === id;
  const here = text
    .split("\n")
    .flatMap((found, index) =>
      index + 1 !== line && carries(found) ? [{ path, line: index + 1 }] : [],
    );
  const others = [...here, ...hits.filter((hit) => hit.path !== path && carries(hit.text))];

  const [first] = others;
  if (first === undefined) return null;
  const more = others.length > 1 ? `, and ${others.length - 1} more` : "";
  return `🆔 ${id} is on another todo too: ${first.path} line ${first.line}${more}`;
}
