/**
 * A todo: one line of a note, read into a record and written back out.
 * The line is the whole record, so every field is spelled on it, and a patched line keeps every other byte.
 */

import { masked, SPANS, tagsOf, wordTags } from "@/lib/tag-rule";
import {
  endsOfWords,
  type Fields,
  fieldStarts,
  patchFields,
  readFields,
  readTagged,
  sameFields,
  type TodoPriority,
} from "@/lib/todo/todo-fields";

export type TodoState = "open" | "doing" | "done" | "blocked" | "waiting" | "review" | "rejected";

export interface Todo extends Fields {
  /** How many spaces open the line. Subtasks are indentation, and phase 2 reads this. */
  indent: number;
  state: TodoState;
}

/**
 * `X` is here because another editor writes it. kasten writes only `x`, and `R` is no todo,
 * since obsidian-tasks reads case.
 */
const STATES: Record<string, TodoState> = {
  " ": "open",
  "/": "doing",
  x: "done",
  X: "done",
  b: "blocked",
  w: "waiting",
  r: "review",
  "-": "rejected",
};

const BOX: Record<TodoState, string> = {
  open: " ",
  doing: "/",
  done: "x",
  blocked: "b",
  waiting: "w",
  review: "r",
  rejected: "-",
};

/**
 * How each state is drawn where a list is drawn. A second copy would be seven symbols to keep in step.
 * The editor's copy in `styles/live-preview-lists.css` is a `::before`, which no module can reach.
 */
export const STATE_SYMBOL: Record<TodoState, string> = {
  open: "☐",
  doing: "◐",
  done: "☑",
  blocked: "⊘",
  waiting: "◷",
  review: "◎",
  rejected: "☒",
};

/** Exported for the reason `STATE_SYMBOL` is: the pane draws these too. */
export const PRIORITY_SYMBOL: Record<TodoPriority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};

/** The bullet, the box, and everything after it. */
const LINE = /^([ \t]*)- \[([ /xXbwr-])\](?:[ \t](.*))?$/;

/** A line that is not a todo, cut into what it is indented by and what it says. */
const PLAIN = /^([ \t]*)(?:- )?(.*)$/;

/**
 * The spans, mask and tags live with the tag rule, so the pane, saved views and quick add read a tag as the editor draws it.
 * Re-exported here, where their readers have always found them.
 */
export { masked, SPANS, tagsOf, wordTags };

/**
 * Every tag a todo line carries, exactly as `parseTodo` reads them, each with
 * where it starts in the line. None on a line that is not a todo.
 */
export function todoTagsOn(line: string): { tag: string; at: number }[] {
  const rest = LINE.exec(line)?.[3];
  if (rest === undefined) return [];
  const offset = line.length - rest.length;
  return readTagged(rest).tags.map(({ tag, at }) => ({ tag, at: offset + at }));
}

export function parseTodo(line: string): Todo | null {
  const found = LINE.exec(line);
  if (found === null) return null;

  const state = STATES[found[2] ?? ""];
  if (state === undefined) return null;

  return { indent: (found[1] ?? "").length, state, ...readFields(found[3] ?? "") };
}

/** The words and the fields, in the one order every line kasten writes carries. */
function tail(todo: Todo): string {
  const plain = joinParts(todo);
  const { indent: _indent, state: _state, ...fields } = todo;
  if (sameFields(readFields(plain), fields)) return plain;
  return insideWords(todo, fields) ?? plain;
}

/** The words, then every field after them, in the order `tail` writes them. */
function joinParts(todo: Todo): string {
  return [...leadParts(todo), ...trailParts(todo)].join(" ");
}

/** The words, then the fields up to the recurrence. */
function leadParts(todo: Todo): string[] {
  const parts: string[] = [];

  if (todo.text !== "") parts.push(todo.text);
  // Ahead of every other field, straight after the words. obsidian-tasks reads
  // a line back from its end and stops at the first thing it does not know,
  // so a marker of ours written last would hide the due date from it. Here it
  // reads as the end of the task's words. The assignee comes first, so the wait
  // reads after it, as `parseTodo` takes them.
  if (todo.assignee !== undefined) parts.push(`👤 ${todo.assignee}`);
  if (todo.waitingSince !== undefined) {
    parts.push(["👤", todo.waitingSince, todo.waitingOn].filter(Boolean).join(" "));
  }
  if (todo.due !== undefined) parts.push(`📅 ${todo.due}`);
  if (todo.scheduled !== undefined) parts.push(`⏳ ${todo.scheduled}`);
  if (todo.start !== undefined) parts.push(`🛫 ${todo.start}`);
  if (todo.priority !== undefined) parts.push(PRIORITY_SYMBOL[todo.priority]);
  if (todo.recurrence !== undefined) parts.push(`🔁 ${todo.recurrence}`);
  return parts;
}

