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
import { fetchNote, NoteMissing } from "@/lib/api";
import { foodPanel } from "@/lib/food-search";
import { LOG_NOTE } from "@/lib/layout";
import {
  DEFAULT_CONFIG,
  type FoodField,
  type Goal,
  kindLine,
  kindTotal,
  type LogConfig,
  type LogKind,
  parseConfig,
  tapLine,
} from "@/lib/log-kinds";
import { type DrinkTotals, drinkTotals, LOG_HEADING } from "@/lib/log-lines";
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

/** The note's config arriving, which replaces the default kinds the card drew until then. */
const configArrived = StateEffect.define<LogConfig>();

/** Each view's config, fetched once, so a card drawn again does not ask the note again. */
const configs = new WeakMap<EditorView, Promise<LogConfig>>();

/**
 * The view's config from the log note. A note that is not there is the default
 * config, and one that fails to load is named in the console and the default too.
 */
function configFor(view: EditorView): Promise<LogConfig> {
  let config = configs.get(view);
  if (config === undefined) {
    config = fetchNote(LOG_NOTE).then(parseConfig, (error: unknown) => {
      if (error instanceof NoteMissing) return parseConfig(null);
      if (!(error instanceof Error)) throw error;
      console.warn(error.message);
      return parseConfig(null);
    });
    configs.set(view, config);
  }
  return config;
}

/** The food search panel of each view while it is open, reused by every card drawn meanwhile. */
const openPanels = new WeakMap<EditorView, HTMLElement>();

interface Card {
  totals: DrinkTotals;
  lastTap: LastTap | null;
  /** Whether the food search panel is open. */
  food: boolean;
  /** The note's config, or null while it is on its way and the defaults are drawn. */
  config: LogConfig | null;
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

/**
 * A total as its span. A goal goes after the total, and a floor's span carries the
 * share of the goal reached as the bar the CSS draws; the words say whether it is
 * met or passed, so the colour is not the only sign.
 */
function totalSpan(
  head: string,
  tail: string,
  total: number,
  goal: Goal | undefined,
): HTMLSpanElement {
  const span = document.createElement("span");
  if (goal === undefined) {
    span.textContent = `${head}${tail}`;
    return span;
  }
  span.classList.add("cm-log-goal");
  const words = `${head} / ${goal.value}${tail}`;
  if (goal.type === "floor") {
    const met = total >= goal.value;
    span.classList.add(met ? "cm-log-met" : "cm-log-short");
    const progress = Math.min(100, Math.round((total / goal.value) * 100));
    span.setAttribute("style", `--log-progress: ${progress}%`);
    span.textContent = met ? `${words} ✓` : words;
  } else {
    const over = total > goal.value;
    span.classList.add(over ? "cm-log-over" : "cm-log-under");
    span.textContent = over ? `${words} ⚠` : words;
  }
  return span;
}

/** The food fields in the order the card shows them, each with its marker and unit. */
const FOOD_WORDS: { field: FoodField; mark: string; unit: string }[] = [
  { field: "kcal", mark: "🔥", unit: "kcal" },
  { field: "protein", mark: "🥩", unit: "g" },
  { field: "carbs", mark: "🍞", unit: "g" },
  { field: "fat", mark: "🧈", unit: "g" },
];

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
  keepPanelFocus(view, () =>
    view.dispatch({
      changes: edit,
      // The edit starts where the inserted text does, and a new section's heading comes before the line.
      effects: [tapped.of({ from: edit.from + edit.insert.indexOf(line), text: line }), ...effects],
      userEvent: "input.log",
      // History joins quick adjacent input into one step, so two fast taps, or a
      // tap just after typing, would come back as one `u`.
      annotations: isolateHistory.of("full"),
    }),
  );
}

/**
 * Runs `change`, then gives the focus back to the open panel's element that held it.
 * A card drawn anew moves the panel into itself, and a move drops the focus, so a
 * tap would blur the query. Once `change` returns, the card is in the page.
 */
