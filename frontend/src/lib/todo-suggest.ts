/**
 * What can still be written on a todo line, offered while it is being written.
 *
 * Every field a todo carries is a glyph, and no glyph is on a keyboard, so the
 * line is far harder to write than it is to read. This answers with the fields
 * the line has not got yet, and with the values for the two that take one, off
 * nothing but the text before the cursor.
 *
 * One table of fields, read by the three places a todo is written.
 * `todoCompletions` wraps the line reading as a CodeMirror source for the
 * editor, the todo pane draws the same answers as buttons under the row it is
 * editing, and the add prompt draws them in the shorthand's own spelling.
 * Today is passed in rather than read here, so the whole of it is a function
 * over strings, the way `todo-shorthand.ts` takes its own.
 *
 * Four fields are deliberately not offered. `➕`, `✅` and `❌` are kasten's own
 * stamps, and a done date written by hand is one the done log knows nothing
 * about. `🆔` has a key of its own, `<leader>i`. And a `⛔` names another todo's
 * id, which nothing here can see.
 */

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { readClock } from "@/lib/clock";
import { PRIORITY_SYMBOL, parseTodo, type Todo, type TodoPriority } from "@/lib/todo";
import { expandShorthand, readDate } from "@/lib/todo-shorthand";
import { parseDuration } from "@/lib/todo-time";

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
 * One field, in both spellings a todo is written in.
 *
 * The line is the glyph the vault holds; the shorthand is the word the add
 * prompt takes. One table rather than two, so a field cannot be offered in one
 * place and forgotten in the other.
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
 * A field written in two steps: the marker, then the value asked for next.
 *
 * On a line the space goes in with the glyph, so what is typed while choosing
 * the value stands off it the way it will once it is chosen. In the shorthand
 * the colon does that job and there is no space to write. Either way the value
 * replaces everything from the end of the marker.
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

/** The three rules worth a key. Anything else is typed out after the `🔁`. */
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

/** A marker at the end of a todo line, with whatever has been typed after it. */
const VALUE = /(📅|⏳|🛫|⏲)[ \t]*([\w-]*)$/;

/** The same at the end of the shorthand, where the colon is the marker's own. */
const TERM = /(due|sched|start|est):(\S*)$/;

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
 * What can go in at the end of a todo line, or nothing where there is nothing
 * to offer.
 *
 * `prompted` is the caller saying it wants the fields whether or not a colon
 * asked for them: the pane draws them under every line it edits, and
 * `ctrl-space` in the editor is the same request. Without it the list waits to
 * be opened, so typing a todo is typing a todo.
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
  const typed = value?.[2] ?? "";
  if (value !== null && !written(glyph === "⏲", typed)) {
    // From the end of the marker rather than from the word, so the spaces
    // between the two are this answer's to write and there is exactly one.
    const days = narrow(value.index + glyph.length, values(glyph === "⏲", today, " "), typed);
    // Nothing answering to a part-written value is not nothing to offer: the
    // fields are still there, and a caller drawing them always would otherwise
    // draw an empty row for the length of a date being typed out by hand.
    if (days !== null) return days;
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
 * The same answers for the add prompt, which takes the shorthand rather than
 * the line.
 *
 * Always offered, and never narrowed: the prompt draws them under a single
 * short input, where a list of what is left to write is the whole point and
 * there is no prose for them to interrupt. What has been typed is read by
 * `expandShorthand`, so a field is off the list once its own term is on the
 * input, whichever way round the two were written.
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

  const pad = before === "" || /\s$/.test(before) ? "" : " ";
  return narrow(
    before.length,
    offer(expandShorthand(before, today), (field) => pad + field.short),
    "",
  );
}

/**
 * The same answers as a CodeMirror completion, on the line the cursor is on.
 *
 * Registered on the markdown language beside `wikiLinkCompletions`, so it joins
 * the one autocompletion `basicSetup` already mounted rather than fighting it.
 *
 * The list is narrowed above and `filter` is off, because the range starts at
 * the colon: CodeMirror would match `:due` against the labels and keep nothing.
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
