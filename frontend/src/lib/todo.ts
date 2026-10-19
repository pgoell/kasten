/**
 * A todo, which is one line of a note read into a record and written back out.
 *
 * The line is the whole record: the vault holds no todo table and never will,
 * so every field a todo carries is spelled on the line beside it, in the
 * vocabulary the obsidian-tasks plugin already reads. A field this does not
 * know stays in the words, where the person who typed it can see it.
 *
 * A new line is written in the one field order `tail` keeps. A line that is
 * already there is patched rather than rebuilt when its state or a field kasten
 * writes changes: the box and the stamps the change adds or drops move, and
 * every other byte stays, so a tab indent still nests a part and a `^block` id
 * stays where links find it.
 */

export type TodoState = "open" | "doing" | "done" | "blocked" | "waiting" | "review" | "rejected";
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
  /** `keep` or `delete`, what obsidian-tasks does with a done copy. Carried, never acted on. */
  onCompletion?: string;
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

/**
 * `X` is here because another editor writes it. Everything kasten writes is
 * `x`. No `R`: nothing writes one, and obsidian-tasks reads case, so an `[R]`
 * is no todo there either.
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
 * How each state is drawn where a list is drawn rather than edited.
 *
 * Here rather than in the panel that first wanted it, because the pane wants
 * the same seven and a second copy would be seven characters to keep in step by
 * hand. `.cm-todo-*` in `app.css` is the third copy and cannot be this one:
 * the editor draws its symbol in a `::before`, which no module can reach.
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

const PRIORITY_OF: Record<string, TodoPriority> = {
  "🔺": "highest",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
  "⏬": "lowest",
};

/** The bullet, the box, and everything after it. */
const LINE = /^([ \t]*)- \[([ /xXbwr-])\](?:[ \t](.*))?$/;

/** A line that is not a todo, cut into what it is indented by and what it says. */
const PLAIN = /^([ \t]*)(?:- )?(.*)$/;

// Each field as it is written. The value has to parse or the marker stays in
// the words, which is what makes a mistyped date visible rather than lost.
// `d` on every one, because a value is read off the words by its offsets: the
// match runs on a masked copy, where a link's own text is filler.
//
// `📆` and `🗓` are obsidian-tasks' other spellings of due. Any marker may be
// typed with the variation selector after it, as many keyboards do, so it may
// follow every one, and a write over one keeps it: see `patchLine`. It sits
// outside the priority's capture, which is looked up by the glyph alone.
export const DUE = /(?:📅|📆|🗓)️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const SCHEDULED = /⏳️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const START = /🛫️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const CREATED = /➕️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const DONE = /✅️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const CANCELLED = /❌️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const PRIORITY = /(🔺|⏫|🔼|🔽|⏬)️?/d;
// Ends at a space or the line's end, so `🏁 keep-it` stays words.
const ON_COMPLETION = /🏁️?[ \t]+(keep|delete)(?=[ \t]|$)/d;
const ID = /🆔️?[ \t]+(\S+)/d;
const BLOCKED_BY = /⛔️?[ \t]+(\S+)/d;
const ESTIMATE = /⏲️?[ \t]+(\S+)/d;
const WORKED = /⏱️?[ \t]+(\S+)/d;

