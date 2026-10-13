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

export type TodoState = "open" | "doing" | "done" | "blocked" | "waiting" | "rejected";
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
  /** The day a `[w]` todo began to wait, which is the date after its `👤`. */
  waitingSince?: string;
  /** Who it waits on, as written after the `👤`: a name, or a `[[link]]` to one. */
  waitingOn?: string;
}

/** `X` is here because another editor writes it. Everything kasten writes is `x`. */
const STATES: Record<string, TodoState> = {
  " ": "open",
  "/": "doing",
  x: "done",
  X: "done",
  b: "blocked",
  w: "waiting",
  "-": "rejected",
};

const BOX: Record<TodoState, string> = {
  open: " ",
  doing: "/",
  done: "x",
  blocked: "b",
  waiting: "w",
  rejected: "-",
};

/**
 * How each state is drawn where a list is drawn rather than edited.
 *
 * Here rather than in the panel that first wanted it, because the pane wants
 * the same six and a second copy would be six characters to keep in step by
 * hand. `.cm-todo-*` in `app.css` is the third copy and cannot be this one:
 * the editor draws its symbol in a `::before`, which no module can reach.
 */
export const STATE_SYMBOL: Record<TodoState, string> = {
  open: "☐",
  doing: "◐",
  done: "☑",
  blocked: "⊘",
  waiting: "◷",
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

const PRIORITY_OF: Record<string, TodoPriority> = {
  "🔺": "highest",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
  "⏬": "lowest",
};

/** The bullet, the box, and everything after it. */
const LINE = /^([ \t]*)- \[([ /xXbw-])\](?:[ \t](.*))?$/;

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
  /🔁[ \t]+(.+?)(?=[ \t]*(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🆔|⛔|⏲|⏱|👤|#)|[ \t]*$)/;

// Who a todo waits on and since when, both optional and the date first. The
// name is free text as a rule is, so it runs to the next marker or tag. It
// needs a space before either, which is what lets `[[ada#notes]]` keep its
// anchor.
const WAITING =
  /👤(?:[ \t]+(\d{4}-\d{2}-\d{2}))?(?:[ \t]+(.+?))?(?=[ \t]+(?:📅|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🆔|⛔|⏲|⏱|#)|[ \t]*$)/;

/** Exported because `todo-shorthand.ts` fills the same `Todo.tags` from it. */
export const TAG = /#[^\s#]+/g;

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

  // A `👤` with neither a date nor a name after it says nothing, and stays in
  // the words like any other marker whose value does not parse.
  const waiting = WAITING.exec(text);
  const [, waitingSince, waitingOn] = waiting ?? [];
  if (waiting !== null && (waitingSince !== undefined || waitingOn !== undefined)) {
    text = text.slice(0, waiting.index) + text.slice(waiting.index + waiting[0].length);
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
    waitingSince,
    waitingOn,
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
  // Ahead of every other field, straight after the words. obsidian-tasks reads
  // a line back from its end and stops at the first thing it does not know,
  // so a marker of ours written last would hide the due date from it. Here it
  // reads as the end of the task's words.
  if (todo.waitingSince !== undefined || todo.waitingOn !== undefined) {
    parts.push(["👤", todo.waitingSince, todo.waitingOn].filter(Boolean).join(" "));
  }
  if (todo.due !== undefined) parts.push(`📅 ${todo.due}`);
  if (todo.scheduled !== undefined) parts.push(`⏳ ${todo.scheduled}`);
  if (todo.start !== undefined) parts.push(`🛫 ${todo.start}`);
  if (todo.priority !== undefined) parts.push(PRIORITY_SYMBOL[todo.priority]);
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

/**
 * Where the name goes on a waiting line that names nobody: the offset just
 * past the date its `👤` carries. Null on any other line.
 *
 * The key that sets the state cannot know who the todo waits on, and the `👤`
 * sits ahead of the other fields, so the place to type the name is mid-line.
 * Both places a line is edited put the cursor here.
 */
export function nameAt(line: string): number | null {
  const todo = parseTodo(line);
  if (todo?.state !== "waiting" || todo.waitingOn !== undefined) return null;

  const stamp = `👤 ${todo.waitingSince}`;
  const at = line.indexOf(stamp);
  return todo.waitingSince === undefined || at === -1 ? null : at + stamp.length;
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
function proseOf(todo: Todo): string {
  return `${" ".repeat(todo.indent)}${tail(todo)}`;
}

/**
 * One step round the cycle.
 *
 * The walk is the work: open, doing, done, and out to a plain line again.
 * Blocked, waiting and rejected are things that happen to work rather than
 * steps in it, so none is on the walk and each is set by a key of its own. That is
 * also what puts done last: a list of open work loses the row at the end of the
 * walk rather than in the middle of it, where the two states past it were once
 * unreachable from the pane.
 *
 * `today` and `id` are passed in rather than read here, so a press is a
 * function over a string and its test needs no clock. `id` is used only when a
 * todo enters done carrying none: a todo nothing refers to never gets one.
 */
export function cycleLine(line: string, today: string, id: string): string {
  const todo = parseTodo(line);

  // A plain line becomes an open todo, keeping whatever fields were written on
  // it. Its bullet goes: the box stands in for one, and the step out of the
  // cycle writes no bullet back.
  if (todo === null) return formatTodo(todoOf(line, today));

  switch (todo.state) {
    case "open":
      return formatTodo({ ...todo, state: "doing" });
    // Picked up where the work left off, rather than at the start of it: a
    // blocked todo is one somebody had already begun.
    case "blocked":
      return formatTodo({ ...todo, state: "doing" });
    // The same step for the same reason, and the `👤` goes with the wait it
    // recorded: the answer has come, which is what moved the todo on.
    case "waiting":
      return formatTodo({
        ...todo,
        state: "doing",
        waitingSince: undefined,
        waitingOn: undefined,
      });
    case "doing":
      return formatTodo({ ...todo, state: "done", done: today, id: todo.id ?? id });
    // Both ways out, each dropping the stamp its own state wrote. Every other
    // field stays, so three more presses give the todo back with its dates.
    case "done":
      return proseOf({ ...todo, done: undefined });
    case "rejected":
      return proseOf({ ...todo, cancelled: undefined });
  }
}

/**
 * Put one line in the state a key named, from wherever it was.
 *
 * The stamps are the cycle's, because a state is worth the same whichever key
 * wrote it: entering done stamps the date and an id, entering rejected stamps
 * its own date, and leaving either drops the stamp it wrote. Entering waiting
 * stamps the day the wait began, and leaving it drops the `👤` whole, the name
 * with the date: it says who the todo waits on, and it no longer waits. A line
 * already in
 * that state comes back untouched, so the caller can tell a press that changed
 * nothing.
 */
export function setStateOn(line: string, state: TodoState, today: string, id: string): string {
  const todo = parseTodo(line) ?? todoOf(line, today);
  if (parseTodo(line)?.state === state) return line;
  // Only a wait that is ending takes its `👤` with it. One typed onto a line
  // that was never waiting is somebody's words, and stays.
  const left = todo.state === "waiting";

  return formatTodo({
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
 * `prefix` and six hex characters. From the platform, because an id goes to disk.
 *
 * The default is the todo's own, which is every caller but the highlight's:
 * one source of randomness in the app beats a second copy of three lines of
 * `crypto.getRandomValues` in whichever module mints the next kind of id.
 */
export function newId(prefix = "kt-"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${prefix}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
