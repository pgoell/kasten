/**
 * The streak the log pane and the overview count: days in a row within the kcal goal, and
 * the food day that every kcal count reads, shared by the pane, the overview and the week
 * review. Kept out of the pane's components so the overview can read it without drawing the pane.
 */

import type { LogDay } from "@/lib/food-api";
import type { Goal } from "@/lib/log-kinds";

/** Whether a day's kcal is within its goal: a ceiling at or under it, a floor at or over it. */
export function within(kcal: number, goal: Goal): boolean {
  return goal.type === "floor" ? kcal >= goal.value : kcal <= goal.value;
}

/** Whether a day has a food line. Drinks, or a line of your own such as weight, alone make no food day. */
export function hasFood(day: LogDay): boolean {
  return day.entries.some((entry) => entry.kind === "food");
}

/**
 * The logged days in a row, counted back from the day shown: within the kcal goal when
 * there is one. A day with no log, or over the goal, ends the run. A day with no food line
 * counts as a day with no log, so drinks alone do not pass for a day within the goal. Today,
 * while it has no food line yet, is skipped instead, so a day still being written does not
 * end it.
 */
export function streakOf(
  dates: string[],
  byDate: Map<string, LogDay>,
  today: string,
  goal: Goal | undefined,
): number {
  let count = 0;
  for (const [position, date] of [...dates].reverse().entries()) {
    const day = byDate.get(date);
    if (day === undefined || !hasFood(day)) {
      if (position === 0 && date === today) continue;
      break;
    }
    if (goal !== undefined && !within(day.totals.food.kcal ?? 0, goal)) break;
    count += 1;
  }
  return count;
}
