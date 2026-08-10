/**
 * A todo, which is one line of a note read into a record and written back out.
 *
 * The line is the whole record: the vault holds no todo table and never will,
 * so every field a todo carries is spelled on the line beside it, in the
 * vocabulary the obsidian-tasks plugin already reads. A field this does not
 * know stays in the words, where the person who typed it can see it.
 *
 * The line is rebuilt rather than patched, so the field order is one decision
 * made in one place and a note stays consistent however it was edited.
 */

export type TodoState = "open" | "doing" | "done" | "blocked" | "rejected";
export type TodoPriority = "highest" | "high" | "medium" | "low" | "lowest";

export interface Todo {
  /** How many spaces open the line. Subtasks are indentation, and phase 2 reads this. */
  indent: number;
  state: TodoState;
  /** The line's own words, every recognised field taken out, tags left in place. */
  text: string;
  /** Every `#tag` in `text`, each with its hash, in the order they appear. */
  tags: string[];
  due?: string;
  scheduled?: string;
  start?: string;
  created?: string;
  done?: string;
  cancelled?: string;
  priority?: TodoPriority;
  /** `every week`, as written. Phase 2 reads it; phase 1 carries it. */
  recurrence?: string;
  /** `kt-3f9a2c`, without the `🆔`. */
  id?: string;
  /** Every `⛔` on the line, each an id. Empty rather than absent. */
  blockedBy: string[];
  /** `2h`, as written. */
  estimate?: string;
  /** `1h20m`, as written. */
  worked?: string;
}

/** `X` is here because another editor writes it. Everything kasten writes is `x`. */
const STATES: Record<string, TodoState> = {
  " ": "open",
  "/": "doing",
  x: "done",
  X: "done",
  b: "blocked",
  "-": "rejected",
};

const BOX: Record<TodoState, string> = {
  open: " ",
  doing: "/",
  done: "x",
  blocked: "b",
  rejected: "-",
};

const PRIORITIES: Record<TodoPriority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};

const PRIORITY_OF: Record<string, TodoPriority> = {
  "🔺": "highest",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
  "⏬": "lowest",
};

/** The bullet, the box, and everything after it. */
const LINE = /^([ \t]*)- \[([ /xXb-])\](?:[ \t](.*))?$/;

/** A line that is not a todo, cut into what it is indented by and what it says. */
const PLAIN = /^([ \t]*)(?:- )?(.*)$/;

// Each field as it is written. The value has to parse or the marker stays in
// the words, which is what makes a mistyped date visible rather than lost.
const DUE = /📅[ \t]+(\d{4}-\d{2}-\d{2})/;
const SCHEDULED = /⏳[ \t]+(\d{4}-\d{2}-\d{2})/;
const START = /🛫[ \t]+(\d{4}-\d{2}-\d{2})/;
const CREATED = /➕[ \t]+(\d{4}-\d{2}-\d{2})/;
const DONE = /✅[ \t]+(\d{4}-\d{2}-\d{2})/;
const CANCELLED = /❌[ \t]+(\d{4}-\d{2}-\d{2})/;
const PRIORITY = /(🔺|⏫|🔼|🔽|⏬)/;
const ID = /🆔[ \t]+(\S+)/;
const BLOCKED_BY = /⛔[ \t]+(\S+)/;
const ESTIMATE = /⏲[ \t]+(\S+)/;
const WORKED = /⏱[ \t]+(\S+)/;

