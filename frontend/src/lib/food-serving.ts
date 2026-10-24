/**
 * The serving step of the food search: the grams and servings of one food, the
 * chips that set them, the meal, and a preview of what the amount is worth. The
 * preview and the Log button sit in a foot that stays at the bottom of the sheet.
 */

import {
  type Choice,
  foodWords,
  MAX_GRAMS,
  MAX_SERVINGS,
  MEALS,
  make,
  mealByHour,
  type Nutrients,
  positive,
  servingValues,
} from "@/lib/food-math";
import type { FoodGoals, Goal } from "@/lib/log-kinds";
import { type DrinkTotals, foodLine, tenth } from "@/lib/log-lines";

export interface ServingHooks {
  /** Shows why the form logged nothing, or clears it with "". */
  say: (why: string) => void;
  /** Writes the line the form holds, and closes the panel. */
  log: (line: string) => void;
  back: () => void;
  /** Today's food totals and the config's food goals, read on each change. */
  today: () => { eaten: DrinkTotals["food"]; goals: FoodGoals };
}

export interface ServingForm {
  root: HTMLElement;
  /** Fills the form with a choice, the meal of the hour and one serving of it. */
  show: (choice: Choice) => void;
  /** Forgets the choice, so a Log the form still has under its hand writes nothing. */
  clear: () => void;
}

/** The macros in the order the card and the line write them. */
const MACROS = [
  { field: "protein", name: "Protein" },
  { field: "carbs", name: "Carbs" },
  { field: "fat", name: "Fat" },
] as const;

/** The amount chips: a gram chip sets grams, and `1 serving` sets the count to one. */
const CHIPS: { label: string; grams?: number }[] = [
  { label: "100 g", grams: 100 },
  { label: "150 g", grams: 150 },
  { label: "1 serving" },
  { label: "250 g", grams: 250 },
];

