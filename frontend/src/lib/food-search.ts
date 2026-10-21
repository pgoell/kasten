/**
 * The food search on the log card: a query on Open Food Facts or a barcode, the
 * foods the last 30 days logged, and the serving a pick is logged with.
 *
 * The pure parts are exported so the card and the palette read a serving the same
 * way. `foodPanel` builds the panel the card draws while its search is open.
 */

import type { EditorView } from "@codemirror/view";
import { NO_CAMERA, startCamera } from "@/lib/barcode-camera";
import { shiftDay } from "@/lib/clock";
import { type Food, fetchLog, type LogDay, readBarcode, searchFood } from "@/lib/food-api";
import { foodLine, tenth } from "@/lib/log-lines";
import { dailyDate } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type Meal = (typeof MEALS)[number];

/** The nutrients of a serving or of a logged amount, null where none is known. */
export type Nutrients = Food["per_serving"];

/** A food the form takes: one Open Food Facts gave, or one the log already holds. */
export interface Choice {
  name: string;
  brand: string | null;
  /** Grams in one serving, or null for a logged line that names no grams. */
  serving_g: number | null;
  per_serving: Nutrients;
}

/** How long the query waits for the typing to stop before it is sent. */
const PAUSE_MS = 400;
/** The shortest query sent, so one letter is not a call to Open Food Facts. */
const QUERY_MIN = 2;
const RECENT_MAX = 10;
/** The most a line may hold: beyond these its kcal has more digits than the parser reads. */
const MAX_GRAMS = 5000;
const MAX_SERVINGS = 100;
const RECENT_DAYS = 30;
/** A number as typed: digits, then an optional point or comma and more digits. */
const NUMBER = /^[0-9]+(?:[.,][0-9]+)?$/;
/** Words that end in a weight, as a line logged from this search writes it. */
const GRAMS_END = /^(.*\S)[ \t]+([0-9]+(?:[.,][0-9]+)?)[ \t]*g$/i;

/** The meal a food is logged under at this hour: breakfast, lunch, dinner, or a snack otherwise. */
export function mealByHour(hour: number): Meal {
  if (hour >= 5 && hour <= 10) return "breakfast";
  if (hour >= 11 && hour <= 14) return "lunch";
  if (hour >= 17 && hour <= 21) return "dinner";
  return "snack";
}

/** The number typed, when it is a number above zero, or null. */
function positive(text: string): number | null {
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

export interface PanelHooks {
  /** Writes the food line and closes the panel. */
  log: (line: string) => void;
  /** Closes the panel, writing nothing. */
  close: () => void;
}

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The food search failed";
}

/** A result row: the name, the brand, the kcal per serving, and `recent` for a logged food. */
function pickButton(choice: Choice, recent: boolean, onPick: () => void): HTMLButtonElement {
  const made = make("button", "cm-log-food-pick");
  made.type = "button";
  made.append(make("span", "cm-log-food-name", choice.name));
  if (choice.brand !== null) made.append(make("span", "cm-log-food-brand", choice.brand));
  // Named by what it is per, since a search hit gives 100 g and a logged line gives its own amount.
  const kcal = choice.per_serving.kcal;
  const per = choice.serving_g === null ? "per serving" : `per ${tenth(choice.serving_g)} g`;
  made.append(
    make("span", "cm-log-food-kcal", kcal === null ? "no kcal" : `${Math.round(kcal)} kcal ${per}`),
  );
  if (recent) made.append(make("span", "cm-log-food-recent", "recent"));
  made.addEventListener("click", onPick);
  return made;
}

/** The totals a serving gives, in the words the form and the card use. Null values are left out. */
function previewWords(values: Nutrients): string {
  const parts: string[] = [];
  if (values.kcal !== null) parts.push(`🔥 ${Math.round(values.kcal)} kcal`);
  if (values.protein !== null) parts.push(`🥩 ${tenth(values.protein)} g`);
  if (values.carbs !== null) parts.push(`🍞 ${tenth(values.carbs)} g`);
  if (values.fat !== null) parts.push(`🧈 ${tenth(values.fat)} g`);
  return parts.join(" ");
}

/**
 * The search panel. It is built each time the card opens it, so its answers are
 * dropped when its element is no longer in the page: a search or read that comes
 * back after the panel closed, or after a later search, draws nothing.
 */
