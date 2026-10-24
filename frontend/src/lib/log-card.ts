/**
 * The Log card under a daily note's title, beside the weather: the kcal left today,
 * the macros as rings, a button per kind that writes a line under `## Log`, the
 * day's food by meal, and an undo for the last tap. The food search is a sheet
 * the card shows over the page, from `food-sheet.tsx`.
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
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { foodSheetCleanup } from "@/components/food-sheet";
import { shiftDay } from "@/lib/clock";
import { type SheetHooks, stopFoodSheet, syncFoodSheet } from "@/lib/log-card-food";
import { button, foodButton, mealBlock, quickButton, rawFold, topBlock } from "@/lib/log-card-view";
import {
  askYesterday,
  type Copy,
  copiesFor,
  forgetYesterday,
  type Yesterday,
  yesterdayArrived,
} from "@/lib/log-card-yesterday";
import { askLogConfig, logConfig, subscribeLogConfig } from "@/lib/log-config";
import { foodEntries, groupByMeal, type MealGroup } from "@/lib/log-day";
import { DEFAULT_CONFIG, kindLine, kindTotal, type LogConfig, type LogKind } from "@/lib/log-kinds";
import { type DrinkTotals, drinkTotals, LOG_HEADING, logLines } from "@/lib/log-lines";
import { appendUnderEdit } from "@/lib/note-section";
import { dailyDate } from "@/lib/periodic";
import { notePath } from "@/lib/todo-commands";
import { cardLine } from "@/lib/weather-card";

/**
 * A line or lines the card wrote: where they start and what they say, read back to
 * take them out. Several lines are one tap when a meal's lines are copied from yesterday.
 */
interface LastTap {
  from: number;
  text: string;
}

/** The last tap, or null once it is undone. */
const tapped = StateEffect.define<LastTap | null>();

/** Opens or closes the food search sheet. */
const foodOpen = StateEffect.define<boolean>();

/** The store's config, pushed to each card when the store draws an answer that replaces the defaults. */
const configArrived = StateEffect.define<LogConfig>();

interface Card {
  totals: DrinkTotals;
  lastTap: LastTap | null;
  /** Whether the food search sheet is open. */
  food: boolean;
  /** The store's config when this was drawn, or null before its first answer, when the defaults are drawn. */
  config: LogConfig | null;
  /** Yesterday's answer as it stands, which the card uses only when it is for yesterday. */
  yesterday: Yesterday | null;
  /** Whether this note has a card at all, which the palette asks before it offers the search. */
  shown: boolean;
  decorations: DecorationSet;
}

/** Whether the doc still holds the tapped text whole, where it was written, and ends its line. */
function stillThere(doc: Text, tap: LastTap): boolean {
  const end = tap.from + tap.text.length;
  if (end > doc.length || doc.lineAt(tap.from).from !== tap.from) return false;
  if (doc.sliceString(tap.from, end) !== tap.text) return false;
  return end === doc.length || doc.sliceString(end, end + 1) === "\n";
}

/** The day a daily note is for, or null for any other note. */
function noteDay(state: EditorState): string | null {
  const path = state.facet(notePath);
  return path === undefined ? null : dailyDate(path);
}

/** The words of the tap Undo takes back: its line, or how many lines a copy wrote. */
function undoWords(text: string): string {
  return text.includes("\n") ? `Undo ${text.split("\n").length} lines` : `Undo ${text.slice(2)}`;
}

/** The unit and grams an entry of a kind shows after its total. */
function tailOf(kind: LogKind, totals: DrinkTotals): string {
  // Alcohol's grams follow its count, once there are some.
  const grams =
    kind.builtin === "alcohol" && totals.alcohol.grams > 0 ? `, ${totals.alcohol.grams} g` : "";
  // The water total is millilitres whatever unit its config line writes.
  const unit = kind.builtin === "water" ? "ml" : kind.unit;
  return `${unit ? ` ${unit}` : ""}${grams}`;
}

/**
 * Writes `text`, one or more lines, at the end of `## Log` as one tap: the card's
 * Undo can take it back, and `effects` go in the same change.
 */
function writeLogLine(view: EditorView, text: string, effects: StateEffect<unknown>[] = []): void {
  const edit = appendUnderEdit(view.state.doc.toString(), LOG_HEADING, text);
  view.dispatch({
    changes: edit,
    // The edit starts where the inserted text does, and a new section's heading comes before the line.
    effects: [tapped.of({ from: edit.from + edit.insert.indexOf(text), text }), ...effects],
    userEvent: "input.log",
    // History joins quick adjacent input into one step, so two fast taps, or a
    // tap just after typing, would come back as one `u`.
    annotations: isolateHistory.of("full"),
  });
}

