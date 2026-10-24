/**
 * The quick add of the food search: a kcal typed in, with a meal, written as a
 * food line with no words. For a meal eaten with no food to name.
 */

import { MAX_KCAL, MEALS, make, mealByHour, NUMBER } from "@/lib/food-math";
import { foodLine } from "@/lib/log-lines";

export interface QuickAddHooks {
  /** Shows why nothing was added, or clears it with "". */
  say: (why: string) => void;
  /** Writes the line and closes the panel. */
  log: (line: string) => void;
}

const BAD_KCAL = "kcal must be a number above zero, at most 9 digits";

export function quickAddForm(hooks: QuickAddHooks): HTMLElement {
  const root = make("div", "cm-log-food-quick");
  const kcal = make("input", "cm-log-food-quick-kcal");
  kcal.type = "text";
  kcal.inputMode = "numeric";
  kcal.placeholder = "kcal";
  kcal.setAttribute("aria-label", "Quick add kcal");
  const meal = make("select", "cm-log-food-quick-meal");
  meal.setAttribute("aria-label", "Quick add meal");
  for (const option of MEALS) {
    const made = make("option", "", option);
    made.value = option;
    meal.append(made);
  }
  meal.value = mealByHour(new Date().getHours());
  const add = make("button", "cm-log-food-quick-add", "Add");
  add.type = "button";
  add.setAttribute("aria-label", "Quick add");
  root.append(make("span", "cm-log-food-quick-label", "Quick add"), kcal, meal, add);

  add.addEventListener("click", () => {
    const typed = kcal.value.trim();
    const value = NUMBER.test(typed) ? Number(typed.replace(",", ".")) : 0;
    // Checked after rounding, since the line holds whole kcal: 999999999.5 writes as 1000000000, which has no kcal in it.
    const whole = Math.round(value);
    if (whole < 1 || whole >= MAX_KCAL) {
      hooks.say(BAD_KCAL);
      return;
    }
    hooks.say("");
    hooks.log(foodLine({ meal: meal.value, words: "", kcal: value }));
  });

  return root;
}