export function foodPanel(view: EditorView, hooks: PanelHooks): HTMLElement {
  const root = make("div", "cm-log-food");
  const query = make("input", "cm-log-food-query");
  query.type = "text";
  query.placeholder = "food or barcode";
  query.setAttribute("aria-label", "Food");
  const why = make("div", "cm-log-food-why");
  const results = make("div", "cm-log-food-results");

  const serving = make("div", "cm-log-food-serving");
  serving.hidden = true;
  const heading = make("div", "cm-log-food-heading");
  const grams = make("input", "cm-log-food-grams");
  grams.type = "text";
  grams.inputMode = "decimal";
  grams.placeholder = "grams";
  grams.setAttribute("aria-label", "Grams");
  const servings = make("input", "cm-log-food-servings");
  servings.type = "text";
  servings.inputMode = "decimal";
  servings.placeholder = "servings";
  servings.setAttribute("aria-label", "Servings");
  servings.value = "1";
  const meal = make("select", "cm-log-food-meal");
  meal.setAttribute("aria-label", "Meal");
  for (const option of MEALS) {
    const made = make("option", "", option);
    made.value = option;
    meal.append(made);
  }
  const preview = make("div", "cm-log-food-preview");
  const log = make("button", "cm-log-food-log", "Log");
  log.type = "button";
  log.setAttribute("aria-label", "Log this food");
  const back = make("button", "cm-log-food-back", "Back");
  back.type = "button";
  // Each field says what its number is, since two bare numbers read alike.
  const gramsField = make("label", "cm-log-food-field");
  gramsField.append(grams, make("span", "", "g"));
  const servingsField = make("label", "cm-log-food-field");
  servingsField.append(servings, make("span", "", "servings"));
  serving.append(heading, gramsField, servingsField, meal, preview, log, back);

  const close = make("button", "cm-log-food-close", "Close");
  close.type = "button";
  const bar = make("div", "cm-log-food-bar");
  const scan = make("button", "cm-log-food-scan", "Scan");
  scan.type = "button";
  scan.setAttribute("aria-label", "Scan a barcode");
  bar.append(query, scan);
  const video = make("video", "cm-log-food-camera");
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.hidden = true;
  root.append(bar, video, why, results, serving, close);

  let recents: Choice[] = [];
  let offHits: Food[] = [];
  let current: Choice | null = null;
  let latest = 0;
  /** Counts the picks, so a barcode read answered after a later pick is dropped. */
  let pickTurn = 0;
  let pause: ReturnType<typeof setTimeout> | undefined;
  /** Stops the camera of the scan running, or null while none runs. */
  let stopCamera: (() => void) | null = null;

  function render(): void {
    const typed = query.value.trim().toLowerCase();
    const matches = recents.filter((choice) => choice.name.toLowerCase().includes(typed));
    results.replaceChildren(
      ...matches.map((choice) => pickButton(choice, true, () => pickRecent(choice))),
      ...offHits.map((food) => pickButton(food, false, () => readPick(food))),
    );
  }

  /** The amount the form holds: grams, or a count of servings where the choice has no grams. */
  function amount(choice: Choice): number | null {
    return choice.serving_g === null ? positive(servings.value) : positive(grams.value);
  }

  function updatePreview(): void {
    const choice = current;
    const count = choice === null ? null : amount(choice);
    preview.textContent =
      choice === null || count === null ? "" : previewWords(servingValues(choice, count));
  }

  function show(choice: Choice): void {
    current = choice;
    heading.textContent = choice.name;
    grams.disabled = choice.serving_g === null;
    grams.value = choice.serving_g === null ? "" : String(choice.serving_g);
    servings.value = "1";
    meal.value = mealByHour(new Date().getHours());
    results.hidden = true;
    serving.hidden = false;
    updatePreview();
  }

  function search(text: string): void {
    latest += 1;
    const turn = latest;
    searchFood(text).then(
      (found) => {
        if (turn !== latest || !root.isConnected) return;
        offHits = found;
        why.textContent = "";
        render();
      },
      (error: unknown) => {
        if (turn !== latest || !root.isConnected) return;
        offHits = [];
        why.textContent = messageOf(error);
        render();
      },
    );
  }

  /** A pick from the recent foods needs no read, but it still ends a read that is in the air. */
  function pickRecent(choice: Choice): void {
    pickTurn += 1;
    show(choice);
  }

  /** A pick from the search is read for its serving first, since a hit carries none. */
  function readPick(food: Food): void {
    pickTurn += 1;
    const turn = pickTurn;
    readBarcode(food.code).then(
      (full) => {
        // A read answered after a later pick would put this food back over that one.
        if (turn !== pickTurn || !root.isConnected) return;
        show(full);
      },
      (error: unknown) => {
        if (turn !== pickTurn || !root.isConnected) return;
        why.textContent = messageOf(error);
        show(food);
      },
    );
  }

  /** A code the camera read is looked up as a pick is, so a late answer draws nothing. */
  /** The name search on screen, with no form: a read still in the air is for a form no longer shown, so it is dropped. */
  function showSearch(): void {
    pickTurn += 1;
    current = null;
    serving.hidden = true;
    results.hidden = false;
    render();
  }

  function readCode(code: string): void {
    pickTurn += 1;
    const turn = pickTurn;
    readBarcode(code).then(
      (full) => {
        if (turn !== pickTurn || !root.isConnected) return;
        show(full);
      },
      (error: unknown) => {
        if (turn !== pickTurn || !root.isConnected) return;
        // A form an earlier pick left up would take the name search's Log, so the search comes back first.
        showSearch();
        why.textContent = `${messageOf(error)}; search by name instead`;
        query.focus();
      },
    );
  }

  /** Starts a scan, or stops the one running: the button toggles. */
  function startScan(): void {
    if (stopCamera !== null) {
      stopScan();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      why.textContent = NO_CAMERA;
      return;
    }
    why.textContent = "";
    scan.textContent = "Stop";
    stopCamera = startCamera(video, root, (outcome) => {
      // The camera has stopped itself: a code was read, it did not run, or the page hid.
      stopCamera = null;
      scan.textContent = "Scan";
      if (outcome === undefined) return;
      if ("code" in outcome) {
        readCode(outcome.code);
        return;
      }
      why.textContent = outcome.why;
      query.focus();
    });
  }

  function stopScan(): void {
    stopCamera?.();
    stopCamera = null;
    scan.textContent = "Scan";
  }

  query.addEventListener("input", () => {
    if (pause !== undefined) clearTimeout(pause);
    render();
    pause = setTimeout(() => {
      const text = query.value.trim();
      if (text.length < QUERY_MIN) {
        // A search still in the air is dropped, so it cannot answer over the shorter query.
        latest += 1;
        offHits = [];
        render();
        return;
      }
      search(text);
    }, PAUSE_MS);
  });

  grams.addEventListener("input", () => {
    const typed = positive(grams.value);
    if (current?.serving_g && typed !== null) {
      servings.value = String(Number((typed / current.serving_g).toFixed(2)));
    }
    updatePreview();
  });

  servings.addEventListener("input", () => {
    const typed = positive(servings.value);
    if (current?.serving_g && typed !== null) {
      grams.value = String(tenth(typed * current.serving_g));
    }
    updatePreview();
  });

  log.addEventListener("click", () => {
    const choice = current;
    if (choice === null) return;
    const typedGrams = choice.serving_g === null ? null : positive(grams.value);
    if (choice.serving_g !== null && typedGrams === null) {
      why.textContent = "grams must be a number above zero";
      return;
    }
    const count = positive(servings.value);
    if (count === null) {
      why.textContent = "servings must be a number above zero";
      return;
    }
    // Past these, a line's kcal runs to more digits than the log's parser reads. A food
    // with a serving size is held by the grams it writes; one without has only the count.
    if (typedGrams !== null && typedGrams > MAX_GRAMS) {
      why.textContent = `grams must be at most ${MAX_GRAMS}`;
      return;
    }
    if (choice.serving_g === null && count > MAX_SERVINGS) {
      why.textContent = `servings must be at most ${MAX_SERVINGS}`;
      return;
    }
    const values = servingValues(choice, typedGrams ?? count);
    stopScan();
    hooks.log(
      foodLine({
        meal: meal.value,
        words: foodWords(choice.name, choice.brand, typedGrams),
        kcal: values.kcal ?? undefined,
        protein: values.protein ?? undefined,
        carbs: values.carbs ?? undefined,
        fat: values.fat ?? undefined,
      }),
    );
  });

  back.addEventListener("click", showSearch);

  // A key typed in a field is the field's own. The editor's keymap, vim's included,
  // sits above these fields, so the key must not reach it.
  // The camera stops with the panel, however the panel closes.
  const shut = () => {
    stopScan();
    hooks.close();
  };
  const keys = (event: KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === "Escape") shut();
  };
  query.addEventListener("keydown", keys);
  scan.addEventListener("keydown", keys);
  grams.addEventListener("keydown", keys);
  servings.addEventListener("keydown", keys);
  meal.addEventListener("keydown", keys);
  scan.addEventListener("click", startScan);
  close.addEventListener("click", () => shut());

  const path = view.state.facet(notePath);
  const day = path === undefined ? null : dailyDate(path);
  if (day !== null) {
    fetchLog(shiftDay(day, -RECENT_DAYS), day).then(
      (days) => {
        if (!root.isConnected) return;
        recents = recentFoods(days);
        render();
      },
      (error: unknown) => {
        if (!root.isConnected) return;
        why.textContent = messageOf(error);
      },
    );
  }

  return root;
}