/**
 * Focuses `element` and shows it the least way. The browser's own scroll on a focus
 * differs by browser (Firefox jumped the note on a tap, #814), so the focus does not
 * scroll, and `nearest` moves the note only when the element is out of view, and only
 * as far as it takes to show it, the same in every browser.
 */
function focusInPlace(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest" });
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
 * Takes the tapped lines out with a newline. Nothing happens once the text
 * no longer reads as the card wrote it.
 */
function untap(view: EditorView, tap: LastTap): void {
  const { doc } = view.state;
  if (!stillThere(doc, tap)) return;
  const end = tap.from + tap.text.length;
  // The text ends its last line, so the newline after it goes. Where it runs to the end of
  // the doc, there is no newline after it, so the one before it goes instead.
  const changes =
    end < doc.length
      ? { from: tap.from, to: end + 1 }
      : { from: Math.max(0, tap.from - 1), to: end };
  view.dispatch({ changes, effects: tapped.of(null), userEvent: "delete.log" });
}

/** Takes back the last tap as the field holds it now, which an edit above it has moved. */
function undoLastTap(view: EditorView): void {
  const last = view.state.field(cardField).lastTap;
  if (last !== null) untap(view, last);
}

/** Whether each view's raw-lines fold is open, kept across the redraws a tap makes. */
const rawOpen = new WeakMap<EditorView, boolean>();

/** What a card draws, as plain data: two draws of the same data are the same DOM. */
interface Drawn {
  totals: DrinkTotals;
  /** What each kind of the config adds up to, in the config's order. */
  sums: number[];
  /** The text of the tap Undo takes back, or null where there is none to offer. */
  undo: string | null;
  config: LogConfig;
  groups: MealGroup[];
  copies: Copy[];
  /** The lines under `## Log`, as the doc holds them. */
  raw: string[];
}

/**
 * The card as a widget. Its DOM is kept while what it draws stays the same, so a
 * typed amount survives an edit elsewhere in the note.
 */
class LogCard extends WidgetType {
  private readonly drawn: Drawn;
  /** The store's config when this was drawn, or null before its first answer. */
  private readonly config: LogConfig | null;

  constructor(drawn: Drawn, config: LogConfig | null) {
    super();
    this.drawn = drawn;
    this.config = config;
  }

  // Only what is drawn is compared. An Undo's position moves with every edit above
  // it, and a rebuild for that would empty the amount field. The config is compared as
  // drawn: a null one draws the defaults, so an arrival of the defaults redraws nothing.
  override eq(other: LogCard): boolean {
    return JSON.stringify(this.drawn) === JSON.stringify(other.drawn);
  }

  override ignoreEvent(): boolean {
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const { totals, sums, undo, config, groups, copies, raw } = this.drawn;
    const card = document.createElement("div");
    card.className = "cm-log";
    card.setAttribute("contenteditable", "false");
    card.append(topBlock(totals.food, config.food));

    const amount = document.createElement("input");
    amount.className = "cm-log-amount";
    amount.placeholder = "amount";
    amount.setAttribute("inputmode", "text");
    amount.setAttribute("aria-label", "Amount");
    const why = document.createElement("div");
    why.className = "cm-log-why";

    const quick = document.createElement("div");
    quick.className = "cm-log-totals";
    config.kinds.forEach((kind, index) => {
      const press = () => tap(view, kind, amount, why);
      const total = sums[index] ?? 0;
      quick.append(quickButton(kind, total, tailOf(kind, totals), press));
    });

    const row = document.createElement("div");
    row.className = "cm-log-row";
    row.append(
      foodButton(() => openFoodSearch(view)),
      amount,
    );
    if (undo !== null) {
      const words = undoWords(undo);
      row.append(button(words, words, "cm-log-undo", () => undoLastTap(view)));
    }
    card.append(quick, row, why);

    const meals = document.createElement("div");
    meals.className = "cm-log-meals";
    for (const group of groups) {
      const copy = copies.find((offered) => offered.meal === group.meal);
      const offer =
        copy === undefined
          ? null
          : { lines: copy.lines.length, press: () => writeLogLine(view, copy.lines.join("\n")) };
      const block = mealBlock(group, offer);
      if (block !== null) meals.append(block);
    }
    card.append(meals);

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
    card.append(rawFold(raw, rawOpen.get(view) === true, (open) => rawOpen.set(view, open)));
    // Only a drawn card asks for the config, so a note with no card reads log.md for nothing.
    if (this.config === null) askLogConfig();
    return card;
  }
}

/**
 * Draws the config in the view's card. A redraw makes a new amount field, so the
 * typed text and the focus are carried over.
 */
function applyConfig(view: EditorView, config: LogConfig): void {
  const field = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  const typed = field?.value ?? "";
  const focused = field !== null && document.activeElement === field;
  view.dispatch({ effects: configArrived.of(config) });
  const next = view.dom.querySelector<HTMLInputElement>(".cm-log-amount");
  if (next !== null) {
    next.value = typed;
    if (focused) next.focus({ preventScroll: true });
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
  yesterday: Yesterday | null,
): Card {
  const day = noteDay(state);
  const line = day !== null ? cardLine(state.doc) : null;
  if (day === null || line === null) {
    return {
      totals: NO_TOTALS,
      lastTap,
      food: false,
      config,
      yesterday,
      shown: false,
      decorations: Decoration.none,
    };
  }
  const text = state.doc.toString();
  const totals = drinkTotals(text);
  const drawn = config ?? DEFAULT_CONFIG;
  const sums = drawn.kinds.map((kind) => kindTotal(kind, text, totals));
  // Only a tap still on the page can be undone, so an edited one is offered nothing.
  const undo = lastTap !== null && stillThere(state.doc, lastTap) ? lastTap.text : null;
  const groups = groupByMeal(foodEntries(text));
  const widget = new LogCard(
    {
      totals,
      sums,
      undo,
      config: drawn,
      groups,
      copies: copiesFor(day, yesterday, groups),
      raw: logLines(text),
    },
    config,
  );
  return {
    totals,
    lastTap,
    food,
    config,
    yesterday,
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
  create: (state) => build(state, null, false, logConfig(), null),
  update(value, tr) {
    let lastTap = value.lastTap;
    let food = value.food;
    let config = value.config;
    let yesterday = value.yesterday;
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
      // An answer for a day the note no longer comes after is dropped, and the one held stays.
      const day = noteDay(tr.state);
      if (effect.is(yesterdayArrived) && day !== null && effect.value.day === shiftDay(day, -1)) {
        yesterday = effect.value;
        changed = true;
      }
    }
    return changed ? build(tr.state, lastTap, food, config, yesterday) : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Asks for yesterday's lines while the card shows and holds no answer for its day. Run
 * when the plugin is built and on every update, so a card that shows later asks too.
 */
function askForCard(view: EditorView): void {
  const field = view.state.field(cardField, false);
  const day = noteDay(view.state);
  if (field?.shown !== true || day === null) return;
  if (field.yesterday?.day === shiftDay(day, -1)) return;
  askYesterday(view, day);
}

/**
 * Each card is drawn again whenever the store draws an answer, so it shows log.md as
 * it is now. The food sheet is shown and hidden as the card's `food` flag changes.
 */
const registry = ViewPlugin.define((view) => {
  const unsubscribe = subscribeLogConfig(() => {
    const current = logConfig();
    if (current !== null) applyConfig(view, current);
  });

  askForCard(view);

  return {
    update(update) {
      askForCard(update.view);
      // A flag changed by a transaction nobody called `syncSheet` for is still shown.
      // Deferred: the sheet is DOM, and a sheet mounted inside an update is not measured with it.
      const was = update.startState.field(cardField, false)?.food;
      if (was !== update.state.field(cardField, false)?.food) {
        queueMicrotask(() => syncSheet(view));
      }
    },
    destroy() {
      unsubscribe();
      stopFoodSheet(view);
      forgetYesterday(view);
    },
  };
});

/** The card's side of the food sheet: the line it writes, the close, and the day's food it reads. */
function sheetHooks(view: EditorView): SheetHooks {
  return {
    log: (line) => {
      writeLogLine(view, line, [foodOpen.of(false)]);
      syncSheet(view);
    },
    close: () => closeFood(view),
    today: () => ({
      eaten: drinkTotals(view.state.doc.toString()).food,
      goals: (view.state.field(cardField).config ?? DEFAULT_CONFIG).food,
    }),
  };
}

/**
 * Shows the sheet when the card's `food` flag is open, and takes it down when it is shut.
 * Called after a dispatch returns, so the query is in the page when the press returns.
 */
function syncSheet(view: EditorView): void {
  const open = view.state.field(cardField, false)?.food === true;
  syncFoodSheet(view, open, sheetHooks(view));
}

/** Shuts the food sheet, writing nothing, and takes it down at once. */
function closeFood(view: EditorView): void {
  view.dispatch({ effects: foodOpen.of(false) });
  syncSheet(view);
}

export const logCard: Extension = [cardField, registry, foodSheetCleanup];

export { reloadLogConfig } from "@/lib/log-config";

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
  // The sheet is shown here, after the dispatch, so its query is in the page when this returns.
  syncSheet(view);
  const focusQuery = () => {
    const query = view.dom.querySelector<HTMLInputElement>(".cm-log-food-query");
    if (query !== null) focusInPlace(query);
  };
  focusQuery();
  // The palette hands its focus back to the editor when it closes, and it closes
  // after this call returns. A microtask runs after that close, so the query keeps it.
  queueMicrotask(focusQuery);
  return true;
}
