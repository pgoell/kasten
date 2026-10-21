/**
 * The drink card under a daily note's title, beside the weather: the day's totals
 * per kind, a button per kind that writes a line under `## Log`, and an undo for
 * the last tap.
 *
 * A tap is one change to the buffer being typed into, so undo, the history and
 * the cursor treat it as typing. Nothing is written beside the note: the totals
 * are read off the open text, the same lines `GET /api/log` adds up.
 */

import { isolateHistory } from "@codemirror/commands";
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { foodPanel } from "@/lib/food-search";
import {
  amountLine,
  DEFAULT_LINE,
  DRINKS,
  type DrinkKind,
  type DrinkTotals,
  drinkTotals,
  LOG_HEADING,
} from "@/lib/log-lines";
import { appendUnderEdit } from "@/lib/note-section";
import { dailyDate } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";
import { cardLine } from "@/lib/weather-card";

/** A line the card wrote: where it starts and what it says, read back to take it out. */
interface LastTap {
  from: number;
  text: string;
}

/** The last tap, or null once it is undone. */
const tapped = StateEffect.define<LastTap | null>();

/** Opens or closes the food search panel. */
const foodOpen = StateEffect.define<boolean>();

interface Card {
  totals: DrinkTotals;
  lastTap: LastTap | null;
  /** Whether the food search panel is open. */
  food: boolean;
  /** Whether this note has a card at all, which the palette asks before it offers the search. */
  shown: boolean;
  decorations: DecorationSet;
}

/** Whether the doc still holds the tapped line whole, where it was written. */
function stillThere(doc: Text, tap: LastTap): boolean {
  if (tap.from > doc.length) return false;
  const line = doc.lineAt(tap.from);
  return line.from === tap.from && line.text === tap.text;
}

/** The totals as the card words them. The grams show only once there are some. */
function totalWords(totals: DrinkTotals): string[] {
  const { water, coffee, alcohol, food } = totals;
  const words = [
    `💧 ${water.ml} ml`,
    `☕ ${coffee.count}`,
    `🍺 ${alcohol.count}${alcohol.grams > 0 ? `, ${alcohol.grams} g` : ""}`,
  ];
  // The food words wait for the first food, as the grams of alcohol wait for a strength.
  if (food.kcal > 0 || food.protein > 0 || food.carbs > 0 || food.fat > 0) {
    words.push(`🔥 ${food.kcal} kcal 🥩 ${food.protein} g 🍞 ${food.carbs} g 🧈 ${food.fat} g`);
  }
  return words;
}

/**
 * A button that keeps the editor's focus and cursor. A press on the card is
 * handled by the card, and CodeMirror must not move the selection for it.
 */
function button(
  words: string,
  label: string,
  className: string,
  press: () => void,
): HTMLButtonElement {
  const made = document.createElement("button");
  made.type = "button";
  made.className = className;
  made.textContent = words;
  made.setAttribute("aria-label", label);
  made.addEventListener("mousedown", (event) => event.preventDefault());
  made.addEventListener("click", press);
  return made;
}

/**
 * Writes `line` at the end of `## Log` as one tap: the card's Undo can take it back,
 * and `effects` go in the same change.
 */
function writeLogLine(view: EditorView, line: string, effects: StateEffect<unknown>[] = []): void {
  const edit = appendUnderEdit(view.state.doc.toString(), LOG_HEADING, line);
  view.dispatch({
    changes: edit,
    // The edit starts where the inserted text does, and a new section's heading comes before the line.
    effects: [tapped.of({ from: edit.from + edit.insert.indexOf(line), text: line }), ...effects],
    userEvent: "input.log",
    // History joins quick adjacent input into one step, so two fast taps, or a
    // tap just after typing, would come back as one `u`.
    annotations: isolateHistory.of("full"),
  });
}

/** Writes the line `amount` makes for `kind` at the end of `## Log`, or says why it cannot. */
function tap(view: EditorView, kind: DrinkKind, amount: HTMLInputElement, why: HTMLElement): void {
  const line = amountLine(kind, amount.value);
  if (typeof line !== "string") {
    why.textContent = line.why;
    return;
  }
  why.textContent = "";
  amount.value = "";
  writeLogLine(view, line);
}

/**
 * Takes the tapped line out with its newline. Nothing happens once the line
 * no longer reads as the card wrote it.
 */
function untap(view: EditorView, tap: LastTap): void {
  const { doc } = view.state;
  if (!stillThere(doc, tap)) return;
  const line = doc.lineAt(tap.from);
  // The last line has no newline after it, so the one before it goes instead.
  const changes =
    line.to < doc.length
      ? { from: line.from, to: line.to + 1 }
      : { from: Math.max(0, line.from - 1), to: line.to };
  view.dispatch({ changes, effects: tapped.of(null), userEvent: "delete.log" });
}

/** Takes back the last tap as the field holds it now, which an edit above it has moved. */
function undoLastTap(view: EditorView): void {
  const last = view.state.field(cardField).lastTap;
  if (last !== null) untap(view, last);
}