/** The fields after the recurrence, blockers last. */
function trailParts(todo: Todo): string[] {
  const parts: string[] = [];
  if (todo.onCompletion !== undefined) parts.push(`🏁 ${todo.onCompletion}`);
  if (todo.created !== undefined) parts.push(`➕ ${todo.created}`);
  if (todo.done !== undefined) parts.push(`✅ ${todo.done}`);
  if (todo.cancelled !== undefined) parts.push(`❌ ${todo.cancelled}`);
  if (todo.estimate !== undefined) parts.push(`⏲ ${todo.estimate}`);
  if (todo.worked !== undefined) parts.push(`⏱ ${todo.worked}`);
  if (todo.id !== undefined) parts.push(`🆔 ${todo.id}`);
  for (const blocker of todo.blockedBy) parts.push(`⛔ ${blocker}`);
  return parts;
}

// A one-word field that may stand bare in the words, so the words after it could
// read as its value.
const BARE_MARKER = /(?:🔁|🏁|⏲|⏱|🆔|⛔)️?(?=[ \t]+\S)/gu;

/**
 * `tail` with the dated fields put straight after a bare one-word marker, so `⛔ 📅 2026-10-20 more` does not read `more` as the blocker.
 * A blocker is not in the pool, since moving one would rebuild `blockedBy`. Null where no place reads back as `fields`.
 */
function insideWords(todo: Todo, fields: Fields): string | null {
  // The dated fields and priority are tried alone first, as they always were, so a
  // line that never had the bug is written as it was. The one-word fields are
  // spent only where that does not read back: a bare `🏁` before a field would
  // otherwise take `⏲` or `🆔` as its own.
  const dated: [keyof Todo, string][] = [];
  if (todo.due !== undefined) dated.push(["due", `📅 ${todo.due}`]);
  if (todo.scheduled !== undefined) dated.push(["scheduled", `⏳ ${todo.scheduled}`]);
  if (todo.start !== undefined) dated.push(["start", `🛫 ${todo.start}`]);
  if (todo.priority !== undefined) dated.push(["priority", PRIORITY_SYMBOL[todo.priority]]);
  const oneWord: [keyof Todo, string][] = [];
  if (todo.estimate !== undefined) oneWord.push(["estimate", `⏲ ${todo.estimate}`]);
  if (todo.worked !== undefined) oneWord.push(["worked", `⏱ ${todo.worked}`]);
  if (todo.id !== undefined) oneWord.push(["id", `🆔 ${todo.id}`]);

  return placeInWords(todo, fields, dated) ?? placeInWords(todo, fields, [...dated, ...oneWord]);
}

/** `insideWords` with the fields of `pool` written after the bare markers, in order. */
function placeInWords(todo: Todo, fields: Fields, pool: [keyof Todo, string][]): string | null {
  let words = todo.text;
  let shift = 0;
  let taken = 0;
  for (const found of masked(todo.text).matchAll(BARE_MARKER)) {
    if (taken === pool.length) break;
    const at = (found.index ?? 0) + found[0].length + shift;
    const field = ` ${pool[taken]?.[1] ?? ""}`;
    words = words.slice(0, at) + field + words.slice(at);
    shift += field.length;
    taken += 1;
  }
  if (taken === 0) return null;

  const moved = Object.fromEntries(pool.slice(0, taken).map(([key]) => [key, undefined]));
  const line = joinParts({ ...todo, ...moved, text: words });
  return sameFields(readFields(line), fields) ? line : null;
}

export function formatTodo(todo: Todo): string {
  const rest = tail(todo);
  return `${" ".repeat(todo.indent)}- [${BOX[todo.state]}]${rest === "" ? "" : ` ${rest}`}`;
}

/**
 * Where the words of a todo line end: before its first field that parses, else before a trailing `^blockid`, else at the end.
 * Only fields that parse count, as for a stamp: `📅 friday` is words.
 */
export function wordsEnd(line: string): number {
  const found = LINE.exec(line);
  if (found?.[3] === undefined) return line.length;
  const rest = found[3];
  const offset = line.length - rest.length;
  const fields = fieldStarts(rest).map((at) => offset + at);
  // Only a place a space or the line's end follows. A field typed hard against
  // the words, `foo📅`, would need a space after the tag too, which taking the
  // tag back out could not tell from one typed; the tag then goes past every
  // field rather than between two of them. A `^` with no space before it is
  // ruled out the same way, `2^10` being words and no block id.
  const spaced = (at: number) => /^(?:[ \t]|$)/.test(line.slice(at));
  const ends = endsOfWords(line, fields);
  const first = ends[0] ?? line.length;
  if (spaced(first)) return first;
  // Past the fields: the block id's place, then the line's end.
  return ends.slice(fields.length).find(spaced) ?? line.length;
}

/**
 * `line` in the state with the stamps `want` carries, every other byte kept.
 * Exported for `todo-write.ts`, which changes state the way a press does.
 */
