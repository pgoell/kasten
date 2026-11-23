/**
 * The words of a new todo, read for the fields they name: `call the landlord tomorrow p2
 * #Haus 30m` plans it tomorrow, high, in the Haus project, 30 minutes. What names no
 * field stays in the words.
 */

import { shiftDay } from "@/lib/core/clock";
import { projectName } from "@/lib/todo/view/rows/view-rows";
import type { NewTodo } from "@/lib/todo/view/todo-store";

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export interface QuickFields {
  planned?: string;
  due?: string;
  priority?: Priority;
  project?: string;
  estimate?: number;
  repeat?: string;
}

export interface Token {
  start: number;
  end: number;
  field: keyof QuickFields;
}

export interface Quick {
  /** The words with every token taken out. */
  words: string;
  fields: QuickFields;
  tokens: Token[];
}

const PRIORITIES: Record<string, Priority> = { p1: "highest", p2: "high", p3: "medium", p4: "low" };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DURATION = /^(?:(\d+)h)?(?:(\d+)m)?$/;
const REPEATS: Record<string, string> = {
  daily: "every day",
  weekly: "every week",
  monthly: "every month",
  yearly: "every year",
};

/** A day word as a date: today, tomorrow, a weekday (the next one), or `YYYY-MM-DD`. */
export function dayWord(word: string, today: string): string | undefined {
  const lower = word.toLowerCase();
  if (lower === "today") return today;
  if (lower === "tomorrow") return shiftDay(today, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;
  const wanted = WEEKDAYS.findIndex((day) => day === lower || day.slice(0, 3) === lower);
  if (wanted === -1) return undefined;
  const ahead = (wanted - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
  return shiftDay(today, ahead === 0 ? 7 : ahead);
}

function durationOf(word: string): number | undefined {
  const found = DURATION.exec(word);
  if (found === null || (found[1] === undefined && found[2] === undefined)) return undefined;
  return Number(found[1] ?? 0) * 60 + Number(found[2] ?? 0);
}

/** What one word sets, or nothing where it is a word. */
function readWord(word: string, today: string, projects: string[]): QuickFields | undefined {
  const lower = word.toLowerCase();
  const priority = PRIORITIES[lower];
  if (priority !== undefined) return { priority };
  if (lower.startsWith("due:")) {
    const due = dayWord(lower.slice(4), today);
    return due === undefined ? undefined : { due };
  }
  const planned = dayWord(lower, today);
  if (planned !== undefined) return { planned };
  const estimate = durationOf(lower);
  if (estimate !== undefined) return { estimate };
  const repeat = REPEATS[lower];
  if (repeat !== undefined) return { repeat };
  if (word.startsWith("#") && word.length > 1) {
    const name = lower.slice(1);
    const project = projects.find((each) => projectName(each).toLowerCase() === name);
    if (project !== undefined) return { project };
  }
  return undefined;
}

/** The fields the words name; a later word wins over an earlier one of the same field. */
export function readQuick(text: string, today: string, projects: string[]): Quick {
  const fields: QuickFields = {};
  const tokens: Token[] = [];
  const kept: string[] = [];
  for (const found of text.matchAll(/\S+/g)) {
    const word = found[0];
    const set = readWord(word, today, projects);
    if (set === undefined) {
      kept.push(word);
      continue;
    }
    Object.assign(fields, set);
    const field = Object.keys(set)[0] as keyof QuickFields;
    const start = found.index ?? 0;
    tokens.push({ start, end: start + word.length, field });
  }
  return { words: kept.join(" "), fields, tokens };
}

/**
 * The fields a new todo gets: what was picked by hand, else what the words name, else the
 * project or day of the group it was started from. `from` names those the words gave.
 */
export function settled(
  quick: Quick,
  picked: QuickFields,
  group: { project?: string | null; planned?: string },
): { fields: QuickFields; from: Set<keyof QuickFields> } {
  const base: QuickFields = {
    ...(group.project ? { project: group.project } : {}),
    ...(group.planned ? { planned: group.planned } : {}),
  };
  const fields: QuickFields = { ...base, ...quick.fields };
  const from = new Set(Object.keys(quick.fields) as (keyof QuickFields)[]);
  for (const key of Object.keys(picked) as (keyof QuickFields)[]) {
    from.delete(key);
    const value = picked[key];
    if (value === undefined) delete fields[key];
    else Object.assign(fields, { [key]: value });
  }
  return { fields, from };
}

/** What the store is sent for a new todo: every field it was given, the rest left out. */
export function newTodoOf(quick: Quick, fields: QuickFields, description: string): NewTodo {
  const named = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  return {
    words: quick.words.trim(),
    ...named,
    ...(fields.due === undefined ? {} : { due_hard: true }),
    ...(description.trim() === "" ? {} : { description }),
  };
}
