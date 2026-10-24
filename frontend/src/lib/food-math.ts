/**
 * The food search's pure parts: the meal of an hour, what a serving weighs and
 * holds, the words a line names, and the foods the log already holds. The panel
 * and its forms read these, so a serving reads the same wherever it is shown.
 */

import type { Food, LogDay } from "@/lib/food-api";
import { tenth } from "@/lib/log-lines";

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type Meal = (typeof MEALS)[number];

/** The nutrients of a serving or of a logged amount, null where none is known. */
export type Nutrients = Food["per_serving"];

/** A food the form takes: one Open Food Facts gave, one of your own, or one the log already holds. */
export interface Choice {
  name: string;
  brand: string | null;
  /** Grams in one serving, or null for a logged line that names no grams. */
  serving_g: number | null;
  per_serving: Nutrients;
}

/** The most a line may hold: beyond these its kcal has more digits than the parser reads. */
export const MAX_GRAMS = 5000;
export const MAX_SERVINGS = 100;
/** A quick add of a billion kcal or more has ten digits, which the parser does not read. */
export const MAX_KCAL = 1_000_000_000;
const RECENT_MAX = 10;
/** A number as typed: digits, then an optional point or comma and more digits. */
export const NUMBER = /^[0-9]+(?:[.,][0-9]+)?$/;
/** Words that end in a weight, as a line logged from this search writes it. */
export const GRAMS_END = /^(.*\S)[ \t]+([0-9]+(?:[.,][0-9]+)?)[ \t]*g$/i;

/** The meal a food is logged under at this hour: breakfast, lunch, dinner, or a snack otherwise. */
export function mealByHour(hour: number): Meal {
  if (hour >= 5 && hour <= 10) return "breakfast";
  if (hour >= 11 && hour <= 14) return "lunch";
  if (hour >= 17 && hour <= 21) return "dinner";
  return "snack";
}

/** The number typed, when it is a number above zero, or null. */
export function positive(text: string): number | null {
  const typed = text.trim();
  if (!NUMBER.test(typed)) return null;
  const value = Number(typed.replace(",", "."));
  return value > 0 ? value : null;
}

/**
 * The nutrients of `grams` of `food`, scaled from its serving. A choice with no
 * serving weight takes a count of its servings in `grams`, since that is all it has.
 */
export function servingValues(food: Choice, grams: number): Nutrients {
  const scale = food.serving_g === null ? grams : grams / food.serving_g;
  // A negative figure from Open Food Facts is no amount of food, so it reads as none.
  const times = (value: number | null) => (value === null || value < 0 ? null : value * scale);
  const { kcal, protein, carbs, fat } = food.per_serving;
  return { kcal: times(kcal), protein: times(protein), carbs: times(carbs), fat: times(fat) };
}

/**
 * The words of a food line: the name, the brand where the name lacks it, and the
 * grams. The brand is skipped when the name holds it already, so it is not written twice.
 */
export function foodWords(name: string, brand: string | null, grams: number | null): string {
  const named =
    brand !== null && !name.toLowerCase().includes(brand.toLowerCase())
      ? `${name} (${brand})`
      : name;
  return grams === null ? named : `${named} ${tenth(grams)} g`;
}

/** A line the log holds, as a food the form can take again. */
function choiceOf(words: string, entry: LogDay["entries"][number]): Choice {
  const per_serving: Nutrients = {
    kcal: entry.kcal ?? null,
    protein: entry.protein ?? null,
    carbs: entry.carbs ?? null,
    fat: entry.fat ?? null,
  };
  // The fields of a line are for the grams it names, so the grams are the serving.
  const found = GRAMS_END.exec(words);
  const grams = Number((found?.[2] ?? "0").replace(",", "."));
  if (found !== null && grams > 0) {
    return { name: found[1] ?? words, brand: null, serving_g: grams, per_serving };
  }
  return { name: words, brand: null, serving_g: null, per_serving };
}

/**
 * The foods the days' food lines name, newest first, one per words, at most ten.
 * A repeat of the same words, in any case, is the one already listed.
 */
export function recentFoods(days: LogDay[]): Choice[] {
  const newest = [...days].sort((a, b) => b.date.localeCompare(a.date));
  const seen = new Set<string>();
  const found: Choice[] = [];
  for (const day of newest) {
    for (const entry of [...day.entries].sort((a, b) => b.line - a.line)) {
      const words = entry.words ?? "";
      if (entry.kind !== "food" || words === "") continue;
      const key = words.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(choiceOf(words, entry));
      if (found.length === RECENT_MAX) return found;
    }
  }
  return found;
}

/** An element with its class and, when given, its text. */
export function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== "") made.textContent = text;
  return made;
}