// The one field whose value is free text, so it runs to the next marker rather
// than to the next space. A tag ends it too: a recurrence never carries one,
// and a tag belongs to the words, as does a `^block` id that ends the line.
const RECURRENCE =
  /🔁️?[ \t]+(.+?)(?=[ \t]*(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🏁|🆔|⛔|⏲|⏱|👤|#)|[ \t]+\^[\w-]+[ \t]*$|[ \t]*$)/d;

// Who a todo waits on and since when, both optional and the date first. The
// name is free text as a rule is, so it runs to the next marker or tag. It
// needs a space before either, which is what lets `[[ada#notes]]` keep its
// anchor. A `^block` id at the end of the line ends it as well, or the date
// stamped in front of one would read the id as who the todo waits on. The name
// is tried last for the same reason, `??` rather than `?`.
const WAITING =
  /👤️?(?:[ \t]+(\d{4}-\d{2}-\d{2}))?(?:[ \t]+(.+?))??(?=[ \t]+(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱|#|\^[\w-]+[ \t]*$)|[ \t]*$)/d;

/** Every field in the order `tail` writes them, which is where a stamp is added. */
const ORDER = [
  WAITING,
  DUE,
  SCHEDULED,
  START,
  PRIORITY,
  RECURRENCE,
  ON_COMPLETION,
  CREATED,
  DONE,
  CANCELLED,
  ESTIMATE,
  WORKED,
  ID,
  BLOCKED_BY,
];

/**
 * The editor's tag shape from `tag.ts`, copied for the reason `WORD` is, so
 * `(#next)` and `#next.` carry `#next` and `#123` carries nothing. The backend
 * reads the same shape, which is what lets the pane and the endpoint agree.
 */
const TAG = /#[\p{L}_][\p{L}\p{N}_/-]*/gu;

/**
 * What may not sit in front of a hash, the editor's rule in `tag.ts`, so
 * `note#2` and `https://a.io/p#next` carry no tag. Copied rather than imported,
 * which would pull CodeMirror into every reader of a todo.
 */
const WORD = /[\p{L}\p{N}_/]$/u;

/**
 * A link, a markdown link and a code span: a marker inside one is not a field.
 * Global, so use it through `matchAll` or `replace` only, never `exec`.
 */
export const SPANS = /\[\[[^[\]\n]+\]\]|\[[^\]\n]*\]\([^)\n]*\)|`[^`\n]*`/g;

/** `👤` too: its name runs to the next marker, so words after it would be who the todo waits on. */
const MARKER = /📅|📆|🗓|⏳|🛫|🔺|⏫|🔼|🔽|⏬|🔁|🏁|➕|✅|❌|⏲|⏱|🆔|⛔|👤/gu;

const BLOCK_ID = /\^[\w-]+[ \t]*$/;

/**
 * `text` with every span blanked to the same length, so a marker inside one
 * matches nothing and every offset still lines up with the text. The filler
 * keeps the spaces and is a no-break space: no field, tag or block id reads it,
 * and neither `\S` nor `[ \t]` takes it, so a marker straight before a span has
 * no value and stays words rather than reading the span's first word.
 */
export function masked(text: string): string {
  return text.replace(SPANS, (span) => span.replace(/[^ \t]/g, "\u00A0"));
}

/**
 * Every tag `text` carries and where it starts, the one reading `Todo.tags`,
 * quick add and `@` share. Found on the mask, so a hash in a link or a code
 * span is text, and read off the text.
 */
export function tagsOf(text: string): { tag: string; at: number }[] {
  return [...masked(text).matchAll(TAG)]
    .filter((found) => !WORD.test(text.slice(0, found.index)))
    .map((found) => ({
      tag: text.slice(found.index, found.index + found[0].length),
      at: found.index,
    }));
}

/** A field found on the mask: where it sits in the text, and its values read off the text. */
interface Found {
  from: number;
  to: number;
  values: (string | undefined)[];
}

/**
 * The first match of `pattern` on `mask` that carries a value. A `👤` with
 * neither a date nor a name says nothing, and is words like any other marker
 * whose value does not parse.
 */
function find(pattern: RegExp, text: string, mask: string): Found | null {
  const found = pattern.exec(mask);
  if (found === null) return null;
  const values = (found.indices ?? [])
    .slice(1)
    .map((at: [number, number] | undefined) => (at === undefined ? undefined : text.slice(...at)));
  if (values.every((value) => value === undefined)) return null;
  return { from: found.index, to: found.index + found[0].length, values };
}

type Fields = Omit<Todo, "indent" | "state">;

/** Every field written after the box, taken off the words that carried them. */
function readFields(rest: string): Fields {
  return read(rest).fields;
}

/**
 * `readFields`, and where each tag starts in `rest`. A tag is read on the
 * words once the fields are out, so `📅 2026-10-20#agent` carries one and
 * `🆔 kt-a,#agent` none; `origin` keeps each kept character's offset in `rest`
 * so `@` can find that same tag on the line.
 */
function read(rest: string): { fields: Fields; tags: { tag: string; at: number }[] } {
  let text = rest;
  let mask = masked(rest);
  let origin = Array.from({ length: rest.length }, (_, at) => at);

  // The mask and the offsets are cut with the text, so the three stay in step.
  function take(pattern: RegExp): (string | undefined)[] {
    const found = find(pattern, text, mask);
    if (found === null) return [];
    text = text.slice(0, found.from) + text.slice(found.to);
    mask = mask.slice(0, found.from) + mask.slice(found.to);
    origin = [...origin.slice(0, found.from), ...origin.slice(found.to)];
    return found.values;
  }

  const [due] = take(DUE);
  const [scheduled] = take(SCHEDULED);
  const [start] = take(START);
  const [glyph] = take(PRIORITY);
  const [recurrence] = take(RECURRENCE);
  const [onCompletion] = take(ON_COMPLETION);
  const [created] = take(CREATED);
  const [done] = take(DONE);
  const [cancelled] = take(CANCELLED);
  const [estimate] = take(ESTIMATE);
  const [worked] = take(WORKED);
  const [id] = take(ID);

  const blockedBy: string[] = [];
  for (let [blocker] = take(BLOCKED_BY); blocker !== undefined; [blocker] = take(BLOCKED_BY)) {
    blockedBy.push(blocker);
  }

  const [waitingSince, waitingOn] = take(WAITING);

  // Read before the spaces close up, while `origin` still lines up. Closing
  // them up changes no tag, as a tag holds no space.
  const tags = tagsOf(text).map(({ tag, at }) => ({ tag, at: origin[at] ?? at }));

  // Taking a field out of the middle leaves two spaces where there was one.
  text = text.replace(/[ \t]+/g, " ").trim();

  const fields = {
    text,
    tags: tags.map((found) => found.tag),
    due,
    scheduled,
    start,
    created,
    done,
    cancelled,
    priority: glyph === undefined ? undefined : PRIORITY_OF[glyph],
    recurrence,
    onCompletion,
    id,
    blockedBy,
    estimate,
    worked,
    waitingSince,
    waitingOn,
  };
  return { fields, tags };
}

/**
 * Every tag a todo line carries, exactly as `parseTodo` reads them, each with
 * where it starts in the line. None on a line that is not a todo.
 */
export function todoTagsOn(line: string): { tag: string; at: number }[] {
  const rest = LINE.exec(line)?.[3];
  if (rest === undefined) return [];
  const offset = line.length - rest.length;
  return read(rest).tags.map(({ tag, at }) => ({ tag, at: offset + at }));
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
  if (todo.onCompletion !== undefined) parts.push(`🏁 ${todo.onCompletion}`);
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
 * Where words may end on a line: before each field marker outside a span,
 * before a trailing `^blockid`, and at the end of the line.
 *
 * Exported for the board, whose `p` puts a link there. A stamp tries the same
 * places, so both writes leave a line's fields where they were, but passes
 * `fields`, the offsets of the fields that parse: a stamp in front of
 * `📅 friday` would split words that read as one.
 */
export function endsOfWords(line: string, fields?: number[]): number[] {
  const spans = [...line.matchAll(SPANS)].map((m) => [m.index, m.index + m[0].length]);
  const outside = (at: number) => spans.every(([from = 0, to = 0]) => at < from || at >= to);
  // Back over the spaces before the marker, so the insert sits after the words
  // and not after the gap; never back into a span.
  const back = (at: number) => {
    let from = at;
    while (from > 0 && /[ \t]/.test(line[from - 1] ?? "") && outside(from - 1)) from -= 1;
    return from;
  };

  const markers =
    fields ?? [...line.matchAll(MARKER)].map((m) => m.index).filter((at) => outside(at));
  const ends = [...markers].sort((a, b) => a - b).map(back);
  const block = BLOCK_ID.exec(line);
  if (block !== null) ends.push(back(block.index));
  ends.push(back(line.length));
  return ends;
}

/**
 * Where the words of a todo line end: before its first field that parses, else
 * before a trailing `^blockid`, else at the line's end. An offset into the
 * whole line, so a tag written there leaves every other byte where it was, and
 * a space or the line's end always follows it.
 *
 * Only fields that parse count, as for a stamp: `📅 friday` is words.
 */
export function wordsEnd(line: string): number {
  const found = LINE.exec(line);
  if (found?.[3] === undefined) return line.length;
  const rest = found[3];
  const offset = line.length - rest.length;
  const mask = masked(rest);
  const fields = ORDER.flatMap((pattern) => {
    const field = find(pattern, rest, mask);
    return field === null ? [] : [offset + field.from];
  });
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
 * The fields a state change or a field write puts on or takes off, each
 * spelled as `tail` spells it. In `ORDER`'s sequence, so a stop writing `⏱` and
 * `🆔` together finds the one when it places the other. `⛔` is not here: a
 * line carries it more than once, and this loop writes one value per field.
 */
const STAMPS: {
  pattern: RegExp;
  keys: (keyof Fields)[];
  write: (todo: Fields) => string | undefined;
}[] = [
  {
    pattern: WAITING,
    keys: ["waitingSince", "waitingOn"],
    write: (todo) =>
      todo.waitingSince === undefined && todo.waitingOn === undefined
        ? undefined
        : ["👤", todo.waitingSince, todo.waitingOn].filter(Boolean).join(" "),
  },
  { pattern: CREATED, keys: ["created"], write: (todo) => todo.created && `➕ ${todo.created}` },
  { pattern: DONE, keys: ["done"], write: (todo) => todo.done && `✅ ${todo.done}` },
  {
    pattern: CANCELLED,
    keys: ["cancelled"],
    write: (todo) => todo.cancelled && `❌ ${todo.cancelled}`,
  },
  { pattern: WORKED, keys: ["worked"], write: (todo) => todo.worked && `⏱ ${todo.worked}` },
  { pattern: ID, keys: ["id"], write: (todo) => todo.id && `🆔 ${todo.id}` },
];

/** `rest` naming `blocker` as well, straight after the last `⛔` it carries. */
function withBlocker(rest: string, blocker: string): string | null {
  const stamp = `⛔ ${blocker}`;
  const last = [...masked(rest).matchAll(new RegExp(BLOCKED_BY.source, "g"))].at(-1);
  if (last !== undefined) {
    // The value runs to a space or the line's end, so the stamp never touches a word.
    const at = last.index + last[0].length;
    return `${rest.slice(0, at)} ${stamp}${rest.slice(at)}`;
  }
  // The first one goes where any stamp goes, the end of the order.
  const had = readFields(rest);
  return withStamp(rest, stamp, ORDER.indexOf(BLOCKED_BY), {
    ...had,
    blockedBy: [...had.blockedBy, blocker],
  });
}

/** Whether two readings carry the same words and fields, however they were spelled. */
function sameFields(a: Fields, b: Fields): boolean {
  const key = (fields: Fields) =>
    JSON.stringify(
      Object.entries(fields)
        .filter(([, value]) => value !== undefined)
        .sort(([x], [y]) => x.localeCompare(y)),
    );
  return key(a) === key(b);
}

/** `rest` with `stamp` added where it reads as `want` asks, or null where no place does. */
function withStamp(rest: string, stamp: string, rank: number, want: Fields): string | null {
  const mask = masked(rest);
  // Straight after the field that comes before it in the order, where the line
  // carries one; else the first place the words end.
  const fields = ORDER.map((pattern) => find(pattern, rest, mask)).flatMap((found, order) =>
    found === null ? [] : [{ ...found, order }],
  );
  const before = fields.filter(({ order }) => order < rank).map((found) => found.to);
  const places = [
    ...(before.length === 0 ? [] : [Math.max(...before)]),
    ...endsOfWords(
      rest,
      fields.map((found) => found.from),
    ),
  ];

  for (const at of places) {
    // A space on both sides, so the stamp never runs into a word that sits
    // hard against the field before it, `⏫urgent`.
    const after = /^(?:[ \t]|$)/.test(rest.slice(at)) ? "" : " ";
    const written =
      at === 0
        ? `${stamp}${rest === "" ? "" : " "}${rest}`
        : `${rest.slice(0, at)} ${stamp}${after}${rest.slice(at)}`;
    if (sameFields(readFields(written), want)) return written;
  }
  return null;
}

/**
 * `line` in the state and with the stamps `want` carries, every other byte
 * kept: the indent as typed, the words, a `^block` id at the end and each field
 * where it sits. `boxed` false writes the line out of the cycle, with neither
 * bullet nor box.
 *
 * Exported for `todo-write.ts`, whose cascade and dependents change state the
 * way a press does, and whose `⛔` pick, timer and unblock write a field.
 */
export function patchLine(line: string, want: Todo, boxed = true): string {
  const todo = LINE.exec(line);
  const plain = PLAIN.exec(line);
  const indent = (todo ?? plain)?.[1] ?? "";
  // The one character between the box and the words, a tab where one was typed.
  const gap = todo?.[3] === undefined ? " " : (line[indent.length + 5] ?? " ");
  const { indent: _indent, state: _state, ...fields } = want;

  let rest = todo === null ? (plain?.[2] ?? "") : (todo[3] ?? "");
  for (const { pattern, keys, write } of STAMPS) {
    const had = readFields(rest);
    const was = write(had);
    const now = write(fields);
    if (was === now) continue;

    const found = find(pattern, rest, masked(rest));
    if (now === undefined) {
      if (found === null) continue;
      // The stamp and one space beside it, so the words close up as they were.
      let { from, to } = found;
      if (/[ \t]/.test(rest[from - 1] ?? "")) from -= 1;
      else if (/[ \t]/.test(rest[to] ?? "")) to += 1;
      rest = rest.slice(0, from) + rest.slice(to);
    } else if (was !== undefined && found !== null) {
      // A changed value is written over the old one, so a name typed after a
      // `👤` stays where it was, and so does a variation selector typed after
      // the marker: the line is the user's spelling, not ours.
      const typed = /^.️/u.test(rest.slice(found.from, found.to));
      const over = typed ? now.replace(/^./u, "$&️") : now;
      rest = rest.slice(0, found.from) + over + rest.slice(found.to);
    } else {
      const step = { ...had, ...Object.fromEntries(keys.map((key) => [key, fields[key]])) };
      const written = withStamp(rest, now, ORDER.indexOf(pattern), step);
      if (written === null) break;
      rest = written;
    }
  }

  // Added one at a time, each after the last, which is the order the line
  // reads back in. A blocker taken off is left to the rebuild below: no caller
  // takes one off.
  const named = readFields(rest).blockedBy;
  for (const blocker of fields.blockedBy.filter((id) => !named.includes(id))) {
    const written = withBlocker(rest, blocker);
    if (written === null) break;
    rest = written;
  }

  // Correct fields beat kept bytes: a line no place parses right on is
  // rebuilt in the field order, keeping only its indent.
  if (!sameFields(readFields(rest), fields)) rest = tail(want);

  if (!boxed) return `${indent}${rest}`;
  const box = todo?.[2] !== undefined && STATES[todo[2]] === want.state ? todo[2] : BOX[want.state];
  return `${indent}- [${box}]${rest === "" ? "" : `${gap}${rest}`}`;
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

  if (todo.waitingSince === undefined) return null;
  // The marker as typed, with or without the variation selector after it.
  const stamp = new RegExp(`👤️?[ \\t]+${todo.waitingSince}`).exec(line);
  return stamp === null ? null : stamp.index + stamp[0].length;
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
 * One step round the cycle.
 *
 * The walk is the work: open, doing, done, and out to a plain line again.
 * Blocked, waiting, review and rejected are things that happen to work rather
 * than steps in it, so none is on the walk and each is set by a key of its own. That is
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
