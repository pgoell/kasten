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
import {
  askLatest,
  earlierWords,
  forgetLatest,
  type Latest,
  latestArrived,
} from "@/lib/log-card-latest";
import {
  button,
  focusInPlace,
  foodButton,
  mealBlock,
  quickButton,
  rawFold,
  tailOf,
  topBlock,
  undoWords,
} from "@/lib/log-card-view";
import {
  askFor,
  asking,
  askPlaceholder,
  askWords,
  focusAmount,
  keepingField,
} from "@/lib/log-card-weight";
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

/** What the card holds between draws, each set by a press or an answer. */
interface Held {
  lastTap: LastTap | null;
  /** Whether the food search sheet is open. */
  food: boolean;
  /** The store's config when this was drawn, or null before its first answer, when the defaults are drawn. */
  config: LogConfig | null;
  /** Yesterday's answer as it stands, which the card uses only when it is for yesterday. */
  yesterday: Yesterday | null;
  /** The latest values before the note's day, which the card uses only when it is for this day. */
  latest: Latest | null;
  /** The mark of the last kind the card asks a number for, or null. */
  ask: string | null;
}

interface Card extends Held {
  totals: DrinkTotals;
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
 * Writes the line `amount` makes for `kind` at the end of `## Log`, or says why it
 * cannot. A last kind with no number asks for one, and Enter in the field is a press.
 */
function tap(view: EditorView, kind: LogKind, amount: HTMLInputElement): void {
  const line = kindLine(kind, amount.value);
  if (typeof line === "string") {
    amount.value = "";
    writeLogLine(view, line);
  } else if (line.ask === true) {
    askFor(view, kind.mark);
  } else {
    refuse(view, line.why);
  }
}

/**
 * Says why an amount is no amount of its kind. A question the card asks is taken
 * back first, since that redraws the card and the line goes in the new one.
 */
function refuse(view: EditorView, why: string): void {
  if (view.state.field(cardField).ask !== null) keepingField(view, asking.of(null));
  const element = view.dom.querySelector<HTMLElement>(".cm-log-why");
  if (element !== null) element.textContent = why;
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
  /** What each kind of the config adds up to, in the config's order; null for a last kind with no line that day. */
  sums: (number | null)[];
  /** The words a last kind's button shows on a day with no value, where the read has an earlier one. */
  words: (string | undefined)[];
  /** The mark of the kind the card asks a number for, or null. */
  ask: string | null;
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
    const { totals, sums, words, ask, undo, config, groups, copies, raw } = this.drawn;
    const card = document.createElement("div");
    card.className = "cm-log";
    card.setAttribute("contenteditable", "false");
    card.append(topBlock(totals.food, config.food));

    const asked =
      ask === null
        ? undefined
        : config.kinds.find((kind) => kind.mark === ask && kind.last === true);
    const amount = document.createElement("input");
    amount.className = "cm-log-amount";
    amount.placeholder = asked === undefined ? "amount" : askPlaceholder(asked);
    amount.setAttribute("inputmode", asked === undefined ? "text" : "decimal");
    amount.setAttribute("aria-label", "Amount");
    // Enter never reaches vim or CodeMirror. While a kind asks, it writes that kind's line.
    amount.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      if (asked !== undefined) tap(view, asked, amount);
    });
    const why = document.createElement("div");
    // A question is drawn in the muted colour, and only a refused amount in the warn colour.
    why.className = asked === undefined ? "cm-log-why" : "cm-log-why cm-log-ask";
    if (asked !== undefined) why.textContent = askWords(asked);

    const quick = document.createElement("div");
    quick.className = "cm-log-totals";
    config.kinds.forEach((kind, index) => {
      const press = () => tap(view, kind, amount);
      quick.append(
        quickButton(kind, sums[index] ?? null, tailOf(kind, totals), press, words[index]),
      );
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
  keepingField(view, configArrived.of(config));
}

/** What a note with no card is told: nothing logged. Read by no one, so it need not be the note's. */
const NO_TOTALS = drinkTotals("");

/** The card for a note: its totals and widget only on a daily note. */
function build(state: EditorState, held: Held): Card {
  const day = noteDay(state);
  const line = day !== null ? cardLine(state.doc) : null;
  if (day === null || line === null) {
    return { ...held, food: false, totals: NO_TOTALS, shown: false, decorations: Decoration.none };
  }
  const text = state.doc.toString();
  const totals = drinkTotals(text);
  const drawn = held.config ?? DEFAULT_CONFIG;
  const sums = drawn.kinds.map((kind) => kindTotal(kind, text, totals));
  const words = drawn.kinds.map((kind, index) =>
    sums[index] === null ? earlierWords(kind, held.latest, day) : undefined,
  );
  // Only a tap still on the page can be undone, so an edited one is offered nothing.
  const undo =
    held.lastTap !== null && stillThere(state.doc, held.lastTap) ? held.lastTap.text : null;
  const groups = groupByMeal(foodEntries(text));
  const widget = new LogCard(
    {
      totals,
      sums,
      words,
      ask: held.ask,
      undo,
      config: drawn,
      groups,
      copies: copiesFor(day, held.yesterday, groups),
      raw: logLines(text),
    },
    held.config,
  );
  return {
    ...held,
    totals,
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
  create: (state) =>
    build(state, {
      lastTap: null,
      food: false,
      config: logConfig(),
      yesterday: null,
      latest: null,
      ask: null,
    }),
  update(value, tr) {
    const held: Held = { ...value };
    if (tr.docChanged && held.lastTap !== null) {
      held.lastTap = { from: tr.changes.mapPos(held.lastTap.from), text: held.lastTap.text };
    }
    // A write, an edit or an Undo takes back the question a last kind asked.
    if (tr.docChanged) held.ask = null;
    let changed = tr.docChanged;
    for (const effect of tr.effects) {
      if (effect.is(tapped)) {
        held.lastTap = effect.value;
        changed = true;
      }
      if (effect.is(foodOpen)) {
        held.food = effect.value;
        changed = true;
      }
      if (effect.is(asking)) {
        held.ask = effect.value;
        changed = true;
      }
      if (effect.is(configArrived)) {
        held.config = effect.value;
        changed = true;
      }
      // An answer for a day the note no longer comes after is dropped, and the one held stays.
      const day = noteDay(tr.state);
      if (effect.is(yesterdayArrived) && day !== null && effect.value.day === shiftDay(day, -1)) {
        held.yesterday = effect.value;
        changed = true;
      }
      if (effect.is(latestArrived) && day !== null && effect.value.day === day) {
        held.latest = effect.value;
        changed = true;
      }
    }
    return changed ? build(tr.state, held) : value;
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
  if (field.yesterday?.day !== shiftDay(day, -1)) askYesterday(view, day);
  // The 30 days are read only where a kind keeps its last value, so a vault with none asks for nothing more.
  if (field.config?.kinds.some((kind) => kind.last === true) === true) askLatest(view, day);
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
      forgetLatest(view);
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
 * Asks on the card for the number `mark`'s last kind needs, and writes nothing. False,
 * with nothing changed, where the view shows no card.
 */
export function askOnCard(view: EditorView, mark: string): boolean {
  if (!cardShown(view)) return false;
  askFor(view, mark);
  // The palette hands its focus back to the editor when it closes, after this returns.
  queueMicrotask(() => focusAmount(view));
  return true;
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
