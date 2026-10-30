/**
 * The latest value of each kind that keeps its last value, read from the 30 days before a daily note.
 * Read only where the config has such a kind, so a vault without one asks for nothing more than yesterday.
 */

import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { shiftDay } from "@/lib/clock";
import { fetchLog, type LogDay } from "@/lib/log/food-api";
import type { LogKind } from "@/lib/log/log-kinds";

/** The latest value a kind logged before the day, with the day it was logged. */
export interface Earlier {
  mark: string;
  date: string;
  value: number;
}

/** The latest values before `day`, for the note whose day it is. */
export interface Latest {
  day: string;
  earlier: Earlier[];
}

/** The read's answer, pushed to the card once it is in. */
export const latestArrived = StateEffect.define<Latest>();

/** The day of the 30-day read each view has asked for, so a view asks once per day. */
const asked = new WeakMap<EditorView, string>();

/** The last total of each kind over `days`, by its mark: the day that is latest with a total. */
function latestOf(days: LogDay[]): Earlier[] {
  const found = new Map<string, Earlier>();
  for (const day of days) {
    for (const kind of day.totals.mine ?? []) {
      if (typeof kind.total !== "number") continue;
      const seen = found.get(kind.mark);
      if (seen === undefined || seen.date < day.date) {
        found.set(kind.mark, { mark: kind.mark, date: day.date, value: kind.total });
      }
    }
  }
  return [...found.values()];
}

/** Forgets what a view asked, when its card goes, so a card built anew asks again. */
export function forgetLatest(view: EditorView): void {
  asked.delete(view);
}

/**
 * Asks for the 30 days before `day`, once per view and day. A failed read is no
 * earlier value, and the note is still the note.
 */
export function askLatest(view: EditorView, day: string): void {
  if (asked.get(view) === day) return;
  asked.set(view, day);
  fetchLog(shiftDay(day, -30), shiftDay(day, -1)).then(
    (days) => {
      // Gone from the page means the note was closed while the read was out.
      if (view.dom.isConnected) {
        view.dispatch({ effects: latestArrived.of({ day, earlier: latestOf(days) }) });
      }
    },
    (error: unknown) => {
      if (!(error instanceof Error)) throw error;
      console.warn(error.message);
    },
  );
}

/**
 * What a last kind's button says on a day with no value: its latest value before the day, and when it was logged.
 * Undefined until this day's read is in, which leaves the button its own words.
 */
export function earlierWords(
  kind: LogKind,
  latest: Latest | null,
  day: string,
): string | undefined {
  if (latest === null || latest.day !== day) return undefined;
  const found = latest.earlier.find((entry) => entry.mark === kind.mark);
  if (found === undefined) return undefined;
  const short = new Date(`${found.date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const unit = kind.unit === "" ? "" : ` ${kind.unit}`;
  return `${found.value}${unit}, ${short}`;
}
