/**
 * The card under a recipe note's title: its facts, kcal and macros per serving, each
 * ingredient line with what it adds, a servings stepper that scales the amounts in the view,
 * never in the note, the last meals cooked, and the way into cook mode.
 * The numbers come from `POST /api/recipe/nutrition`, sent the open buffer after typing pauses.
 */

import type { EditorState, Extension } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type Ingredient, type Recipe, readRecipe } from "@/lib/log/food-api";
import { openCookMode } from "@/lib/log/recipe/cook-mode";
import {
  cookedLine,
  newestFirst,
  recipeFacts,
  scaledLine,
  shown,
} from "@/lib/log/recipe/recipe-steps";
import { cardLine } from "@/lib/notes/note/weather-card";
import { readField } from "@/lib/notes/text/note-frontmatter";

/** How many cooked lines the card lists, newest first. */
export const COOKED_SHOWN = 3;

/** How long typing must pause before the buffer is sent: one request per pause, not per key. */
export const RECIPE_PAUSE_MS = 600;

const WHY: Record<Ingredient["status"], string> = {
  counted: "",
  no_match: "no food matches: add it to foods.md or pin a 🏷 barcode",
  no_amount: "no amount, not counted",
  no_weight: "no weight for one: add a serving in foods.md or (400 g) to the line",
  unreached: "Open Food Facts did not answer; try again in a minute",
};

