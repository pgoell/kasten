/**
 * The fields a todo line carries after its box: how each is spelled, read and stamped.
 * `todo.ts` owns the line and its state; this owns what the words after the box say.
 */

import { masked, SPANS, wordTags } from "@/lib/tag-rule";

export type TodoPriority = "highest" | "high" | "medium" | "low" | "lowest";

/** Every field a todo carries, each spelled on the line after its box. */
export interface Fields {
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
  /** Who the todo is for, as written after an undated `👤`: a name, or a `[[link]]` to one. */
  assignee?: string;
  /** The day a `[w]` todo began to wait, which is the date after its `👤`. */
  waitingSince?: string;
  /** Who it waits on, as written after the dated `👤`: a name, or a `[[link]]` to one. */
  waitingOn?: string;
}

const PRIORITY_OF: Record<string, TodoPriority> = {
  "🔺": "highest",
  "⏫": "high",
  "🔼": "medium",
  "🔽": "low",
  "⏬": "lowest",
};

// Each field as it is written. The value has to parse or the marker stays in
// the words, which is what makes a mistyped date visible rather than lost.
// `d` on every one, because a value is read off the words by its offsets: the
// match runs on a masked copy, where a link's own text is filler.
//
// `📆` and `🗓` are obsidian-tasks' other spellings of due. Any marker may be
// typed with the variation selector after it, as many keyboards do, so it may
// follow every one, and a write over one keeps it: see `patchFields`. It sits
// outside the priority's capture, which is looked up by the glyph alone.
export const DUE = /(?:📅|📆|🗓)️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const SCHEDULED = /⏳️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const START = /🛫️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const CREATED = /➕️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const DONE = /✅️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const CANCELLED = /❌️?[ \t]+(\d{4}-\d{2}-\d{2})/d;
const PRIORITY = /(🔺|⏫|🔼|🔽|⏬)️?/d;
// Ends at a space, a stop or the line's end, so `🏁 keep-it` stays words.
const ON_COMPLETION = /🏁️?[ \t]+(keep|delete)(?=[ \t\n]|$)/d;
// A one-word value never opens on a field marker, so a bare one-word marker stays
// words and the next field reads as itself: `⏲ 🆔 kt-1` reads the id `kt-1`.
// `👤` is left out on purpose: #1021 and #1024 let a one-word field hold it, as
// in `⏲ 👤 2026-10-20`. Literal emoji, no `u` flag: `withBlocker` copies the source.
const ID = /🆔️?[ \t]+(?!📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱)(\S+)/d;
const BLOCKED_BY = /⛔️?[ \t]+(?!📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱)(\S+)/d;
const ESTIMATE = /⏲️?[ \t]+(?!📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱)(\S+)/d;
const WORKED = /⏱️?[ \t]+(?!📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱)(\S+)/d;

