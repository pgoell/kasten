/**
 * The fields a todo line has not got yet, offered while it is written, from the text before
 * the cursor alone. `➕`, `✅` and `❌` are kasten's own stamps; `🆔` and `⛔` have their own keys.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { readClock } from "@/lib/clock";
import { PRIORITY_SYMBOL, parseTodo, type Todo } from "@/lib/todo/todo";
import type { TodoPriority } from "@/lib/todo/todo-fields";
import { offeredRules, parseRecurrence } from "@/lib/todo/todo-recur";
import { expandShorthand, readDate, readEvery } from "@/lib/todo/todo-shorthand";
import { parseDuration } from "@/lib/todo/todo-time";

export interface Suggestion {
  /** What it is called, which is what a part-typed word is matched against. */
  name: string;
  /** The glyph it writes, or the date a word means. Drawn beside the name. */
  hint: string;
  /** What goes in, in place of everything from `from`. */
  text: string;
}

export interface Suggestions {
  /** Where what goes in starts, as an offset into the text handed in. */
  from: number;
  options: Suggestion[];
}

/**
 * One field in both spellings: the glyph on a line, the word in the add prompt. One table,
 * so a field cannot be offered in one place and forgotten in the other.
 */
interface Field {
  name: string;
  /** The glyph, drawn beside the name wherever the field is offered. */
  hint: string;
  /** What goes on a todo line. */
  line: string;
  /** What goes in the prompt's shorthand. */
  short: string;
  /** Whether the todo already carries it, in which case it is not offered. */
  on: (todo: Todo) => boolean;
}

/**
 * A field written in two steps: the marker, then the value. On a line the space goes in with
 * the glyph; in the shorthand the colon does that job. The value replaces all after the marker.
 */
function marker(name: string, hint: string, term: string, on: (todo: Todo) => boolean): Field {
  return { name, hint, line: `${hint} `, short: `${term}:`, on };
}

const PRIORITIES: Field[] = (Object.keys(PRIORITY_SYMBOL) as TodoPriority[]).map((priority) => ({
  name: priority,
  hint: PRIORITY_SYMBOL[priority],
  line: PRIORITY_SYMBOL[priority],
  // `!med` and not `!medium`: the shorthand's own spelling, which is what the
  // prompt will read back.
  short: `!${priority === "medium" ? "med" : priority}`,
  on: (todo) => todo.priority !== undefined,
}));

/** The three rules worth a key. `repeat` below reaches the rest. */
const EVERY: Field[] = [
  ["daily", "day"],
  ["weekly", "week"],
  ["monthly", "month"],
].map(([name, period]) => ({
  name: name ?? "",
  hint: "🔁",
  line: `🔁 every ${period}`,
  short: `every:${period}`,
  on: (todo) => todo.recurrence !== undefined,
}));

/** Every field offered, in the order `formatTodo` writes them. */
const FIELDS: Field[] = [
  marker("due", "📅", "due", (todo) => todo.due !== undefined),
  marker("scheduled", "⏳", "sched", (todo) => todo.scheduled !== undefined),
  marker("start", "🛫", "start", (todo) => todo.start !== undefined),
  ...PRIORITIES,
  ...EVERY,
  marker("repeat", "🔁", "every", (todo) => todo.recurrence !== undefined),
  marker("estimate", "⏲", "est", (todo) => todo.estimate !== undefined),
];

