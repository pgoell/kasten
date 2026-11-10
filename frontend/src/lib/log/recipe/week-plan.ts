/**
 * The card under a week plan's title: days by lunch and dinner, cooked meals filled, meals from a
 * batch tinted, each batch a band down its days with the servings left, training days marked,
 * and the button that writes the cooked batches' ingredients into `Einkauf.md`.
 * The layout comes from `POST /api/meal-plan`, sent the open buffer after typing pauses.
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
import { RECIPE_PAUSE_MS } from "@/lib/log/recipe/recipe-card";
import {
  bandText,
  cellText,
  DAY_NAMES,
  freezeWarning,
  isMealPlan,
  lanes,
  type MealPlan,
  type PlannedMeal,
  readMealPlan,
  trainingProtein,
  weekTitle,
  writeShopping,
} from "@/lib/log/recipe/week-plan-data";
import { cardLine } from "@/lib/notes/note/weather-card";

const HEAD_CHARS = 4000;
function planNote(state: EditorState): boolean {
  return isMealPlan(state.doc.sliceString(0, HEAD_CHARS));
}

interface Shown {
  plan: MealPlan | null;
  failed: string | null;
  /** What the last press of the shopping button said. */
  said: string | null;
}

const arrived = StateEffect.define<MealPlan>();
const failed = StateEffect.define<string>();
const told = StateEffect.define<string>();

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

function place(cell: HTMLElement, row: number, column: number | string): HTMLElement {
  cell.style.gridRow = String(row);
  cell.style.gridColumn = String(column);
  return cell;
}

function mealCell(meal: PlannedMeal | undefined): HTMLElement {
  if (meal === undefined) return element("div", "cm-plan-meal cm-plan-empty", "–");
  const cell = element("div", `cm-plan-meal cm-plan-${meal.kind}`);
  cell.append(element("span", "cm-plan-dish", cellText(meal)));
  if (meal.kind === "cook" && meal.cook !== null) {
    cell.append(element("span", "cm-plan-who", meal.cook));
  }
  if (meal.freeze) {
    cell.classList.add("cm-plan-late");
    cell.title = `Tag ${meal.fridge_day} im Kühlschrank: einfrieren?`;
  }
  return cell;
}

function dayCell(plan: MealPlan, day: number): HTMLElement {
  const cell = element("div", "cm-plan-day");
  const date = plan.days[day]?.date;
  cell.append(element("span", "cm-plan-dayname", DAY_NAMES[day]));
  if (date) cell.append(element("span", "cm-plan-date", `${Number(date.slice(8))}.`));
  if (plan.days[day]?.training) cell.append(element("span", "cm-plan-training", "Training"));
  return cell;
}

function grid(plan: MealPlan): HTMLElement {
  const { lane, count } = lanes(plan);
  const table = element("div", "cm-plan-grid");
  table.style.gridTemplateColumns = `auto repeat(2, minmax(0, 1fr)) repeat(${count}, minmax(4.5rem, 0.8fr))`;
  table.append(place(element("div", "cm-plan-label", "Mittag"), 1, 2));
  table.append(place(element("div", "cm-plan-label", "Abend"), 1, 3));
  table.append(place(element("div", "cm-plan-label", "Batches"), 1, `4 / span ${count}`));
  for (let day = 0; day < 7; day++) {
    const at = (slot: string) => plan.meals.find((m) => m.day === day && m.slot === slot);
    table.append(place(dayCell(plan, day), day + 2, 1));
    table.append(place(mealCell(at("lunch")), day + 2, 2));
    table.append(place(mealCell(at("dinner")), day + 2, 3));
  }
  plan.batches.forEach((batch, index) => {
    const band = element("div", `cm-plan-band cm-plan-band-${batch.state}`);
    band.append(element("span", "cm-plan-dish", batch.recipe));
    band.append(element("span", "cm-plan-left", bandText(batch)));
    const warning = freezeWarning(index, plan.meals);
    if (warning !== null) band.append(element("span", "cm-plan-warn", warning));
    if (batch.left !== null && batch.left < 0) band.classList.add("cm-plan-short");
    band.style.gridRow = `${batch.first_day + 2} / ${batch.last_day + 3}`;
    band.style.gridColumn = String(4 + (lane[index] ?? 0));
    table.append(band);
  });
  return table;
}

