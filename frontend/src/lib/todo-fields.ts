/**
 * The fields a todo line carries after its box: how each one is spelled, how
 * it is read off the words, and how one is stamped in or out with every other
 * byte of the line kept.
 *
 * `todo.ts` owns the line and its state; this module owns what the words after
 * the box say.
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
  /** The day a `[w]` todo began to wait, which is the date after its `👤`. */
  waitingSince?: string;
  /** Who it waits on, as written after the `👤`: a name, or a `[[link]]` to one. */
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

/** `👤` too: its name runs to the next marker, so words after it would be who the todo waits on. */
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
 * `readFields`, and where each tag starts in `rest`. A tag is read on the
 * words once the fields are out, so `📅 2026-10-20#agent` carries one and
 * `🆔 kt-a,#agent` none; `origin` keeps each kept character's offset in `rest`
 * so `@` can find that same tag on the line.
 */
export function readTagged(rest: string): { fields: Fields; tags: { tag: string; at: number }[] } {
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
    waitingSince,
    waitingOn,
  };
  return { fields, tags };
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
 * `typed` with the stamps and blockers `fields` carries written in, or null
 * where no place reads back as `fields`. The caller then rebuilds the line.
 */
export function patchFields(typed: string, fields: Fields): string | null {
  let rest = typed;
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

  return sameFields(readFields(rest), fields) ? rest : null;
}

/**
 * A todo's words without the `^block` id ending them. An id names one line, so
 * a copy that kept it would make a second block or leave stray text.
 */
export function withoutBlockId(text: string): string {
  return text.replace(/(?:^|[ \t]+)\^[\w-]+$/, "");
}
