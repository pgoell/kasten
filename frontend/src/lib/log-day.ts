/**
 * What a day's `## Log` says, sorted for the card: its food lines by meal, and how
 * far a total has got toward its goal. Pure, so the card and its tests read the
 * same numbers. Each food line is read by `parseFood`, the reader the totals use,
 * so the meal groups add up to the totals the card shows.
 */

import type { Goal } from "@/lib/log-kinds";
import { type Food, logLines, parseFood, tenth } from "@/lib/log-lines";

/** The meals a food line can name, in the order the card shows them. */
export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type Meal = (typeof MEALS)[number];

/** A food line as it stands under `## Log`, with what it reads as. */
export interface FoodEntry {
  line: string;
  food: Food;
}

/** The food lines of one meal, and their kcal. `meal` is null for the lines that name none. */
export interface MealGroup {
  meal: Meal | null;
  entries: FoodEntry[];
  kcal: number;
}

/** The food lines under `## Log` of `text`, in line order. */
export function foodEntries(text: string): FoodEntry[] {
  const found: FoodEntry[] = [];
  for (const line of logLines(text)) {
    const food = parseFood(line);
    if (food !== null) found.push({ line, food });
  }
  return found;
}

/**
 * The entries of each meal, the four meals first in their order and the lines
 * with no meal last. A group with no entries is still there, so the card can ask
 * whether its meal is empty.
 */
export function groupByMeal(entries: FoodEntry[]): MealGroup[] {
  return [...MEALS, null].map((meal) => {
    const inMeal = entries.filter((entry) => (entry.food.meal ?? null) === meal);
    const kcal = tenth(inMeal.reduce((sum, entry) => sum + (entry.food.kcal ?? 0), 0));
    return { meal, entries: inMeal, kcal };
  });
}

/** How far `total` has got toward `goal`, from 0 to 100, as a bar or a ring draws it. */
export function share(total: number, goal: Goal): number {
  return Math.min(100, Math.max(0, Math.round((total / goal.value) * 100)));
}

/** Whether a total has passed a max goal. Only that passing is a warning; a min not met is not. */
export function overMax(total: number, goal: Goal): boolean {
  return goal.type === "ceiling" && total > goal.value;
}