export function servingForm(hooks: ServingHooks): ServingForm {
  const root = make("div", "cm-log-food-serving");
  // Shown only by a pick, so the foot is not drawn over the search's results.
  root.hidden = true;
  const heading = make("div", "cm-log-food-heading");

  const chips = make("div", "cm-log-food-chips");
  const chipButtons = CHIPS.map(({ label, grams }) => {
    const chip = make("button", "cm-log-food-chip", label);
    chip.type = "button";
    chip.addEventListener("click", () => {
      if (grams === undefined) {
        servingsField.value = "1";
        fromServings();
      } else {
        gramsField.value = String(grams);
        fromGrams();
      }
      paint();
    });
    chips.append(chip);
    return { chip, gramsChip: grams !== undefined };
  });

  const gramsField = make("input", "cm-log-food-grams");
  gramsField.type = "text";
  gramsField.inputMode = "decimal";
  gramsField.placeholder = "grams";
  gramsField.setAttribute("aria-label", "Grams");
  const servingsField = make("input", "cm-log-food-servings");
  servingsField.type = "text";
  servingsField.inputMode = "decimal";
  servingsField.placeholder = "servings";
  servingsField.setAttribute("aria-label", "Servings");
  servingsField.value = "1";
  // Each field says what its number is, since two bare numbers read alike.
  const gramsLabel = make("label", "cm-log-food-field");
  gramsLabel.append(gramsField, make("span", "", "g"));
  const servingsLabel = make("label", "cm-log-food-field");
  servingsLabel.append(servingsField, make("span", "", "servings"));

  const meal = make("select", "cm-log-food-meal");
  meal.setAttribute("aria-label", "Meal");
  for (const option of MEALS) {
    const made = make("option", "", option);
    made.value = option;
    meal.append(made);
  }

  // The preview is the foot's: its kcal, what is left after, and the three macros.
  const preview = make("div", "cm-log-food-preview");
  const kcal = make("div", "cm-log-food-kcal-big");
  const left = make("div", "cm-log-food-left");
  const macros = MACROS.map(({ field, name }) => {
    const row = make("div", "cm-log-food-macro");
    const text = make("div", "cm-log-food-macro-text");
    const meter = make("div", "cm-log-food-meter");
    const fill = make("span", "");
    meter.append(fill);
    row.append(text, meter);
    return { field, name, row, text, meter, fill };
  });
  preview.append(kcal, left, ...macros.map(({ row }) => row));
  const line = make("div", "cm-log-food-line");
  const log = make("button", "cm-log-food-log", "Log this food");
  log.type = "button";
  log.setAttribute("aria-label", "Log this food");
  const back = make("button", "cm-log-food-back", "Back");
  back.type = "button";
  const actions = make("div", "cm-log-food-actions");
  actions.append(log, back);
  const foot = make("div", "cm-log-food-foot");
  foot.append(preview, line, actions);

  root.append(heading, chips, gramsLabel, servingsLabel, meal, foot);

  let current: Choice | null = null;

  /** The grams the fields hold, or null where the choice has no grams or none is typed. */
  function typedGrams(choice: Choice): number | null {
    return choice.serving_g === null ? null : positive(gramsField.value);
  }

  /** The line the Log button writes for the form as it is, or null where it would write none. */
  function draft(choice: Choice): { values: Nutrients; line: string } | null {
    const grams = typedGrams(choice);
    const count = positive(servingsField.value);
    if ((choice.serving_g !== null && grams === null) || count === null) return null;
    const values = servingValues(choice, grams ?? count);
    const written = foodLine({
      meal: meal.value,
      words: foodWords(choice.name, choice.brand, grams),
      kcal: values.kcal ?? undefined,
      protein: values.protein ?? undefined,
      carbs: values.carbs ?? undefined,
      fat: values.fat ?? undefined,
    });
    return { values, line: written };
  }

  function fromGrams(): void {
    if (current === null || current.serving_g === null) return;
    const typed = positive(gramsField.value);
    if (typed !== null)
      servingsField.value = String(Number((typed / current.serving_g).toFixed(2)));
  }

  function fromServings(): void {
    if (current === null || current.serving_g === null) return;
    const typed = positive(servingsField.value);
    if (typed !== null) gramsField.value = String(tenth(typed * current.serving_g));
  }

  /** The kcal of the amount, and what is left of today's kcal goal after it, or eaten after it with no goal. */
  function paintKcal(values: Nutrients, eaten: DrinkTotals["food"], goal: Goal | undefined): void {
    const added = values.kcal ?? 0;
    kcal.textContent = values.kcal === null ? "no kcal" : `🔥 ${Math.round(added)} kcal`;
    if (goal === undefined) {
      left.textContent = `kcal eaten after: ${Math.round(eaten.kcal + added)}`;
      return;
    }
    const after = Math.round(goal.value - eaten.kcal - added);
    left.textContent = after < 0 ? `kcal over after: ${-after}` : `kcal left after: ${after}`;
  }

  /** Each macro in words, and its meter against today's goal, which a ceiling turns to the warning colour once it is passed. */
  function paintMacro(
    part: (typeof macros)[number],
    values: Nutrients,
    eaten: DrinkTotals["food"],
    goal: Goal | undefined,
  ): void {
    const value = values[part.field];
    part.meter.hidden = goal === undefined;
    if (goal === undefined) {
      part.text.textContent = `${part.name} ${value === null ? "none given" : `${tenth(value)} g`}`;
      return;
    }
    const total = eaten[part.field] + (value ?? 0);
    const over = goal.type === "ceiling" && total > goal.value;
    // A ceiling passed is said in words as well as by the warning colour of the bar.
    const amount = value === null ? "none given" : `${tenth(value)} g`;
    part.text.textContent = over
      ? `${part.name} ${amount}, ${tenth(total - goal.value)} g over, at most ${goal.value} g`
      : `${part.name} ${amount} of ${goal.value} g, ${goal.type === "floor" ? "at least" : "at most"}`;
    part.fill.style.width = `${Math.min(100, (total / goal.value) * 100)}%`;
    part.meter.classList.toggle("cm-log-food-meter-over", over);
  }

  /** Draws the preview: kcal for this amount, what is left of today's goal after it, and each macro against its goal. */
  function paint(): void {
    const choice = current;
    const made = choice === null ? null : draft(choice);
    line.textContent = made?.line ?? "";
    if (choice === null || made === null) {
      kcal.textContent = "";
      left.textContent = "";
      for (const part of macros) {
        part.text.textContent = "";
        part.fill.style.width = "0%";
      }
      return;
    }
    const { eaten, goals } = hooks.today();
    paintKcal(made.values, eaten, goals.kcal);
    for (const part of macros) paintMacro(part, made.values, eaten, goals[part.field]);
  }

  gramsField.addEventListener("input", () => {
    fromGrams();
    paint();
  });
  servingsField.addEventListener("input", () => {
    fromServings();
    paint();
  });
  meal.addEventListener("change", paint);

  log.addEventListener("click", () => {
    const choice = current;
    if (choice === null) return;
    const grams = typedGrams(choice);
    if (choice.serving_g !== null && grams === null) {
      hooks.say("grams must be a number above zero");
      return;
    }
    const count = positive(servingsField.value);
    if (count === null) {
      hooks.say("servings must be a number above zero");
      return;
    }
    // Past these, a line's kcal runs to more digits than the log's parser reads. A food
    // with a serving size is held by the grams it writes; one without has only the count.
    if (grams !== null && grams > MAX_GRAMS) {
      hooks.say(`grams must be at most ${MAX_GRAMS}`);
      return;
    }
    if (choice.serving_g === null && count > MAX_SERVINGS) {
      hooks.say(`servings must be at most ${MAX_SERVINGS}`);
      return;
    }
    const made = draft(choice);
    if (made !== null) hooks.log(made.line);
  });
  back.addEventListener("click", () => hooks.back());

  function show(choice: Choice): void {
    current = choice;
    heading.textContent = choice.name;
    gramsField.disabled = choice.serving_g === null;
    gramsField.value = choice.serving_g === null ? "" : String(choice.serving_g);
    for (const { chip, gramsChip } of chipButtons) {
      chip.disabled = gramsChip && choice.serving_g === null;
    }
    servingsField.value = "1";
    meal.value = mealByHour(new Date().getHours());
    paint();
  }

  function clear(): void {
    current = null;
    paint();
  }

  return { root, show, clear };
}
