/**
 * The streak the log pane and the overview count: days in a row within the kcal goal.
 * Kept out of the pane's components so the overview can read it without drawing the pane.
 */

import type { LogDay } from "@/lib/food-api";
import type { Goal } from "@/lib/log-kinds";

/** Whether a day's kcal is within its goal: a ceiling at or under it, a floor at or over it. */
export function within(kcal: number, goal: Goal): boolean {
  return goal.type === "floor" ? kcal >= goal.value : kcal <= goal.value;
}

/**
 * The logged days in a row, counted back from the day shown: within the kcal goal when
 * there is one. A day with no log, or over the goal, ends the run. Today, while it has no
 * log yet, is skipped instead, so a day still being written does not end it.
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
    if (day === undefined) {
      if (position === 0 && date === today) continue;
      break;
    }
    if (goal !== undefined && !within(day.totals.food.kcal ?? 0, goal)) break;
    count += 1;
  }
  return count;
}
