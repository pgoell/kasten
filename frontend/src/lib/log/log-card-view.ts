/**
 * The DOM the Log card draws. Each builder takes data and returns an element; `log-card.ts` says what a press does.
 * Colour is never the only sign: a passed max says "over", and a met floor shows a tick.
 */

import { type Meal, type MealGroup, overMax, share } from "@/lib/log/log-day";
import { type FoodGoals, type Goal, type LogKind, tapLine } from "@/lib/log/log-kinds";
import type { DrinkTotals, Food } from "@/lib/log/log-lines";

/** An element with its class and, when given, its text. */
function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text = "",
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== "") made.textContent = text;
  return made;
}

/**
 * A button that keeps the editor's focus and cursor. A press on the card is
 * handled by the card, and CodeMirror must not move the selection for it.
 */
export function button(
  words: string,
  label: string,
  className: string,
  press: () => void,
): HTMLButtonElement {
  const made = make("button", className, words);
  made.type = "button";
  made.setAttribute("aria-label", label);
  made.addEventListener("mousedown", (event) => event.preventDefault());
  made.addEventListener("click", press);
  return made;
}

/** The words Undo names: its line, or how many lines a copy wrote. */
export function undoWords(text: string): string {
  return text.includes("\n") ? `Undo ${text.split("\n").length} lines` : `Undo ${text.slice(2)}`;
}

/** The unit and grams an entry of a kind shows after its total. */
export function tailOf(kind: LogKind, totals: DrinkTotals): string {
  // Alcohol's grams follow its count, once there are some.
  const grams =
    kind.builtin === "alcohol" && totals.alcohol.grams > 0 ? `, ${totals.alcohol.grams} g` : "";
  // The water total is millilitres whatever unit its config line writes.
  const unit = kind.builtin === "water" ? "ml" : kind.unit;
  return `${unit ? ` ${unit}` : ""}${grams}`;
}

/**
 * Focuses `element` and shows it the least way. The browser's own scroll on a focus
 * differs by browser (Firefox jumped the note on a tap, #814), so the focus does not
 * scroll, and `nearest` moves the note only when the element is out of view, and only
 * as far as it takes to show it, the same in every browser.
 */
