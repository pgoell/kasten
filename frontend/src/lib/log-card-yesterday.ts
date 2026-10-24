/**
 * Yesterday's food lines as the Log card offers to copy them: read once per view
 * and day, and the copies a meal with nothing logged yet can take. The card holds
 * the answer and draws it; this owns the read and what counts as a copy.
 */

import { StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { shiftDay } from "@/lib/clock";
import { fetchLog, type LogDay } from "@/lib/food-api";
import { MEALS, type Meal, type MealGroup } from "@/lib/log-day";

/** A food line of a meal, as yesterday holds it: the meal and the text exactly. */
export interface YesterdayLine {
  meal: Meal;
  text: string;
}

/** Yesterday's food lines, for the day the note named `day` comes after. */
export interface Yesterday {
  day: string;
  lines: YesterdayLine[];
}

/** A meal with nothing logged today and the lines yesterday had for it, which the card offers to copy. */
export interface Copy {
  meal: Meal;
  lines: string[];
}

/** Yesterday's answer, pushed to the card once the read of it is in. */
export const yesterdayArrived = StateEffect.define<Yesterday>();

/** The day of the yesterday read each view has asked for, so a view asks once per day. */
const asked = new WeakMap<EditorView, string>();

/** The meal a food line names, or null for a line that names none, or an unknown word. */
function mealOf(name: string | null | undefined): Meal | null {
  return MEALS.find((meal) => meal === name) ?? null;
}

/** The food lines of `yesterday` in `days`, as the card offers to copy them: the meal and the text, as written. */
function yesterdayLines(days: LogDay[], yesterday: string): YesterdayLine[] {
  const found = days.find((day) => day.date === yesterday);
  return (found?.entries ?? []).flatMap((entry) => {
    const meal = mealOf(entry.meal);
    return entry.kind === "food" && meal !== null ? [{ meal, text: entry.text }] : [];
  });
}

/** The copies the card offers: each meal with no food today and some for yesterday. */
export function copiesFor(day: string, yesterday: Yesterday | null, groups: MealGroup[]): Copy[] {
  if (yesterday === null || yesterday.day !== shiftDay(day, -1)) return [];
  return groups.flatMap((group) => {
    if (group.meal === null || group.entries.length > 0) return [];
    const lines = yesterday.lines
      .filter((line) => line.meal === group.meal)
      .map((line) => line.text);
    return lines.length > 0 ? [{ meal: group.meal, lines }] : [];
  });
}

/** Forgets what a view asked, when its card goes, so a card built anew asks again. */
export function forgetYesterday(view: EditorView): void {
  asked.delete(view);
}

/**
 * Asks for yesterday's food lines, once per view and day. A failed read is a card
 * with nothing to copy, and the note is still the note.
 */
export function askYesterday(view: EditorView, day: string): void {
  const yesterday = shiftDay(day, -1);
  if (asked.get(view) === yesterday) return;
  asked.set(view, yesterday);
  fetchLog(yesterday, yesterday).then(
    (days) => {
      // Gone from the page means the note was closed while the read was out.
      if (view.dom.isConnected) {
        view.dispatch({
          effects: yesterdayArrived.of({ day: yesterday, lines: yesterdayLines(days, yesterday) }),
        });
      }
    },
    (error: unknown) => {
      if (!(error instanceof Error)) throw error;
      console.warn(error.message);
    },
  );
}