// The one field whose value is free text, so it runs to the next marker rather
// than to the next space. A tag ends it too: a recurrence never carries one,
// and a tag belongs to the words.
const RECURRENCE =
  /🔁[ \t]+(.+?)(?=[ \t]*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⛔|⏲|⏱|#)|[ \t]*$)/;

const TAG = /#[^\s#]+/g;

type Fields = Omit<Todo, "indent" | "state">;

/** Every field written after the box, taken off the words that carried them. */
function readFields(rest: string): Fields {
  let text = rest;

  function take(pattern: RegExp): string | undefined {
    const found = pattern.exec(text);
    if (found === null) return undefined;
    text = text.slice(0, found.index) + text.slice(found.index + found[0].length);
    return found[1];
  }

  const due = take(DUE);
  const scheduled = take(SCHEDULED);
  const start = take(START);
  const glyph = take(PRIORITY);
  const recurrence = take(RECURRENCE);
  const created = take(CREATED);
  const done = take(DONE);
  const cancelled = take(CANCELLED);
  const estimate = take(ESTIMATE);
  const worked = take(WORKED);
  const id = take(ID);

  const blockedBy: string[] = [];
  for (let blocker = take(BLOCKED_BY); blocker !== undefined; blocker = take(BLOCKED_BY)) {
    blockedBy.push(blocker);
  }

  // Taking a field out of the middle leaves two spaces where there was one.
  text = text.replace(/[ \t]+/g, " ").trim();

  return {
    text,
    tags: text.match(TAG) ?? [],
    due,
    scheduled,
    start,
    created,
    done,
    cancelled,
    priority: glyph === undefined ? undefined : PRIORITY_OF[glyph],
    recurrence,
    id,
    blockedBy,
    estimate,
    worked,
  };
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
  const parts: string[] = [];

  if (todo.text !== "") parts.push(todo.text);
  if (todo.due !== undefined) parts.push(`📅 ${todo.due}`);
  if (todo.scheduled !== undefined) parts.push(`⏳ ${todo.scheduled}`);
  if (todo.start !== undefined) parts.push(`🛫 ${todo.start}`);
  if (todo.priority !== undefined) parts.push(PRIORITIES[todo.priority]);
  if (todo.recurrence !== undefined) parts.push(`🔁 ${todo.recurrence}`);
  if (todo.created !== undefined) parts.push(`➕ ${todo.created}`);
  if (todo.done !== undefined) parts.push(`✅ ${todo.done}`);
  if (todo.cancelled !== undefined) parts.push(`❌ ${todo.cancelled}`);
  if (todo.estimate !== undefined) parts.push(`⏲ ${todo.estimate}`);
  if (todo.worked !== undefined) parts.push(`⏱ ${todo.worked}`);
  if (todo.id !== undefined) parts.push(`🆔 ${todo.id}`);
  for (const blocker of todo.blockedBy) parts.push(`⛔ ${blocker}`);

  return parts.join(" ");
}

export function formatTodo(todo: Todo): string {
  const rest = tail(todo);
  return `${" ".repeat(todo.indent)}- [${BOX[todo.state]}]${rest === "" ? "" : ` ${rest}`}`;
}

/** Neither done nor rejected, which is what both views show by default. */
export function isOpen(todo: Todo): boolean {
  return todo.state !== "done" && todo.state !== "rejected";
}

/**
 * One step round the cycle.
 *
 * `today` and `id` are passed in rather than read here, so a press is a
 * function over a string and its test needs no clock. `id` is used only when a
 * todo enters done carrying none: a todo nothing refers to never gets one.
 */
export function cycleLine(line: string, today: string, id: string): string {
  const todo = parseTodo(line);

  if (todo === null) {
    // A plain line becomes an open todo, keeping whatever fields were written
    // on it. Its bullet goes: the box stands in for one, and the last step of
    // the cycle writes no bullet back.
    const found = PLAIN.exec(line);
    const fields = readFields(found?.[2] ?? "");
    return formatTodo({
      indent: (found?.[1] ?? "").length,
      state: "open",
      ...fields,
      created: fields.created ?? today,
    });
  }

  switch (todo.state) {
    case "open":
      return formatTodo({ ...todo, state: "doing" });
    case "doing":
      return formatTodo({ ...todo, state: "done", done: today, id: todo.id ?? id });
    case "done":
      return formatTodo({ ...todo, state: "blocked", done: undefined });
    case "blocked":
      return formatTodo({ ...todo, state: "rejected", cancelled: today });
    case "rejected":
      // Out of the cycle. The bullet and the box go, and the `❌` goes with the
      // state that wrote it. Every other field stays, so six more presses give
      // the todo back with its dates.
      return `${" ".repeat(todo.indent)}${tail({ ...todo, cancelled: undefined })}`;
  }
}

/** `kt-` and six hex characters. From the platform, because an id goes to disk. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `kt-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
