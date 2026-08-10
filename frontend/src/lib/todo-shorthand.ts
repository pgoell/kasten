/**
 * One small language, read twice.
 *
 * The pane's filter line and the add prompt take the same words, so `#kasten`
 * means the same thing wherever it is typed. As a filter the words pick todos
 * out of a list; as instructions they build one. A word that is not a term is
 * neither, so it stays in the text, which is what makes a mistyped date visible
 * rather than lost.
 *
 * Today is passed in as `YYYY-MM-DD` rather than read from a clock here, so
 * every function below is a function over strings.
 */

import { shiftDay } from "@/lib/clock";
import { TAG, type Todo, type TodoPriority, type TodoState } from "@/lib/todo";
import { parseRecurrence } from "@/lib/todo-recur";
import { parseDuration } from "@/lib/todo-time";

export type DueWindow = "today" | "overdue" | "week";

/** One side of a filter: what a row must carry, or what it must not. */
export interface Terms {
  /** Each with its hash, matching `Todo.tags`. */
  tags: string[];
  priorities: TodoPriority[];
  states: TodoState[];
  due: DueWindow[];
}

export interface Filter {
  has: Terms;
  hasNot: Terms;
  /** Everything that was not a term, which the caller ranks through `fuzzy.ts`. */
  text: string;
}

const PRIORITY_TERMS: Record<string, TodoPriority> = {
  "!highest": "highest",
  "!high": "high",
  "!med": "medium",
  "!low": "low",
  "!lowest": "lowest",
};

const STATE_TERMS: Record<string, TodoState> = {
  "/open": "open",
  "/doing": "doing",
  "/done": "done",
  "/blocked": "blocked",
  "/rejected": "rejected",
};