/** The days offered after a date marker, resolved through the shorthand's own reader. */
const WHEN = [
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/** Round numbers, so the common estimate is a keystroke and the rest is typed. */
const HOW_LONG = ["15m", "30m", "45m", "1h", "2h", "4h"];

/**
 * A marker at the end of a todo line, with the variation selector it may be
 * typed with and whatever has been typed after it.
 */
const VALUE = /(📅|⏳|🛫|⏲)(️?)[ \t]*([\w-]*)$/;

/** The same at the end of the shorthand, where the colon is the marker's own. */
const TERM = /(due|sched|start|est):(\S*)$/;

/**
 * A `🔁` at the end of a todo line, with whatever has been typed after it. A
 * rule is several words, so this runs over spaces where a date stops at one.
 */
const RULE = /🔁(️?)[ \t]*([\w, \t]*)$/;

/** The same at the end of the shorthand, where a rule is one word. */
const EVERY_TERM = /every:(\S*)$/;

/** A colon opening the list, which has to start a word so prose keeps its own. */
const OPEN = /[ \t]:(\w*)$/;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the value after a marker is already written, so it is not a question. */
function written(long: boolean, value: string): boolean {
  return long ? parseDuration(value) !== null : DAY.test(value);
}

/** What follows a marker: a duration for the estimate, a day for the three dates. */
function values(long: boolean, today: string, pad: string): Suggestion[] {
  if (long) return HOW_LONG.map((how) => ({ name: how, hint: "", text: pad + how }));

  return WHEN.flatMap((word) => {
    const date = readDate(word, today);
    return date === undefined ? [] : [{ name: word, hint: date, text: pad + date }];
  });
}

/**
 * The rules that follow a `🔁`, counted from the todo's date or from today, narrowed to what
 * is typed. Each is matched in the spelling its caller writes, so each place narrows its own.
 */
function rules(todo: Todo, today: string, typed: string, spell: (rule: string) => string) {
  const wanted = typed.toLowerCase();
  return offeredRules(todo.due ?? todo.scheduled ?? todo.start ?? today)
    .map((rule) => ({ name: rule, hint: "", text: spell(rule) }))
    .filter(({ text }) => text.toLowerCase().startsWith(wanted));
}

/** `every week on Monday, Thursday` as the one word the shorthand takes. */
function asWord(rule: string): string {
  return rule.slice("every ".length).toLowerCase().replaceAll(", ", ",").replaceAll(" ", "-");
}

/** The fields the todo has not got, spelled the way the caller writes them. */
function offer(todo: Todo, spell: (field: Field) => string): Suggestion[] {
  return FIELDS.filter((field) => !field.on(todo)).map((field) => ({
    name: field.name,
    hint: field.hint,
    text: spell(field),
  }));
}

/** What is left once the part-typed word has had its say, or nothing at all. */
function narrow(from: number, options: Suggestion[], typed: string): Suggestions | null {
  const wanted = typed.toLowerCase();
  const kept = options.filter(({ name }) => name.startsWith(wanted));
  return kept.length === 0 ? null : { from, options: kept };
}

/**
 * What can go at the end of a todo line, or nothing. `prompted` asks for the fields even
 * without a colon, as the pane and `ctrl-space` do; otherwise typing a todo stays typing a todo.
 */
export function lineSuggestions(
  before: string,
  today: string,
  prompted = false,
): Suggestions | null {
  const todo = parseTodo(before);
  if (todo === null) return null;

  const value = VALUE.exec(before);
  const glyph = value?.[1] ?? "";
  const marker = glyph + (value?.[2] ?? "");
  const typed = value?.[3] ?? "";
  if (value !== null && !written(glyph === "⏲", typed)) {
    // From the end of the marker rather than from the word, so the spaces
    // between the two are this answer's to write and there is exactly one.
    // The selector is the marker's, so the answer goes after it.
    const days = narrow(value.index + marker.length, values(glyph === "⏲", today, " "), typed);
    // Nothing answering to a part-written value is not nothing to offer: the
    // fields are still there, and a caller drawing them always would otherwise
    // draw an empty row for the length of a date being typed out by hand.
    if (days !== null) return days;
  }

  const rule = RULE.exec(before);
  const begun = rule?.[2]?.trim() ?? "";
  if (rule !== null && parseRecurrence(begun) === null) {
    const options = rules(todo, today, begun, (text) => text);
    if (options.length > 0) {
      return {
        from: rule.index + "🔁".length + (rule[1] ?? "").length,
        options: options.map((option) => ({ ...option, text: ` ${option.text}` })),
      };
    }
  }

  const open = OPEN.exec(before);
  if (open === null && !prompted) return null;

  const word = open?.[1] ?? "";
  const from = open === null ? before.length : before.length - word.length - 1;
  // Appended to a line ending on a word, the field needs the space the colon
  // would have stood after.
  const pad = open === null && !/[ \t]$/.test(before) ? " " : "";

  return narrow(
    from,
    offer(todo, (field) => pad + field.line),
    word,
  );
}

/**
 * The same answers for the add prompt, which takes the shorthand. Always offered and never
 * narrowed: a field drops off once its own term is on the input, whichever way round.
 */
export function shorthandSuggestions(before: string, today: string): Suggestions | null {
  const term = TERM.exec(before);
  if (term !== null) {
    const long = term[1] === "est";
    const typed = term[2] ?? "";
    if (!written(long, typed)) {
      const days = narrow(before.length - typed.length, values(long, today, ""), typed);
      // For the reason the line reading falls through: `due:08-14` is a date
      // this list does not hold and the shorthand reads perfectly well.
      if (days !== null) return days;
    }
  }

  const every = EVERY_TERM.exec(before);
  const begun = every?.[1] ?? "";
  if (every !== null && readEvery(begun.toLowerCase()) === undefined) {
    const options = rules(expandShorthand(before, today), today, begun, asWord);
    if (options.length > 0) return { from: before.length - begun.length, options };
  }

  const pad = before === "" || /\s$/.test(before) ? "" : " ";
  return narrow(
    before.length,
    offer(expandShorthand(before, today), (field) => pad + field.short),
    "",
  );
}

/**
 * The same answers as a CodeMirror completion, on the cursor's line. Registered beside
 * `wikiLinkCompletions`. `filter` is off, since the range starts at the colon and would match nothing.
 */
export function todoCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const found = lineSuggestions(
    line.text.slice(0, context.pos - line.from),
    readClock(new Date()).date,
    context.explicit,
  );
  if (found === null) return null;

  return {
    from: line.from + found.from,
    options: found.options.map(({ name, hint, text }) => ({
      label: name,
      detail: hint,
      apply: text,
    })),
    filter: false,
  };
}
