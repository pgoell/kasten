/**
 * The reads the review blocks make. Each one is the query another pane makes, under the
 * same key, so a write elsewhere reaches the review and the review asks nothing new when
 * the panes have asked already.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import {
  fetchCards,
  fetchNote,
  fetchTodos,
  fetchWritten,
  type LineHit,
  NoteMissing,
  type TodoHit,
} from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { fetchLog, type LogDay } from "@/lib/food-api";
import { LOG_NOTE } from "@/lib/layout";
import { DEFAULT_CONFIG, type LogConfig, parseConfig } from "@/lib/log-kinds";
import { periodicNote } from "@/lib/periodic";
import { fetchGithub, fetchWrittenNotes } from "@/lib/review-api";
import type { WrittenNote } from "@/lib/review-year";

/**
 * What one read answered: its data, or the sentence its failure is said in. While it is
 * still out, `data` is the fallback and `pending` is set, so a section says it is reading
 * rather than that there is nothing.
 */
export interface Read<T> {
  data: T;
  error?: string;
  pending: boolean;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The read did not load";
}

/** A read's answer as the review draws it, with the fallback until it arrives. */
function readOf<T>(
  query: { data: T | undefined; error: unknown; isPending: boolean },
  fallback: T,
): Read<T> {
  return {
    data: query.data ?? fallback,
    error: query.error ? messageOf(query.error) : undefined,
    pending: query.isPending,
  };
}

/** The log's config note, read the way the log pane reads it: a missing note is the defaults. */
function useConfig(): Read<LogConfig> {
  const query = useQuery({
    queryKey: ["note", LOG_NOTE],
    queryFn: () => fetchNote(LOG_NOTE),
    select: parseConfig,
  });
  if (query.error instanceof NoteMissing) return { data: DEFAULT_CONFIG, pending: false };
  return readOf(query, DEFAULT_CONFIG);
}

/** The todos and the flashcard lines, the two lists every review counts. */
function useLists() {
  const todos = useQuery({ queryKey: ["todos", false], queryFn: () => fetchTodos(false) });
  const cards = useQuery({ queryKey: ["cards", false], queryFn: () => fetchCards(false) });
  return {
    todos: readOf<TodoHit[]>(todos, []),
    cards: readOf<LineHit[]>(cards, []),
  };
}

/** The GitHub grid's read, which the backend answers with `on: false` when it has no token. */
function useGithub(from: string, to: string): Read<{ on: boolean; days: Record<string, number> }> {
  const query = useQuery({
    queryKey: ["github", from, to],
    queryFn: () => fetchGithub(from, to),
  });
  return readOf(query, { on: true, days: {} });
}

export interface YearReads {
  config: Read<LogConfig>;
  days: Read<LogDay[]>;
  todos: Read<TodoHit[]>;
  cards: Read<LineHit[]>;
  written: Read<string[]>;
  notes: Read<WrittenNote[]>;
  github: Read<{ on: boolean; days: Record<string, number> }>;
}

/** Every read the year review makes, over `from` to `to`. */
export function useYearReads(from: string, to: string): YearReads {
  const config = useConfig();
  const lists = useLists();
  const days = useQuery({ queryKey: ["log", from, to], queryFn: () => fetchLog(from, to) });
  const written = useQuery({
    queryKey: ["written", from, to],
    queryFn: () => fetchWritten(from, to),
  });
  const notes = useQuery({
    queryKey: ["written-notes", from, to],
    queryFn: () => fetchWrittenNotes(from, to),
  });
  return {
    config,
    ...lists,
    days: readOf(days, []),
    written: readOf(written, []),
    notes: readOf(notes, []),
    github: useGithub(from, to),
  };
}

/** The seven days from `monday` on, as `YYYY-MM-DD`. */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, index) => shiftDay(monday, index));
}

/** A daily note's path, the one `periodicNote` names for its day. Noon, so no zone moves the day. */
function dailyPath(date: string): string {
  return periodicNote("daily", new Date(`${date}T12:00:00`)).path;
}

export interface WeekReads {
  config: Read<LogConfig>;
  /** From 28 days before Monday, since the weight change reads the weigh-in before the week. */
  days: Read<LogDay[]>;
  todos: Read<TodoHit[]>;
  cards: Read<LineHit[]>;
  /** The text of each day's note, in the order of `weekDates`; a day with no note is "". */
  notes: Read<string[]>;
  github: Read<{ on: boolean; days: Record<string, number> }>;
}

/** Every read the week review makes, for the week from `monday` to `sunday`. */
export function useWeekReads(monday: string, sunday: string): WeekReads {
  const config = useConfig();
  const lists = useLists();
  const from = shiftDay(monday, -28);
  const days = useQuery({ queryKey: ["log", from, sunday], queryFn: () => fetchLog(from, sunday) });
  const dailies = useQueries({
    queries: weekDates(monday).map((date) => {
      const path = dailyPath(date);
      return { queryKey: ["note", path], queryFn: () => fetchNote(path) };
    }),
  });
  // A day with no note is a day of no text, not a failure: the note is simply not there.
  const failed = dailies.find(
    (daily) => daily.error !== null && !(daily.error instanceof NoteMissing),
  );
  return {
    config,
    ...lists,
    days: readOf(days, []),
    notes: {
      data: dailies.map((daily) => daily.data ?? ""),
      error: failed?.error ? messageOf(failed.error) : undefined,
      pending: dailies.some((daily) => daily.isPending),
    },
    github: useGithub(monday, sunday),
  };
}