export function focusInPlace(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** A bar that is `progress` percent full. The width is the CSS's, so only the number is set here. */
function meter(progress: number, label: string): HTMLElement {
  const bar = make("span", "cm-log-bar");
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-label", label);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(progress));
  bar.style.setProperty("--log-progress", `${progress}%`);
  return bar;
}

/**
 * A total as its span, with the goal after it. A floor's span says whether it is met,
 * and a ceiling's says whether it is passed, so the warning colour is never the only sign.
 */
export function totalSpan(
  head: string,
  tail: string,
  total: number,
  goal: Goal | undefined,
): HTMLSpanElement {
  const span = make("span", "");
  if (goal === undefined) {
    span.textContent = `${head}${tail}`;
    return span;
  }
  span.classList.add("cm-log-goal");
  const words = `${head} / ${goal.value}${tail}`;
  if (goal.type === "floor") {
    const met = total >= goal.value;
    span.classList.add(met ? "cm-log-met" : "cm-log-short");
    span.textContent = met ? `${words} ✓` : words;
  } else {
    const over = overMax(total, goal);
    span.classList.add(over ? "cm-log-over" : "cm-log-under");
    if (over) span.classList.add("cm-log-warn");
    span.textContent = over ? `${words} ⚠` : words;
  }
  return span;
}

/**
 * The big figure of kcal: what is left of a max goal (or how far past it), what
 * is eaten where there is no max, with the goal under it and one bar.
 */
export function bigNumber(eaten: number, goal: Goal | undefined): HTMLElement {
  const box = make("div", "cm-log-big");
  const figure = make("span", "cm-log-big-figure");
  const words = make("span", "cm-log-big-words");
  box.append(figure, words);
  const whole = Math.round(eaten);
  if (goal === undefined) {
    figure.textContent = String(whole);
    words.textContent = "kcal eaten";
    return box;
  }
  const at = goal.type === "floor" ? "at least" : "at most";
  const under = make("div", "cm-log-big-goal", `${whole} of ${goal.value} kcal, ${at}`);
  box.append(under, meter(share(eaten, goal), "kcal"));
  if (goal.type === "floor") {
    figure.textContent = String(whole);
    words.textContent = "kcal eaten";
    return box;
  }
  const left = Math.round(goal.value - eaten);
  const over = left < 0;
  figure.textContent = String(Math.abs(left));
  words.textContent = over ? "kcal over" : "kcal left";
  if (over) words.classList.add("cm-log-warn");
  return box;
}

/** The macros as rings, each with its name and its grams against the goal written out. */
export function macroRings(food: DrinkTotals["food"], goals: FoodGoals): HTMLElement {
  const row = make("div", "cm-log-rings");
  const macros = [
    { field: "protein", name: "Protein" },
    { field: "carbs", name: "Carbs" },
    { field: "fat", name: "Fat" },
  ] as const;
  for (const { field, name } of macros) row.append(macroRing(name, food[field], goals[field]));
  return row;
}

/** One macro: its ring when it has a goal, its name, and its grams with the goal written out. */
function macroRing(name: string, value: number, goal: Goal | undefined): HTMLElement {
  const item = make("div", "cm-log-ring-item");
  if (goal !== undefined) {
    const ring = make("span", "cm-log-ring");
    ring.setAttribute("aria-hidden", "true");
    ring.style.setProperty("--log-progress", String(share(value, goal)));
    if (overMax(value, goal)) ring.classList.add("cm-log-warn");
    item.append(ring);
  }
  // A passed max says so in words, so the warn colour is never its only sign.
  const passed = goal !== undefined && overMax(value, goal);
  const figure = make("div", passed ? "cm-log-ring-words cm-log-warn" : "cm-log-ring-words");
  figure.append(make("span", "cm-log-ring-amount", `${value} g`));
  if (goal !== undefined) {
    // The goal's number and unit stay together; the words after them may wrap to a line of their own.
    const at = goal.type === "floor" ? "at least" : "at most";
    figure.append(
      " ",
      make("span", "cm-log-ring-goal", `of ${goal.value} g,`),
      " ",
      `${at}${passed ? ", over" : ""}`,
    );
  }
  const labels = make("div", "cm-log-ring-text");
  labels.append(make("span", "cm-log-ring-name", name), figure);
  item.append(labels);
  return item;
}

/**
 * One quick button: the tap's words, the kind's total with its goal, and a meter where there is a goal.
 * A kind that keeps its last value has no tap, so its button names the kind and shows the value, or
 * `words` on a day with none, which the card takes from the 30 days before it.
 */
export function quickButton(
  kind: LogKind,
  total: number | null,
  tail: string,
  press: () => void,
  words?: string,
): HTMLButtonElement {
  const line = tapLine(kind);
  if (line === null) return lastButton(kind, total, tail, press, words);
  const made = button("", `Log ${kind.name}`, "cm-log-button", press);
  made.append(make("span", "cm-log-button-tap", `+ ${line.slice(2)}`));
  const value = total ?? 0;
  const totalWords = totalSpan(`${kind.mark} ${value}`, tail, value, kind.goal);
  totalWords.classList.add("cm-log-button-total");
  made.append(totalWords);
  if (kind.goal !== undefined) made.append(meter(share(value, kind.goal), kind.name));
  return made;
}

/** A last kind's button: its name with its mark, the value or the words for a day with none, and a meter with a goal. */
function lastButton(
  kind: LogKind,
  total: number | null,
  tail: string,
  press: () => void,
  words = "no weigh-ins yet",
): HTMLButtonElement {
  const made = button("", `Log ${kind.name}`, "cm-log-button", press);
  const name = kind.name.charAt(0).toUpperCase() + kind.name.slice(1);
  made.append(make("span", "cm-log-button-tap", `${kind.mark} ${name}`));
  // The goal is read against the value, with the same words and warning a tap's total has.
  const totalWords =
    total !== null && kind.goal !== undefined
      ? totalSpan(String(total), tail, total, kind.goal)
      : make("span", "", total === null ? words : `${total}${tail}`);
  totalWords.classList.add("cm-log-button-total");
  made.append(totalWords);
  if (total !== null && kind.goal !== undefined) {
    made.append(meter(share(total, kind.goal), kind.name));
  }
  return made;
}

/** The main food button, the one the card's accent is for. */
export function foodButton(press: () => void): HTMLButtonElement {
  return button("+ Food", "Log food", "cm-log-button cm-log-button-main", press);
}

/** A meal's name for the card: its heading, as the note writes it in lower case. */
function mealTitle(meal: Meal | null): string {
  if (meal === null) return "No meal";
  return meal.charAt(0).toUpperCase() + meal.slice(1);
}

/** A food line's row: its words, then the kcal and each of P, C, F it sets, in that order. */
function entryRow(food: Food): HTMLElement {
  const entry = make("div", "cm-log-entry");
  entry.append(make("span", "cm-log-entry-words", food.words));
  if (food.kcal !== undefined) entry.append(make("span", "cm-log-entry-kcal", `${food.kcal} kcal`));
  const macros = [
    ["P", food.protein],
    ["C", food.carbs],
    ["F", food.fat],
  ] as const;
  for (const [name, value] of macros) {
    if (value !== undefined) entry.append(make("span", "cm-log-entry-macro", `${name} ${value}`));
  }
  return entry;
}

/**
 * One meal's block: its heading with the kcal, each food line with its words and
 * P, C, F, and when the meal is empty and yesterday had lines for it, the offer to
 * copy them. A meal with nothing to show, and no offer, draws nothing.
 */
export function mealBlock(
  group: MealGroup,
  offer: { lines: number; press: () => void } | null,
): HTMLElement | null {
  if (group.entries.length === 0 && offer === null) return null;
  const block = make("section", "cm-log-meal");
  const heading = make("div", "cm-log-meal-head");
  heading.append(make("span", "cm-log-meal-name", mealTitle(group.meal)));
  if (group.entries.length > 0)
    heading.append(make("span", "cm-log-meal-kcal", `${group.kcal} kcal`));
  block.append(heading);
  for (const { food } of group.entries) block.append(entryRow(food));
  if (offer !== null && group.meal !== null) {
    const noun = offer.lines === 1 ? "line" : "lines";
    const words = `Copy yesterday's ${group.meal} (${offer.lines} ${noun})`;
    block.append(button(words, words, "cm-log-copy", offer.press));
  }
  return block;
}

/**
 * The lines under `## Log`, as the doc holds them, in a fold. The card is drawn
 * again on every tap, so the fold's state is handed in and reported back.
 */
export function rawFold(
  lines: string[],
  open: boolean,
  onToggle: (open: boolean) => void,
): HTMLDetailsElement {
  const fold = make("details", "cm-log-raw");
  fold.open = open;
  fold.addEventListener("toggle", () => onToggle(fold.open));
  fold.append(make("summary", "", "Raw lines"));
  fold.append(make("pre", "cm-log-raw-lines", lines.join("\n")));
  return fold;
}

/** The big figure and the rings in one block, above the buttons. */
export function topBlock(food: DrinkTotals["food"], goals: FoodGoals): HTMLElement {
  const top = make("div", "cm-log-top");
  top.append(bigNumber(food.kcal, goals.kcal), macroRings(food, goals));
  return top;
}