// The one field whose value is free text, so it runs to the next marker rather
// than to the next space. A tag ends it too: a recurrence never carries one,
// and a tag belongs to the words, as does a `^block` id that ends the line. A
// stop where a field was taken out ends it as well.
const RECURRENCE =
  /🔁️?[ \t]+(.+?)(?=[ \t]*(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🏁|🆔|⛔|⏲|⏱|👤|#)|[ \t]+\^[\w-]+[ \t]*(?:\n|$)|[ \t]*\n|[ \t]*$)/d;

// Where a field was taken out, a stop for the fields read after it. Without it a
// value would run across the gap the field left, so `🔁 every week 📅 …` would
// read its recurrence on into the words. A todo's rest never holds a newline,
// and no value takes one.
const CUT = "\n";

// A `👤` followed by a date is the wait: the day it began, then who it waits on,
// the name optional. `👤` is a field of its own, so a name never runs past a
// second one; the value ends at the next marker, a tag, a `^block` id or a cut,
// which is also what lets `[[ada#notes]]` keep its anchor. The name is tried
// last, `??` rather than `?`, or a date stamped in front of a `^block` id would
// read the id as who the todo waits on.
const WAITING =
  /👤️?[ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+(.+?))??(?=[ \t]+(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱|👤|#|\^[\w-]+[ \t]*(?:\n|$))|[ \t]*\n|[ \t]*$)/d;

// A `👤` followed by anything that is no date and no marker is the assignee:
// who the todo is for, in any state. It runs to the same stops as the wait's
// name, so `👤 [[Pascal]] 👤 2026-10-25` reads the assignee and then the wait.
// The value may not open on a space, or the spaces would give back one and
// read the rest of the gap as the name; a `^block` id is never a name either.
const ASSIGNEE =
  /👤️?[ \t]+(?![ \t])(?!\d{4}-\d{2}-\d{2}(?:[ \t]|$))(?!(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱|👤|#|\^[\w-]+[ \t]*(?:\n|$)))(.+?)(?=[ \t]+(?:📅|📆|🗓|⏳|🛫|➕|✅|❌|🔺|⏫|🔼|🔽|⏬|🔁|🏁|🆔|⛔|⏲|⏱|👤|#|\^[\w-]+[ \t]*(?:\n|$))|[ \t]*\n|[ \t]*$)/d;

/** Every field in the order `tail` writes them, which is where a stamp is added. */
const ORDER = [
  ASSIGNEE,
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

/** `👤` too: its value runs to the next marker, so words after it would belong to the person. */
const MARKER = /📅|📆|🗓|⏳|🛫|🔺|⏫|🔼|🔽|⏬|🔁|🏁|➕|✅|❌|⏲|⏱|🆔|⛔|👤/gu;

const BLOCK_ID = /\^[\w-]+[ \t]*$/;

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

/** Every field written after the box, taken off the words that carried them. */
export function readFields(rest: string): Fields {
  return readTagged(rest).fields;
}

/**
 * Where each tag and field starts in `rest`, so a write lands on the stamp the line reads
 * back. Tags count only once the fields are out: `🆔 kt-a,#agent` carries none.
 */
export function readTagged(rest: string): {
  fields: Fields;
  tags: { tag: string; at: number }[];
  waitEnd: number | undefined;
  places: Map<RegExp, { from: number; to: number }>;
} {
  let text = rest;
  let mask = masked(rest);
  let origin = Array.from({ length: rest.length }, (_, at) => at);
  let waitEnd: number | undefined;
  const places = new Map<RegExp, { from: number; to: number }>();

  // The mask and the offsets are cut with the text, so the three stay in step.
  function take(pattern: RegExp): (string | undefined)[] {
    const found = find(pattern, text, mask);
    if (found === null) return [];
    // A match never runs over a stop, so mapped back through `origin` it is a
    // contiguous place in `rest`, which `patchFields` reads back as it stands.
    const place = { from: origin[found.from] ?? 0, to: (origin[found.to - 1] ?? 0) + 1 };
    if (pattern === WAITING) waitEnd = place.to;
    if (pattern !== BLOCKED_BY) places.set(pattern, place);
    text = text.slice(0, found.from) + CUT + text.slice(found.to);
    mask = mask.slice(0, found.from) + CUT + mask.slice(found.to);
    origin = [...origin.slice(0, found.from), -1, ...origin.slice(found.to)];
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
  const [assignee] = take(ASSIGNEE);

  // Taken out by origin, not by character, so a real character is never dropped
  // with a stop. The tags are read after this, and a stop holds no tag.
  const kept = origin.flatMap((from, at) => (from === -1 ? [] : [at]));
  text = kept.map((at) => text[at] ?? "").join("");
  origin = kept.map((at) => origin[at] ?? 0);

  // Read before the spaces close up, while `origin` still lines up. Closing
  // them up changes no tag, as a tag holds no space.
  const tags = wordTags(text).map(({ tag, at }) => ({ tag, at: origin[at] ?? at }));

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
    assignee,
    waitingSince,
    waitingOn,
  };
  return { fields, tags, waitEnd, places };
}

/**
 * Where words may end on a line, so a stamp or a link leaves the fields where they were.
 * A stamp also passes `fields`, so `📅 friday` is not split.
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
 * Where each field that parses starts in `rest`, in the order `tail` writes
 * them. Offsets into `rest`, not into the line.
 */
export function fieldStarts(rest: string): number[] {
  const mask = masked(rest);
  return ORDER.flatMap((pattern) => {
    const field = find(pattern, rest, mask);
    return field === null ? [] : [field.from];
  });
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
    pattern: ASSIGNEE,
    keys: ["assignee"],
    write: (todo) => todo.assignee && `👤 ${todo.assignee}`,
  },
  {
    pattern: WAITING,
    keys: ["waitingSince", "waitingOn"],
    write: (todo) =>
      todo.waitingSince === undefined
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
  const had = readFields(rest);
  const want = { ...had, blockedBy: [...had.blockedBy, blocker] };
  const last = [...masked(rest).matchAll(new RegExp(BLOCKED_BY.source, "g"))].at(-1);
  if (last !== undefined) {
    // The value runs to a space or the line's end, so the stamp never touches a
    // word. The insert is checked before it is kept.
    const at = last.index + last[0].length;
    const written = `${rest.slice(0, at)} ${stamp}${rest.slice(at)}`;
    if (sameFields(readFields(written), want)) return written;
  }
  // The first one goes where any stamp goes, the end of the order.
  return withStamp(rest, stamp, ORDER.indexOf(BLOCKED_BY), want);
}

/** Whether two readings carry the same words and fields, however they were spelled. */
export function sameFields(a: Fields, b: Fields): boolean {
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
 * `typed` with the stamps and blockers `fields` carries written in, or null
 * where no place reads back as `fields`. The caller then rebuilds the line.
 */
export function patchFields(typed: string, fields: Fields): string | null {
  let rest = typed;
  for (const { pattern, keys, write } of STAMPS) {
    const { fields: had, places } = readTagged(rest);
    const was = write(had);
    const now = write(fields);
    if (was === now) continue;

    const found = places.get(pattern) ?? null;
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

  return sameFields(readFields(rest), fields) ? rest : null;
}

/**
 * A todo's words without the `^block` id ending them. An id names one line, so
 * a copy that kept it would make a second block or leave stray text.
 */
export function withoutBlockId(text: string): string {
  return text.replace(/(?:^|[ \t]+)\^[\w-]+$/, "");
}