/** Whether the note's frontmatter says it is a recipe: `type: Recipe`, in any case. */
export function isRecipe(text: string): boolean {
  return readField(text, "type")?.replace(/["']/g, "").toLowerCase() === "recipe";
}

/** The note's head, where its frontmatter is, so a key typed in a long note reads little. */
const HEAD_CHARS = 4000;
function recipeNote(state: EditorState): boolean {
  return isRecipe(state.doc.sliceString(0, HEAD_CHARS));
}

interface Chosen {
  /** What the backend last answered, or null before the first answer. */
  recipe: Recipe | null;
  /** The servings the stepper shows, or null for the note's own number. */
  servings: number | null;
  failed: string | null;
}

const arrived = StateEffect.define<Recipe>();
const failed = StateEffect.define<string>();
const stepped = StateEffect.define<number | null>();

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

function macros(recipe: Recipe): HTMLElement {
  const row = element("div", "cm-recipe-macros");
  const per = recipe.per_serving ?? recipe.total;
  const heading = recipe.per_serving === null ? "Whole recipe" : "Per serving";
  row.append(element("span", "cm-recipe-label", heading));
  const kcal = per.kcal === null ? "–" : shown(per.kcal, 0);
  row.append(element("span", "cm-recipe-kcal", `${kcal} kcal`));
  for (const [name, value] of [
    ["protein", per.protein],
    ["carbs", per.carbs],
    ["fat", per.fat],
  ] as const) {
    row.append(
      element("span", "cm-recipe-macro", `${value === null ? "–" : shown(value)} g ${name}`),
    );
  }
  return row;
}

function facts(recipe: Recipe): HTMLElement | null {
  const said = recipeFacts(recipe, new Date());
  return said.length === 0 ? null : element("div", "cm-recipe-facts", said.join(" · "));
}

function cookedList(recipe: Recipe): HTMLElement | null {
  const shownLines = newestFirst(recipe.cooked).slice(0, COOKED_SHOWN);
  if (shownLines.length === 0) return null;
  const section = element("div", "cm-recipe-cooked");
  section.append(element("div", "cm-recipe-label", "Last cooked"));
  const list = element("ul", "cm-recipe-lines");
  for (const item of shownLines) list.append(element("li", "cm-recipe-note", cookedLine(item)));
  section.append(list);
  return section;
}

/** The note's `# ` title, which cook mode names the dish by. */
function title(state: EditorState): string {
  for (let at = 1; at <= Math.min(state.doc.lines, 200); at++) {
    const found = /^# (.+)/.exec(state.doc.line(at).text);
    if (found?.[1] !== undefined) return found[1].trim();
  }
  return "Recipe";
}

function actions(view: EditorView, recipe: Recipe, servings: number | null): HTMLElement {
  const row = element("div", "cm-recipe-actions");
  const cook = element("button", "cm-recipe-cook", "Cook");
  cook.type = "button";
  cook.disabled = recipe.steps.length === 0;
  if (cook.disabled) cook.title = "Add numbered steps under ## Schritte to cook from them";
  cook.addEventListener("click", () =>
    openCookMode({ title: title(view.state), recipe, servings }),
  );
  row.append(cook);
  return row;
}

function stepper(view: EditorView, recipe: Recipe, servings: number): HTMLElement {
  const row = element("div", "cm-recipe-servings");
  const own = recipe.servings;
  const step = (by: number) => {
    const next = Math.max(1, servings + by);
    view.dispatch({ effects: stepped.of(next === own ? null : next) });
  };
  const less = element("button", "cm-recipe-step", "−");
  less.type = "button";
  less.setAttribute("aria-label", "Fewer servings");
  less.disabled = servings <= 1;
  less.addEventListener("click", () => step(-1));
  const more = element("button", "cm-recipe-step", "+");
  more.type = "button";
  more.setAttribute("aria-label", "More servings");
  more.addEventListener("click", () => step(1));
  const count = element("span", "cm-recipe-count", `${shown(servings, 2)} servings`);
  count.setAttribute("aria-live", "polite");
  row.append(less, count, more);
  if (own !== null && servings !== own) {
    row.append(element("span", "cm-recipe-own", `the note says ${shown(own, 2)}`));
  }
  return row;
}

function ingredientRow(item: Ingredient, factor: number): HTMLElement {
  const row = element("li", `cm-recipe-line cm-recipe-${item.status.replace("_", "-")}`);
  row.append(element("span", "cm-recipe-words", scaledLine(item, factor)));
  const kcal = item.nutrients?.kcal;
  const what =
    item.status === "counted"
      ? `${kcal === null || kcal === undefined ? "–" : shown(kcal * factor, 0)} kcal`
      : WHY[item.status];
  row.append(element("span", "cm-recipe-what", what));
  if (item.match !== null && item.match.name.toLowerCase() !== item.food.toLowerCase()) {
    row.title = `matched to ${item.match.name}`;
  }
  return row;
}

function ingredientList(recipe: Recipe, factor: number): HTMLElement {
  const list = element("ul", "cm-recipe-lines");
  let group: string | null = null;
  for (const item of recipe.ingredients) {
    if (item.group !== null && item.group !== group) {
      list.append(element("li", "cm-recipe-group", item.group));
    }
    group = item.group;
    list.append(ingredientRow(item, factor));
  }
  return list;
}

class RecipeCard extends WidgetType {
  private readonly chosen: Chosen;

  constructor(chosen: Chosen) {
    super();
    this.chosen = chosen;
  }

  override eq(other: RecipeCard): boolean {
    const [a, b] = [this.chosen, other.chosen];
    return a.recipe === b.recipe && a.servings === b.servings && a.failed === b.failed;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = element("div", "cm-recipe");
    card.setAttribute("contenteditable", "false");
    const { recipe, failed: why } = this.chosen;
    if (recipe === null) {
      card.append(element("div", "cm-recipe-wait", why ?? "Working out the numbers…"));
      return card;
    }
    const servings = this.chosen.servings ?? recipe.servings;
    const factor = servings === null || recipe.servings === null ? 1 : servings / recipe.servings;
    const head = facts(recipe);
    if (head !== null) card.append(head);
    card.append(macros(recipe));
    if (servings !== null) card.append(stepper(view, recipe, servings));
    else card.append(element("div", "cm-recipe-own", "Add servings: N to the frontmatter"));
    card.append(ingredientList(recipe, factor));
    const counted = recipe.ingredients.filter((item) => item.status === "counted").length;
    const of = `${counted} of ${recipe.ingredients.length} lines counted`;
    card.append(element("div", "cm-recipe-foot", why === null ? of : `${of}. ${why}`));
    const cooked = cookedList(recipe);
    if (cooked !== null) card.append(cooked);
    card.append(actions(view, recipe, servings));
    return card;
  }
}

interface Card extends Chosen {
  decorations: DecorationSet;
}

function build(state: EditorState, chosen: Chosen): Card {
  const line = recipeNote(state) ? cardLine(state.doc) : null;
  if (line === null) return { ...chosen, decorations: Decoration.none };
  const widget = new RecipeCard(chosen);
  return {
    ...chosen,
    decorations: Decoration.set([
      Decoration.widget({ widget, block: true, side: 1 }).range(state.doc.line(line).to),
    ]),
  };
}

const field = StateField.define<Card>({
  create: (state) => build(state, { recipe: null, servings: null, failed: null }),
  update(value, tr) {
    let next: Chosen = value;
    for (const effect of tr.effects) {
      if (effect.is(arrived)) next = { ...next, recipe: effect.value, failed: null };
      if (effect.is(failed)) next = { ...next, failed: effect.value };
      if (effect.is(stepped)) next = { ...next, servings: effect.value };
    }
    return next !== value || tr.docChanged ? build(tr.state, next) : value;
  },
  provide: (card) => EditorView.decorations.from(card, (value) => value.decorations),
});

/** Sends the buffer once typing pauses, and drops an answer a later request overtook. */
const asker = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | undefined;
    private pending: AbortController | undefined;
    private asked: string | undefined;
    private readonly view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.schedule(0);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.schedule(RECIPE_PAUSE_MS);
    }

    schedule(wait: number): void {
      clearTimeout(this.timer);
      if (!recipeNote(this.view.state)) return;
      this.timer = setTimeout(() => this.ask(), wait);
    }

    ask(): void {
      const text = this.view.state.doc.toString();
      // An edit typed and taken back sends nothing, since the answer would be the same.
      if (text === this.asked) return;
      this.asked = text;
      this.pending?.abort();
      const controller = new AbortController();
      this.pending = controller;
      readRecipe(text, controller.signal).then(
        (recipe) => {
          if (!controller.signal.aborted) this.view.dispatch({ effects: arrived.of(recipe) });
        },
        (error: unknown) => {
          if (controller.signal.aborted) return;
          if (!(error instanceof Error)) throw error;
          this.asked = undefined;
          this.view.dispatch({ effects: failed.of(error.message) });
        },
      );
    }

    destroy(): void {
      clearTimeout(this.timer);
      this.pending?.abort();
    }
  },
);

/** The card as an editor extension: a field for the block widget, a plugin for the requests. */
export const recipeCard: Extension = [field, asker];