const DUE_TERMS: Record<string, DueWindow> = {
  "due:today": "today",
  "due:overdue": "overdue",
  "due:<7d": "week",
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DAY = /^\d{2}-\d{2}$/;

function noTerms(): Terms {
  return { tags: [], priorities: [], states: [], due: [] };
}

/** Take one word as a term, or answer false and leave it to the words. */
function addTerm(terms: Terms, word: string): boolean {
  const priority = PRIORITY_TERMS[word];
  if (priority !== undefined) {
    terms.priorities.push(priority);
    return true;
  }

  const state = STATE_TERMS[word];
  if (state !== undefined) {
    terms.states.push(state);
    return true;
  }

  const due = DUE_TERMS[word];
  if (due !== undefined) {
    terms.due.push(due);
    return true;
  }

  // A bare `#` names no tag, so it is a word like any other.
  if (word.startsWith("#") && word.length > 1) {
    terms.tags.push(word);
    return true;
  }

  return false;
}

export function parseFilter(input: string): Filter {
  const has = noTerms();
  const hasNot = noTerms();
  const words: string[] = [];

  for (const word of input.split(/\s+/)) {
    if (word === "") continue;
    const negated = word.startsWith("-");
    // The word keeps its `-` where it turns out not to be a term, because
    // `-later` is then something the reader typed to search for.
    if (!addTerm(negated ? hasNot : has, negated ? word.slice(1) : word)) words.push(word);
  }

  return { has, hasNot, text: words.join(" ") };
}

// ISO dates sort as strings, which is the whole of the date maths below.
function inWindow(due: string | undefined, window: DueWindow, today: string): boolean {
  if (due === undefined) return false;
  if (window === "overdue") return due < today;
  if (window === "today") return due === today;
  // `<7d` as it is spelled: less than seven days out, so today counts and the
  // seventh day does not.
  return due < shiftDay(today, 7);
}

/** Whether each non-empty group is answered, one entry per group that has terms. */
function groups(todo: Todo, terms: Terms, today: string): boolean[] {
  const answered: boolean[] = [];

  if (terms.tags.length > 0) answered.push(terms.tags.some((tag) => todo.tags.includes(tag)));
  if (terms.priorities.length > 0) {
    answered.push(terms.priorities.some((priority) => priority === todo.priority));
  }
  if (terms.states.length > 0) answered.push(terms.states.some((state) => state === todo.state));
  if (terms.due.length > 0) {
    answered.push(terms.due.some((window) => inWindow(todo.due, window, today)));
  }

  return answered;
}

/** True when every non-empty group in `has` matches and nothing in `hasNot` does. */
export function matchesFilter(todo: Todo, filter: Filter, today: string): boolean {
  return (
    groups(todo, filter.has, today).every(Boolean) &&
    !groups(todo, filter.hasNot, today).some(Boolean)
  );
}

/**
 * What was written after `due:`, as a date, or nothing where it is not one.
 *
 * Exported because `todo-suggest.ts` offers the same words the other way round:
 * this reads `tomorrow` as a date, and that offers `tomorrow` as one.
 */
export function readDate(value: string, today: string): string | undefined {
  if (value === "today") return today;
  if (value === "tomorrow") return shiftDay(today, 1);
  if (DAY.test(value)) return real(value);
  // `08-14` is this year's, taken from today rather than rolled forward: a date
  // that has been and gone is the reader's to correct, not this module's.
  if (MONTH_DAY.test(value)) return real(`${today.slice(0, 4)}-${value}`);

  const wanted = WEEKDAYS.findIndex((day) => day === value || day.slice(0, 3) === value);
  if (wanted === -1) return undefined;

  const ahead = (wanted - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  // Naming today's weekday means the next one, a week off. Somebody typing
  // `due:monday` on a Monday means the Monday to come.
  return shiftDay(today, ahead === 0 ? 7 : ahead);
}

/**
 * The date itself, or nothing where the calendar has no such day.
 *
 * Read back rather than only tested for NaN: `2026-02-30` parses, silently, as
 * the second of March, and a date nobody typed is worse on disk than no date.
 */
function real(day: string): string | undefined {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return undefined;
  return at.toISOString().slice(0, 10) === day ? day : undefined;
}

/** The three dates that can be written here, each naming the field it sets. */
const DATE_TERMS: Record<string, "due" | "scheduled" | "start"> = {
  due: "due",
  sched: "scheduled",
  start: "start",
};

/** A recurrence with its spaces taken out, `3months` for `every 3 months`. */
const PERIOD = /^(\d+)?([a-z]+)$/;

/**
 * `week` or `3months` as the rule a `🔁` carries, or nothing where it is not one.
 *
 * A word cannot hold the space obsidian-tasks writes the rule with, so the
 * number and the unit are written together and put back apart here. Read back
 * through the parser that will act on it, so a rule nothing can count from
 * stays in the words rather than sitting on the line saying nothing.
 */
function readEvery(value: string): string | undefined {
  const found = PERIOD.exec(value);
  if (found === null) return undefined;

  const rule = `every ${found[1] === undefined ? "" : `${found[1]} `}${found[2]}`;
  return parseRecurrence(rule) === null ? undefined : rule;
}

/**
 * The same terms read as instructions: `due:08-14` sets a date rather than
 * picking one.
 *
 * State terms are not instructions here, a fresh todo being open by definition,
 * so `/doing` stays in the words where it was typed. So does anything after
 * `due:` that is not a date, for the reason `todo.ts` keeps a marker it cannot
 * read: a mistyped field the reader can see is one they can fix.
 *
 * `sched:`, `start:`, `est:` and `every:` are instructions and nothing else:
 * there is nothing useful to filter on in any of them, so `parseFilter` leaves
 * all four in the words it ranks.
 */
export function expandShorthand(input: string, today: string): Todo {
  let priority: TodoPriority | undefined;
  let estimate: string | undefined;
  let recurrence: string | undefined;
  const dates: Partial<Record<"due" | "scheduled" | "start", string>> = {};
  const words: string[] = [];

  for (const word of input.split(/\s+/)) {
    if (word === "") continue;

    const found = PRIORITY_TERMS[word];
    if (found !== undefined) {
      priority = found;
      continue;
    }

    // Everything below is `term:value`. A word holding no colon names no term,
    // and one whose value does not parse is a word like any other.
    const colon = word.indexOf(":");
    const term = word.slice(0, colon).toLowerCase();
    const value = word.slice(colon + 1);

    const field = colon === -1 ? undefined : DATE_TERMS[term];
    if (field !== undefined) {
      const date = readDate(value.toLowerCase(), today);
      if (date !== undefined) {
        dates[field] = date;
        continue;
      }
    }

    // The one path by which kasten rather than your keyboard puts a `⏲` on a
    // line.
    if (term === "est" && parseDuration(value) !== null) {
      estimate = value;
      continue;
    }

    if (term === "every") {
      const rule = readEvery(value.toLowerCase());
      if (rule !== undefined) {
        recurrence = rule;
        continue;
      }
    }

    words.push(word);
  }

  const text = words.join(" ");
  return {
    indent: 0,
    state: "open",
    text,
    tags: text.match(TAG) ?? [],
    ...dates,
    priority,
    recurrence,
    created: today,
    blockedBy: [],
    estimate,
  };
}