/**
 * The card as a widget. Its DOM is kept while its totals and undo stay the same,
 * so a typed amount survives an edit elsewhere in the note.
 */
class LogCard extends WidgetType {
  private readonly totals: DrinkTotals;
  /** The text of the tap Undo takes back, or null where there is none to offer. */
  private readonly undoText: string | null;
  /** Whether the food search panel is drawn under the row. */
  private readonly food: boolean;

  constructor(totals: DrinkTotals, undoText: string | null, food: boolean) {
    super();
    this.totals = totals;
    this.undoText = undoText;
    this.food = food;
  }

  // Only what is drawn is compared. An Undo's position moves with every edit above
  // it, and a rebuild for that would empty the amount field.
  override eq(other: LogCard): boolean {
    return (
      JSON.stringify([this.totals, this.undoText, this.food]) ===
      JSON.stringify([other.totals, other.undoText, other.food])
    );
  }

  override ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-log";
    card.setAttribute("contenteditable", "false");

    const totals = document.createElement("div");
    totals.className = "cm-log-totals";
    for (const words of totalWords(this.totals)) {
      const span = document.createElement("span");
      span.textContent = words;
      totals.appendChild(span);
    }

    const row = document.createElement("div");
    row.className = "cm-log-row";
    const amount = document.createElement("input");
    amount.className = "cm-log-amount";
    amount.placeholder = "amount";
    amount.setAttribute("inputmode", "text");
    amount.setAttribute("aria-label", "Amount");
    const why = document.createElement("div");
    why.className = "cm-log-why";

    for (const kind of DRINKS) {
      const words = `+ ${DEFAULT_LINE[kind].slice(2)}`;
      const press = () => tap(view, kind, amount, why);
      row.appendChild(button(words, `Log ${kind}`, "cm-log-button", press));
    }
    row.appendChild(button("+ 🍽 food", "Log food", "cm-log-button", () => openFoodSearch(view)));
    row.appendChild(amount);
    if (this.undoText !== null) {
      const words = `Undo ${this.undoText.slice(2)}`;
      row.appendChild(button(words, words, "cm-log-undo", () => undoLastTap(view)));
    }
    card.append(totals, row, why);
    if (this.food) {
      card.append(
        foodPanel(view, {
          log: (line) => writeLogLine(view, line, [foodOpen.of(false)]),
          close: () => view.dispatch({ effects: foodOpen.of(false) }),
        }),
      );
    }
    return card;
  }
}

/** What a note with no card is told: nothing logged. Read by no one, so it need not be the note's. */
const NO_TOTALS = drinkTotals("");

/** The card for a note: its totals and widget only on a daily note. */
function build(state: EditorState, lastTap: LastTap | null, food: boolean): Card {
  const path = state.facet(notePath);
  const line = path !== undefined && dailyDate(path) !== null ? cardLine(state.doc) : null;
  if (line === null) {
    return { totals: NO_TOTALS, lastTap, food: false, shown: false, decorations: Decoration.none };
  }
  const totals = drinkTotals(state.doc.toString());
  // Only a tap still on the page can be undone, so an edited one is offered nothing.
  const undo = lastTap !== null && stillThere(state.doc, lastTap) ? lastTap.text : null;
  const widget = new LogCard(totals, undo, food);
  return {
    totals,
    lastTap,
    food,
    shown: true,
    decorations: Decoration.set([
      Decoration.widget({ widget, block: true, side: 2 }).range(state.doc.line(line).to),
    ]),
  };
}

/**
 * The card as an editor extension, a field for the same reason the weather card
 * is one: a block widget changes the height of the document, which CodeMirror
 * takes only from state.
 */
const cardField = StateField.define<Card>({
  create: (state) => build(state, null, false),
  update(value, tr) {
    let lastTap = value.lastTap;
    let food = value.food;
    if (tr.docChanged && lastTap !== null) {
      lastTap = { from: tr.changes.mapPos(lastTap.from), text: lastTap.text };
    }
    let changed = tr.docChanged;
    for (const effect of tr.effects) {
      if (effect.is(tapped)) {
        lastTap = effect.value;
        changed = true;
      }
      if (effect.is(foodOpen)) {
        food = effect.value;
        changed = true;
      }
    }
    return changed ? build(tr.state, lastTap, food) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export const logCard: Extension = cardField;

/** Whether the view shows a card, which only a daily note with one does. */
export function cardShown(view: EditorView): boolean {
  return view.state.field(cardField, false)?.shown === true;
}

/**
 * Opens the food search on the card, and puts the cursor in its query. False,
 * with nothing changed, where the view shows no card.
 */
export function openFoodSearch(view: EditorView): boolean {
  if (!cardShown(view)) return false;
  view.dispatch({ effects: foodOpen.of(true) });
  view.dom.querySelector<HTMLInputElement>(".cm-log-food-query")?.focus();
  return true;
}