export function patchLine(line: string, want: Todo, boxed = true): string {
  const todo = LINE.exec(line);
  const plain = PLAIN.exec(line);
  const indent = (todo ?? plain)?.[1] ?? "";
  // The one character between the box and the words, a tab where one was typed.
  const gap = todo?.[3] === undefined ? " " : (line[indent.length + 5] ?? " ");
  const { indent: _indent, state: _state, ...fields } = want;

  // Correct fields beat kept bytes: a line no place parses right on is
  // rebuilt in the field order, keeping only its indent.
  const rest =
    patchFields(todo === null ? (plain?.[2] ?? "") : (todo[3] ?? ""), fields) ?? tail(want);

  if (!boxed) return `${indent}${rest}`;
  const box = todo?.[2] !== undefined && STATES[todo[2]] === want.state ? todo[2] : BOX[want.state];
  return `${indent}- [${box}]${rest === "" ? "" : `${gap}${rest}`}`;
}

/**
 * Where the name goes on a waiting line that names nobody: just past its dated `👤`, since the state key cannot know who the todo waits on.
 * Both places a line is edited put the cursor here.
 */
export function nameAt(line: string): number | null {
  const todo = parseTodo(line);
  if (todo?.state !== "waiting" || todo.waitingOn !== undefined) return null;

  if (todo.waitingSince === undefined) return null;
  // The end of the wait's own match from readTagged, the one parseTodo reads. A
  // `👤` and date that another field holds as its value, or that sits in a span
  // or link, is not that match, so it never catches the cursor.
  const rest = LINE.exec(line)?.[3];
  if (rest === undefined) return null;
  const end = readTagged(rest).waitEnd;
  return end === undefined ? null : line.length - rest.length + end;
}

/** Neither done nor rejected, which is what both views show by default. */
export function isOpen(todo: Todo): boolean {
  return todo.state !== "done" && todo.state !== "rejected";
}

/** A plain line read as the todo it is about to become, keeping its fields. */
function todoOf(line: string, today: string): Todo {
  const found = PLAIN.exec(line);
  const fields = readFields(found?.[2] ?? "");
  return {
    indent: (found?.[1] ?? "").length,
    state: "open",
    ...fields,
    created: fields.created ?? today,
  };
}

/** Out of the cycle: the bullet and the box go, and the fields stay. */
function proseOf(line: string, todo: Todo): string {
  return patchLine(line, todo, false);
}

/**
 * One step round the cycle: open, doing, done, then a plain line. Blocked, waiting, review and rejected are set by their own keys, never walked to.
 * `today` and `id` come in so a press is a function over a string. `id` is used only when a todo enters done with none.
 */
export function cycleLine(line: string, today: string, id: string): string {
  const todo = parseTodo(line);

  // A plain line becomes an open todo, keeping whatever fields were written on
  // it. Its bullet goes: the box stands in for one, and the step out of the
  // cycle writes no bullet back.
  if (todo === null) return patchLine(line, todoOf(line, today));

  switch (todo.state) {
    case "open":
      return patchLine(line, { ...todo, state: "doing" });
    // Picked up where the work left off, rather than at the start of it: a
    // blocked todo is one somebody had already begun.
    case "blocked":
      return patchLine(line, { ...todo, state: "doing" });
    // The same step for the same reason, and the `👤` goes with the wait it
    // recorded: the answer has come, which is what moved the todo on.
    case "waiting":
      return patchLine(line, {
        ...todo,
        state: "doing",
        waitingSince: undefined,
        waitingOn: undefined,
      });
    case "doing":
      return patchLine(line, { ...todo, state: "done", done: today, id: todo.id ?? id });
    // On to done rather than back to doing, as blocked and waiting go. Those
    // still have work in them; a todo in review has none, the owner's check
    // being the one thing left, so the press is the approval.
    case "review":
      return patchLine(line, { ...todo, state: "done", done: today, id: todo.id ?? id });
    // Both ways out, each dropping the stamp its own state wrote. Every other
    // field stays, so three more presses give the todo back with its dates.
    case "done":
      return proseOf(line, { ...todo, done: undefined });
    case "rejected":
      return proseOf(line, { ...todo, cancelled: undefined });
  }
}

/**
 * Put one line in the state a key named. Entering done stamps the date and an id, and leaving drops that stamp.
 * Leaving waiting drops the dated `👤`, since the todo no longer waits. A line already in that state comes back untouched.
 */
export function setStateOn(line: string, state: TodoState, today: string, id: string): string {
  const todo = parseTodo(line) ?? todoOf(line, today);
  if (parseTodo(line)?.state === state) return line;
  // Only a wait that is ending takes its `👤` with it. One typed onto a line
  // that was never waiting is somebody's words, and stays.
  const left = todo.state === "waiting";

  return patchLine(line, {
    ...todo,
    state,
    done: state === "done" ? (todo.done ?? today) : undefined,
    cancelled: state === "rejected" ? (todo.cancelled ?? today) : undefined,
    id: state === "done" ? (todo.id ?? id) : todo.id,
    waitingSince:
      state === "waiting" ? (todo.waitingSince ?? today) : left ? undefined : todo.waitingSince,
    waitingOn: left ? undefined : todo.waitingOn,
  });
}

/**
 * `prefix` and six hex characters, from the platform because an id goes to disk.
 * One randomness source for the app, so every module mints ids the same way.
 */
export function newId(prefix = "kt-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
