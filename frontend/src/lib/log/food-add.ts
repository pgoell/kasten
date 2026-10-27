/**
 * The food search's add form: a food of your own, typed off its pack and saved
 * to the foods note. The panel opens it and hears back the food once saved.
 */

import { addMyFood, cleanName, type MyFood } from "@/lib/log/my-foods";

/** A barcode as Open Food Facts and the foods note take it. */
export const BARCODE = /^[0-9]{8,14}$/;
const NUMBER = /^[0-9]+(?:[.,][0-9]+)?$/;
/** The most grams a serving may hold, as the serving form takes at most. */
const MAX_SERVING = 5000;
/** Nothing holds more than pure fat's 900 kcal in 100 g, so a bigger figure is a typo. */
const MAX_FIGURE = 1000;

export interface AddHooks {
  /** Shows why the form saved nothing, or clears it with "". */
  say: (why: string) => void;
  /** The food, once it is in the note. */
  saved: (food: MyFood) => void;
  back: () => void;
}

export interface AddForm {
  root: HTMLElement;
  /** Fills the name from the query and the barcode from an unknown code, and puts the cursor in the name. */
  open: (query: string, code: string | null) => void;
}

/** The food the fields hold, or why they hold none. */
function readFood(
  name: string,
  serving: string,
  code: string,
  figures: string[],
): MyFood | { why: string } {
  const cleaned = cleanName(name);
  if (cleaned === "") return { why: "the food needs a name" };
  const grams = NUMBER.test(serving.trim()) ? Number(serving.trim().replace(",", ".")) : 0;
  if (grams <= 0 || grams > MAX_SERVING) {
    return { why: `serving must be a number above zero, at most ${MAX_SERVING}` };
  }
  if (code !== "" && !BARCODE.test(code)) return { why: "a barcode is 8 to 14 digits" };
  // Each figure is left empty or typed as a number from 0; kcal is the one the log needs.
  const values = figures.map((typed) => {
    if (typed === "") return null;
    return NUMBER.test(typed) ? Number(typed.replace(",", ".")) : Number.NaN;
  });
  if (values.some((value) => Number.isNaN(value) || (value !== null && value > MAX_FIGURE))) {
    return {
      why: `kcal, protein, carbs and fat per 100 g must be numbers from 0 to ${MAX_FIGURE}`,
    };
  }
  const [kcal = null, protein = null, carbs = null, fat = null] = values;
  if (kcal === null) return { why: "kcal per 100 g is needed" };
  return {
    name: cleaned,
    serving_g: grams,
    code: code === "" ? null : code,
    per_100g: { kcal, protein, carbs, fat },
  };
}

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

export function addForm(hooks: AddHooks): AddForm {
  const root = make("div", "cm-log-food-add");
  root.hidden = true;
  /** A field: its input, named by its placeholder and label, and the unit after it. */
  function field(label: string, unit: string, mode: "decimal" | "numeric" | "text") {
    const input = make("input", "cm-log-food-add-input");
    input.type = "text";
    input.inputMode = mode;
    input.placeholder = label.toLowerCase();
    input.setAttribute("aria-label", label);
    const wrap = make("label", "cm-log-food-field");
    wrap.append(input);
    if (unit !== "") wrap.append(make("span", "", unit));
    root.append(wrap);
    return input;
  }
  const name = field("Name", "", "text");
  name.parentElement?.classList.add("cm-log-food-add-wide");
  const serving = field("Serving", "g", "decimal");
  serving.value = "100";
  const code = field("Barcode", "", "numeric");
  // The four figures sit under one heading, since the pack prints them per 100 g.
  root.append(make("div", "cm-log-food-add-heading", "per 100 g"));
  const figures = [
    field("kcal", "kcal", "decimal"),
    field("Protein", "g", "decimal"),
    field("Carbs", "g", "decimal"),
    field("Fat", "g", "decimal"),
  ];
  const save = make("button", "cm-log-food-save", "Save");
  save.type = "button";
  save.setAttribute("aria-label", "Save this food");
  const back = make("button", "cm-log-food-back", "Back");
  back.type = "button";
  const buttons = make("div", "cm-log-food-add-wide cm-log-food-add-buttons");
  buttons.append(save, back);
  root.append(buttons);

  back.addEventListener("click", hooks.back);
  save.addEventListener("click", () => {
    const food = readFood(
      name.value,
      serving.value,
      code.value.trim(),
      figures.map((input) => input.value.trim()),
    );
    if ("why" in food) {
      hooks.say(food.why);
      return;
    }
    save.disabled = true;
    addMyFood(food).then(
      () => {
        save.disabled = false;
        if (!root.isConnected) return;
        hooks.say("");
        hooks.saved(food);
      },
      (error: unknown) => {
        save.disabled = false;
        if (!root.isConnected) return;
        hooks.say(error instanceof Error ? error.message : "The save failed");
      },
    );
  });

  return {
    root,
    open(query, unknown) {
      const typed = query.trim();
      const digits = BARCODE.test(typed);
      name.value = digits ? "" : typed;
      code.value = unknown ?? (digits ? typed : "");
      root.hidden = false;
      name.focus();
    },
  };
}