function keepPanelFocus(view: EditorView, change: () => void): void {
  const held = document.activeElement;
  const panel = openPanels.get(view);
  const kept =
    panel !== undefined && held instanceof HTMLElement && panel.contains(held) ? held : null;
  change();
  // A focus scrolls the note to show what it lands on. A tap keeps the note where it
  // was (#814): the card is where the user is looking, and Firefox scrolls on these
  // focuses where Chrome does not.
  kept?.focus({ preventScroll: true });
}

/** Writes the line `amount` makes for `kind` at the end of `## Log`, or says why it cannot. */
function tap(view: EditorView, kind: LogKind, amount: HTMLInputElement, why: HTMLElement): void {
  const line = kindLine(kind, amount.value);
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
  /** What each kind of the config adds up to, in the config's order. */
  private readonly sums: number[];
  /** The text of the tap Undo takes back, or null where there is none to offer. */
  private readonly undoText: string | null;
  /** Whether the food search panel is drawn under the row. */
  private readonly food: boolean;
  /** The note's config, or null while it is being fetched. */
  private readonly config: LogConfig | null;

  constructor(
    totals: DrinkTotals,
    sums: number[],
    undoText: string | null,
    food: boolean,
    config: LogConfig | null,
  ) {
    super();
    this.totals = totals;
    this.sums = sums;
    this.undoText = undoText;
    this.food = food;
    this.config = config;
  }

  // Only what is drawn is compared. An Undo's position moves with every edit above
  // it, and a rebuild for that would empty the amount field. The config is compared as
  // drawn: a null one draws the defaults, so an arrival of the defaults redraws nothing.
  override eq(other: LogCard): boolean {
    return (
      JSON.stringify([this.totals, this.sums, this.undoText, this.food, this.drawnConfig()]) ===
      JSON.stringify([other.totals, other.sums, other.undoText, other.food, other.drawnConfig()])
    );
  }

  private drawnConfig(): LogConfig {
    return this.config ?? DEFAULT_CONFIG;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = document.createElement("div");
    card.className = "cm-log";
    card.setAttribute("contenteditable", "false");
    const config = this.config ?? DEFAULT_CONFIG;

    const totals = document.createElement("div");
    totals.className = "cm-log-totals";
    config.kinds.forEach((kind, index) => {
      const total = this.sums[index] ?? 0;
      // Alcohol's grams follow its count, once there are some.
      const grams =
        kind.builtin === "alcohol" && this.totals.alcohol.grams > 0
          ? `, ${this.totals.alcohol.grams} g`
          : "";
      // The water total is millilitres whatever unit its config line writes.
      const unit = kind.builtin === "water" ? "ml" : kind.unit;
      const tail = `${unit ? ` ${unit}` : ""}${grams}`;
      totals.appendChild(totalSpan(`${kind.mark} ${total}`, tail, total, kind.goal));
    });
    // Food with a goal shows each field, and the food words wait for the first food otherwise.
    const food = this.totals.food;
    const foodGoal = config.food;
    if (FOOD_WORDS.some(({ field }) => foodGoal[field] !== undefined)) {
      for (const { field, mark, unit } of FOOD_WORDS) {
        totals.appendChild(
          totalSpan(`${mark} ${food[field]}`, ` ${unit}`, food[field], foodGoal[field]),
        );
      }
    } else if (food.kcal > 0 || food.protein > 0 || food.carbs > 0 || food.fat > 0) {
      const span = document.createElement("span");
      span.textContent = `🔥 ${food.kcal} kcal 🥩 ${food.protein} g 🍞 ${food.carbs} g 🧈 ${food.fat} g`;
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

    for (const kind of config.kinds) {
      const words = `+ ${tapLine(kind).slice(2)}`;
      const press = () => tap(view, kind, amount, why);
      row.appendChild(button(words, `Log ${kind.name}`, "cm-log-button", press));
    }
    row.appendChild(button("+ 🍽 food", "Log food", "cm-log-button", () => openFoodSearch(view)));
    row.appendChild(amount);
    if (this.undoText !== null) {
      const words = `Undo ${this.undoText.slice(2)}`;
      row.appendChild(button(words, words, "cm-log-undo", () => undoLastTap(view)));
    }
    card.append(totals, row, why);
    // A line the config could not read is named, so its kind is not missing for no reason.
    if (config.broken.length > 0) {
      const broken = document.createElement("div");
      broken.className = "cm-log-broken";
      for (const { line, text } of config.broken) {
        const named = document.createElement("div");
        named.textContent = `Skipped line ${line} of log.md: ${text}`;
        broken.appendChild(named);
      }
      card.appendChild(broken);
    }
    // The open panel is kept per view: a rebuild of the card for a tap or a reload
    // would otherwise empty its query, its chosen serving and its focus.
    if (this.food) {
      let panel = openPanels.get(view);
      if (panel === undefined) {
        const path = view.state.facet(notePath);
        panel = foodPanel(path === undefined ? null : dailyDate(path), {
          log: (line) => writeLogLine(view, line, [foodOpen.of(false)]),
          close: () => view.dispatch({ effects: foodOpen.of(false) }),
        });
        openPanels.set(view, panel);
      }
      card.append(panel);
    } else {
      openPanels.delete(view);
    }
    if (this.config === null) {
      // Gone from the page means the note was closed while the fetch was out, and there is nothing to draw into.
      // A drawn card moves the open food panel, so the focus in it is given back as for a tap.
      configFor(view).then((arrived) => {
        if (!card.isConnected) return;
        // A redraw makes a new amount field, so the typed text and the focus are carried over.
        const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
        const typed = field?.value ?? "";
        const focused = field !== null && document.activeElement === field;
        keepPanelFocus(view, () => view.dispatch({ effects: configArrived.of(arrived) }));
        const next = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
        if (next !== null) {
          next.value = typed;
          if (focused) next.focus({ preventScroll: true });
        }
      });
    }
    return card;
  }
}

/** What a note with no card is told: nothing logged. Read by no one, so it need not be the note's. */
const NO_TOTALS = drinkTotals("");

/** The card for a note: its totals and widget only on a daily note. */
function build(
  state: EditorState,
  lastTap: LastTap | null,
  food: boolean,
  config: LogConfig | null,
): Card {
  const path = state.facet(notePath);
  const line = path !== undefined && dailyDate(path) !== null ? cardLine(state.doc) : null;
  if (line === null) {
    return {
      totals: NO_TOTALS,
      lastTap,
      food: false,
      config,
      shown: false,
      decorations: Decoration.none,
    };
  }
  const text = state.doc.toString();
  const totals = drinkTotals(text);
  const sums = (config ?? DEFAULT_CONFIG).kinds.map((kind) => kindTotal(kind, text, totals));
  // Only a tap still on the page can be undone, so an edited one is offered nothing.
  const undo = lastTap !== null && stillThere(state.doc, lastTap) ? lastTap.text : null;
  const widget = new LogCard(totals, sums, undo, food, config);
  return {
    totals,
    lastTap,
    food,
    config,
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
  create: (state) => build(state, null, false, null),
  update(value, tr) {
    let lastTap = value.lastTap;
    let food = value.food;
    let config = value.config;
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
      if (effect.is(configArrived)) {
        config = effect.value;
        changed = true;
      }
    }
    return changed ? build(tr.state, lastTap, food, config) : value;
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
  const focusQuery = () =>
    view.dom.querySelector<HTMLInputElement>(".cm-log-food-query")?.focus({ preventScroll: true });
  focusQuery();
  // The palette hands its focus back to the editor when it closes, and it closes
  // after this call returns. A microtask runs after that close, so the query keeps it.
  queueMicrotask(focusQuery);
  return true;
}
