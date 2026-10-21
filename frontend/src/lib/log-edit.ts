/**
 * Changing one line of a day's `## Log` from the log pane: what the line reads as
 * once changed, and the note's text with it put in place.
 *
 * A line is found by its number and checked by its text. A line that moved since
 * the pane read the note is refused, not written over.
 */

import { GRAMS_END } from "@/lib/food-search";
import { kindLine, type LogKind } from "@/lib/log-kinds";
import { amountLine, foodLine, parseFood, tenth } from "@/lib/log-lines";
import { periodicNote } from "@/lib/periodic";

/** A line of a note, counted from one as `GET /api/log` counts it. */
export interface LineAt {
  line: number;
  text: string;
}

const CHANGED = "that line has changed since the pane read it";
/** Digits, then an optional point or comma and more digits: what a servings count is typed as. */
const NUMBER = /^[0-9]+(?:[.,][0-9]+)?$/;
/** An alcohol line's marker and the count after it, which is all an edit of its count changes. */
const ALCOHOL_COUNT = /^(- 🍺️?[ \t]+)[0-9]{1,9}(?=[ \t]|$)/u;

/** The note with line `at.line` swapped for `next`, when that line still reads `at.text`. */
export function replaceLine(note: string, at: LineAt, next: string): string | { why: string } {
  const lines = note.split("\n");
  if (lines[at.line - 1] !== at.text) return { why: CHANGED };
  lines[at.line - 1] = next;
  return lines.join("\n");
}

/** The note with line `at.line` taken out, when that line still reads `at.text`. */
export function removeLine(note: string, at: LineAt): string | { why: string } {
  const lines = note.split("\n");
  if (lines[at.line - 1] !== at.text) return { why: CHANGED };
  lines.splice(at.line - 1, 1);
  return lines.join("\n");
}

/** The line above `at`, or null where `at` is the first line. */
export function lineAbove(note: string, at: LineAt): string | null {
  if (at.line <= 1) return null;
  return note.split("\n")[at.line - 2] ?? null;
}

/**
 * The note with `at.text` put back as line `at.line`, when the line above it is
 * still `above`. Null stands for the top of the note, so `at.line` must be 1.
 */
export function restoreLine(
  note: string,
  at: LineAt,
  above: string | null,
): string | { why: string } {
  const lines = note.split("\n");
  const same = above === null ? at.line === 1 : lines[at.line - 2] === above;
  if (!same) return { why: "the note has changed where the line was" };
  lines.splice(at.line - 1, 0, at.text);
  return lines.join("\n");
}

/** The count of an alcohol line changed, with its volume and strength left as they are. */
function alcoholLine(text: string, typed: string): string | { why: string } {
  const count = typed.trim();
  if (!/^[0-9]{1,9}$/.test(count) || Number(count) < 1) {
    return { why: `not an alcohol amount: ${typed}` };
  }
  if (!ALCOHOL_COUNT.test(text)) return { why: "that line is no alcohol line" };
  return text.replace(ALCOHOL_COUNT, `$1${count}`);
}

/**
 * A food line with its meal set to `meal` where one is given, and each field and
 * its grams multiplied by the servings. The line is written back with `foodLine`.
 */
function foodEdit(
  text: string,
  edit: { meal?: string; servings?: string },
): string | { why: string } {
  const food = parseFood(text);
  if (food === null) return { why: "that line is no food line" };
  const typed = (edit.servings ?? "1").trim();
  const scale = Number(typed.replace(",", "."));
  if (!NUMBER.test(typed) || scale <= 0) {
    return { why: "servings must be a number above zero" };
  }
  const grams = GRAMS_END.exec(food.words);
  const words =
    grams === null
      ? food.words
      : `${grams[1]} ${tenth(Number((grams[2] ?? "0").replace(",", ".")) * scale)} g`;
  const times = (value: number | undefined) => (value === undefined ? undefined : value * scale);
  return foodLine({
    meal: edit.meal ?? food.meal,
    words,
    kcal: times(food.kcal),
    protein: times(food.protein),
    carbs: times(food.carbs),
    fat: times(food.fat),
  });
}

/**
 * The text of an entry's line once the pane's edit is applied, or why the edit is
 * no amount of that kind. `kind` is the log config's kind of your own, given when
 * the entry is one.
 */
export function editedLine(
  entry: { text: string; kind: string },
  edit: { amount?: string; meal?: string; servings?: string },
  kind?: LogKind,
): string | { why: string } {
  const typed = edit.amount ?? "";
  switch (entry.kind) {
    case "water":
    case "coffee":
      return amountLine(entry.kind, typed);
    case "alcohol":
      return alcoholLine(entry.text, typed);
    case "mine":
      if (kind === undefined) return { why: "that kind is not in the log config" };
      // The tap is what an empty amount means for the built-in kinds. Here it would
      // write a line the pane did not ask for, so an empty edit is refused.
      if (typed.trim() === "") return { why: "type an amount" };
      return kindLine(kind, typed);
    case "food":
      return foodEdit(entry.text, edit);
    default:
      return { why: "that line is not one the log pane edits" };
  }
}

/** The daily note of `day`, a `YYYY-MM-DD`, and the text a new one starts with. */
export function dayNote(day: string): { path: string; body: string } {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  // Noon, so no zone or daylight change moves the date off its day.
  return periodicNote("daily", new Date(year, month - 1, date, 12));
}