function shoppingButton(view: EditorView, plan: MealPlan, said: string | null): HTMLElement {
  const row = element("div", "cm-plan-actions");
  const button = element("button", "cm-plan-shop", `${plan.ingredients} in den Einkauf`);
  button.type = "button";
  button.disabled = plan.ingredients === 0;
  if (button.disabled) button.title = "Plane ein Gericht mit cook [[Rezept]] xN";
  button.addEventListener("click", () => {
    button.disabled = true;
    writeShopping(view.state.doc.toString()).then(
      (done) => {
        const parts = [`${done.added} neu`, `${done.merged} ergänzt`];
        if (done.skipped > 0) parts.push(`${done.skipped} schon da`);
        view.dispatch({ effects: told.of(`Einkauf: ${parts.join(", ")}`) });
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        view.dispatch({ effects: told.of(error.message) });
      },
    );
  });
  row.append(button);
  if (said !== null) row.append(element("span", "cm-plan-said", said));
  return row;
}

class PlanCard extends WidgetType {
  private readonly shown: Shown;

  constructor(shown: Shown) {
    super();
    this.shown = shown;
  }

  override eq(other: PlanCard): boolean {
    const [a, b] = [this.shown, other.shown];
    return a.plan === b.plan && a.failed === b.failed && a.said === b.said;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = element("div", "cm-plan");
    card.setAttribute("contenteditable", "false");
    const { plan, failed: why, said } = this.shown;
    if (plan === null) {
      card.append(element("div", "cm-plan-wait", why ?? "Lege die Woche aus…"));
      return card;
    }
    card.append(element("div", "cm-plan-week", weekTitle(plan)));
    card.append(grid(plan));
    const protein = trainingProtein(plan);
    if (protein !== null) {
      const row = element("div", "cm-plan-protein");
      row.append(element("span", "", "Protein an Trainingstagen"));
      row.append(element("span", "cm-plan-grams", protein));
      card.append(row);
    }
    if (why !== null) card.append(element("div", "cm-plan-wait", why));
    card.append(shoppingButton(view, plan, said));
    return card;
  }
}

interface Card extends Shown {
  decorations: DecorationSet;
}

function build(state: EditorState, shown: Shown): Card {
  const line = planNote(state) ? cardLine(state.doc) : null;
  if (line === null) return { ...shown, decorations: Decoration.none };
  return {
    ...shown,
    decorations: Decoration.set([
      Decoration.widget({ widget: new PlanCard(shown), block: true, side: 1 }).range(
        state.doc.line(line).to,
      ),
    ]),
  };
}

const field = StateField.define<Card>({
  create: (state) => build(state, { plan: null, failed: null, said: null }),
  update(value, tr) {
    let next: Shown = value;
    for (const effect of tr.effects) {
      if (effect.is(arrived)) next = { ...next, plan: effect.value, failed: null };
      if (effect.is(failed)) next = { ...next, failed: effect.value };
      if (effect.is(told)) next = { ...next, said: effect.value };
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
      if (!planNote(this.view.state)) return;
      this.timer = setTimeout(() => this.ask(), wait);
    }

    ask(): void {
      const text = this.view.state.doc.toString();
      if (text === this.asked) return;
      this.asked = text;
      this.pending?.abort();
      const controller = new AbortController();
      this.pending = controller;
      readMealPlan(text, controller.signal).then(
        (plan) => {
          if (!controller.signal.aborted) this.view.dispatch({ effects: arrived.of(plan) });
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
export const weekPlanCard: Extension = [field, asker];
