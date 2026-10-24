import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  dropFoodSheet,
  hideFoodSheet,
  type SheetOwner,
  showFoodSheet,
} from "@/components/food-sheet";
import { type Editing, EntryList, MEALS, Reading } from "@/components/log-pane-rows";
import { type Day, foodTotal, type Line, LogTrends, totalOf } from "@/components/log-trends";
import { fetchNote, NoteMissing } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { fetchLog } from "@/lib/food-api";
import { type FoodPanel, foodPanel } from "@/lib/food-search";
import type { EditorCommands } from "@/lib/key-bindings";
import { LOG_NOTE } from "@/lib/layout";
import { foodButton, quickButton } from "@/lib/log-card-view";
import { editedLine } from "@/lib/log-edit";
import {
  DEFAULT_CONFIG,
  type FoodField,
  type FoodGoals,
  kindLine,
  type LogKind,
  parseConfig,
} from "@/lib/log-kinds";
import type { DrinkTotals } from "@/lib/log-lines";
import { useLeader } from "@/lib/use-leader";
import type { LogActions } from "@/lib/use-log-actions";
import { useViewport } from "@/lib/use-viewport";

type Range = 7 | 30 | 90;

const RANGES: Range[] = [7, 30, 90];

/** The two tabs a phone shows in place of the two columns. */
const TABS = ["today", "trends"] as const;
type Tab = (typeof TABS)[number];

const FOOD: { field: FoodField; unit: string }[] = [
  { field: "kcal", unit: "kcal" },
  { field: "protein", unit: "g" },
  { field: "carbs", unit: "g" },
  { field: "fat", unit: "g" },
];

/** A word with its first letter capitalised, as the pane writes its names and meal heads. */
function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface LogPaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  onOpen: (path: string, line: number) => void;
  /** Raised by the route when this pane has been moved to. See `Editor`. */
  focusSignal: number;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
  actions: LogActions;
  /** Says why a write was refused, or clears the line with undefined. */
  onNotice: (text: string | undefined) => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The log did not load";
}

/** A row's text without its marker, which is what the amount field holds. */
function amountOf(text: string): string {
  return text.replace(/^- \S+ ?/, "");
}

function byLine(a: Line, b: Line): number {
  return a.line - b.line;
}

/**
 * The log of one day, and its trends. The day's drinks and kinds of your own
 * come first, then its food by meal. Keys act on the cursor's row, and keys typed
 * into an input or the food search are the field's own.
 */
export function LogPane({ commands, onOpen, focusSignal, today, actions, onNotice }: LogPaneProps) {
  const [day, setDay] = useState(today);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [range, setRange] = useState<Range>(30);
  const [amount, setAmount] = useState("");
  const [tab, setTab] = useState<Tab>("today");
  const { narrow } = useViewport();
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const quickBox = useRef<HTMLDivElement>(null);
  // The sheet's host sits in this pane's root. Made once, so the sheet keeps the same owner.
  const owner = useRef<SheetOwner>({
    get dom() {
      return panel.current as HTMLElement;
    },
    focus: () => panel.current?.focus(),
  });
  // The food search the sheet shows, while one is up.
  const sheetPanel = useRef<FoodPanel | null>(null);
  // The food panel outlives the render that opened it, so it writes through the latest actions.
  const writer = useRef(actions);
  // The card's buttons call through these, so a press is handled by the render that drew it.
  const tapKindRef = useRef<(kind: LogKind) => void>(() => {});
  const openFoodRef = useRef<() => void>(() => {});
  // Read by the food panel each time it draws a figure, so it sees the day as it is now.
  const todayFood = useRef<{ eaten: DrinkTotals["food"]; goals: FoodGoals }>({
    eaten: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    goals: {},
  });
  const leader = useLeader(commands);

  // The raw note under the key every reader of log.md shares, parsed on the way out, so the
  // cache holds text. A missing note has no data, and the defaults are drawn. So does a note
  // gone missing since: a failed refetch of any other kind keeps the last good data, which
  // react-query holds through the error.
  const logConfig = useQuery({
    queryKey: ["note", LOG_NOTE],
    queryFn: () => fetchNote(LOG_NOTE),
    select: parseConfig,
  });
  const config =
    logConfig.error instanceof NoteMissing ? DEFAULT_CONFIG : (logConfig.data ?? DEFAULT_CONFIG);

  const { data: days, error: dayError } = useQuery({
    queryKey: ["log", day, day],
    queryFn: () => fetchLog(day, day),
  });
  const from = shiftDay(day, 1 - range);
  const { data: trend, error: trendError } = useQuery({
    queryKey: ["log", from, day],
    queryFn: () => fetchLog(from, day),
  });

  const entryDay: Day | undefined = days?.find((found) => found.date === day);
  const entries = entryDay?.entries ?? [];
  const groups: { title: string | null; lines: Line[] }[] = [
    {
      title: null,
      lines: entries.filter((line) => line.kind !== "food").sort(byLine),
    },
    ...MEALS.map((meal) => ({
      title: meal === "" ? "No meal" : capital(meal),
      lines: entries
        .filter((line) => line.kind === "food" && (line.meal ?? "") === meal)
        .sort(byLine),
    })),
  ].filter((group) => group.lines.length > 0);
  // The cursor walks the rows in the order they are drawn.
  const rows = groups.flatMap((group) => group.lines);
  const at = Math.max(0, Math.min(cursor, rows.length - 1));
  const row = rows[at];

  const editingLine = editing?.line;
  // A row that has just become a form takes the keys, as the todo pane's row does.
  useEffect(() => {
    if (editingLine !== undefined)
      form.current?.querySelector<HTMLElement>("input, select")?.focus();
  }, [editingLine]);

  useEffect(() => {
    writer.current = actions;
    todayFood.current = {
      eaten: entryDay?.totals.food ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 },
      goals: config.food,
    };
  });

  // Taken down with the pane, so no sheet is left over whatever pane comes next.
  useEffect(() => {
    const self = owner.current;
    return () => {
      sheetPanel.current?.stop();
      sheetPanel.current = null;
      dropFoodSheet(self);
    };
  }, []);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** Takes the food search down, when `made` (or the one up) is still the one shown. */
  function closeFood(made: FoodPanel | null = sheetPanel.current) {
    if (made === null || sheetPanel.current !== made) return;
    sheetPanel.current = null;
    made.stop();
    hideFoodSheet(owner.current);
  }

  /** The food search, in the shared sheet, for the day shown. */
  function openFood() {
    if (sheetPanel.current !== null) return;
    const shown = day;
    const made = foodPanel(shown, {
      // A refused write keeps the search open, so the line can be tried again.
      log: (line) => {
        void writer.current.addLine(shown, line).then((ok) => {
          if (ok) closeFood(made);
        });
      },
      close: () => closeFood(made),
      today: () => todayFood.current,
    });
    sheetPanel.current = made;
    showFoodSheet(owner.current, made, () => {
      sheetPanel.current = null;
      // The sheet closed by its own hand and still reads as open to its host, so it is drawn
      // shut here, or the next show would mount nothing. The focus is already where it belongs.
      hideFoodSheet(owner.current);
    });
  }

  /** The day moves, and what was open on the old one closes with it. */
  function moveTo(next: string) {
    setDay(next);
    setCursor(0);
    setEditing(null);
    closeFood();
  }

  function shift(by: number) {
    moveTo(shiftDay(day, by));
  }

  function leave() {
    setEditing(null);
    panel.current?.focus();
  }

  function kindOf(line: Line): LogKind | undefined {
    return line.kind === "mine"
      ? config.kinds.find((kind) => kind.mark === line.mark)
      : config.kinds.find((kind) => kind.builtin === line.kind);
  }

  function openEdit(line: Line) {
    setCursor(rows.indexOf(line));
    setEditing({
      line: line.line,
      amount: amountOf(line.text),
      meal: line.meal ?? "",
      servings: "1",
      why: null,
    });
  }

  function save(line: Line, edit: Editing) {
    const next =
      line.kind === "food"
        ? editedLine(line, { meal: edit.meal, servings: edit.servings }, kindOf(line))
        : editedLine(line, { amount: edit.amount }, kindOf(line));
    if (typeof next !== "string") {
      setEditing({ ...edit, why: next.why });
      return;
    }
    void actions.editLine(day, { line: line.line, text: line.text }, next).then((ok) => {
      if (ok) setEditing(null);
    });
  }

  function remove(line: Line) {
    void actions.deleteLine(day, { line: line.line, text: line.text }).then((ok) => {
      if (ok) setEditing(null);
    });
  }

  function tapKind(kind: LogKind) {
    const line = kindLine(kind, amount);
    if (typeof line !== "string") {
      onNotice(line.why);
      return;
    }
    void actions.addLine(day, line).then((ok) => {
      if (ok) setAmount("");
    });
  }

  function onKeyDown(event: KeyboardEvent) {
    const { target, key } = event;
    // Typing is the field's own: `j` in an amount is a letter, and so is any key in the food search.
    if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    // Enter or Space on a focused button is that button's own press, not the cursor row's.
    if (target instanceof HTMLButtonElement && (key === "Enter" || key === " ")) return;
    if (editing !== null) return;
    // The food search's sheet is a dialog, and the keys typed in it are its own.
    if (target instanceof Element && target.closest('[role="dialog"]') !== null) return;
    if (leader.feed(event)) return;

    switch (key) {
      case " ":
        leader.start(event);
        break;
      case "j":
        setCursor(Math.min(at + 1, rows.length - 1));
        break;
      case "k":
        setCursor(Math.max(at - 1, 0));
        break;
      case "h":
        shift(-1);
        break;
      case "l":
        shift(1);
        break;
      case "t":
        moveTo(today);
        break;
      case "e":
      case "Enter":
        if (row !== undefined) openEdit(row);
        break;
      case "d":
        if (row !== undefined) remove(row);
        break;
      case "u":
        if (actions.canUndo) void actions.undoDelete();
        break;
      case "o":
        if (row !== undefined && entryDay !== undefined) onOpen(entryDay.path, row.line);
        break;
      case "a":
        amountField.current?.focus();
        break;
      case "f":
        openFood();
        break;
      case "7":
        setRange(7);
        break;
      case "3":
        setRange(30);
        break;
      case "9":
        setRange(90);
        break;
      case "?":
        commands.showHelp();
        break;
      case "q":
        commands.closeNote();
        break;
      case "Escape":
        document.querySelector<HTMLElement>(".cm-content")?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  const totals = config.kinds.map((kind) => {
    const total = totalOf(kind, entryDay);
    const grams =
      kind.builtin === "alcohol" && (entryDay?.totals.alcohol.grams ?? 0) > 0
        ? `, ${entryDay?.totals.alcohol.grams} g`
        : "";
    const unit = kind.builtin === "water" ? "ml" : kind.unit;
    return { kind, total, tail: `${unit === "" ? "" : ` ${unit}`}${grams}` };
  });

  // The card's builders draw the buttons, mounted here by hand. It runs on every render, so the
  // buttons show the day as it is now, and the presses reach the latest render through the refs.
  useLayoutEffect(() => {
    tapKindRef.current = tapKind;
    openFoodRef.current = openFood;
    const box = quickBox.current;
    if (box === null) return;
    // The buttons are drawn again, so a button that had the focus gets it back by its place,
    // or a keyboard press on it would leave the pane's keys with nothing to reach them.
    const focused = Array.from(box.children).indexOf(document.activeElement as Element);
    box.replaceChildren(
      ...totals.map(({ kind, total, tail }) =>
        quickButton(kind, total, tail, () => tapKindRef.current(kind)),
      ),
      foodButton(() => openFoodRef.current()),
    );
    const kept = box.children[focused];
    if (kept instanceof HTMLElement) kept.focus({ preventScroll: true });
  });

  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Log"
      onKeyDown={onKeyDown}
      className="log-pane-frame"
    >
      <header className="log-pane-head">
        <button
          type="button"
          className="log-pane-button log-pane-step"
          aria-label="Day before"
          onClick={() => shift(-1)}
        >
          ‹
        </button>
        <input
          type="date"
          aria-label="Day"
          className="log-pane-date"
          value={day}
          onChange={(event) => {
            if (event.target.value !== "") moveTo(event.target.value);
          }}
        />
        <button
          type="button"
          className="log-pane-button log-pane-step"
          aria-label="Day after"
          onClick={() => shift(1)}
        >
          ›
        </button>
        <button type="button" className="log-pane-button" onClick={() => moveTo(today)}>
          Today
        </button>
      </header>

      {narrow ? (
        <div role="tablist" aria-label="Log view" className="log-pane-tabs">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${id}-tab-${name}`}
              aria-controls={`${id}-${name}`}
              aria-selected={tab === name}
              className="log-pane-tab"
              onClick={() => setTab(name)}
            >
              {capital(name)}
            </button>
          ))}
        </div>
      ) : null}

      <div className="log-pane">
        <div className="log-pane-cols">
          <section
            id={`${id}-today`}
            aria-label="Today"
            className="log-pane-col"
            hidden={narrow && tab !== "today"}
          >
            {/* On a phone the tab already says Today, so the heading is for a reader only. */}
            <h2 className={narrow && day === today ? "sr-only" : undefined}>
              {day === today ? "Today" : day}
            </h2>
            {dayError ? <p role="alert">{messageOf(dayError)}</p> : null}
            <ul className="log-pane-readings">
              {totals.map(({ kind, total, tail }) => (
                <Reading
                  key={kind.mark}
                  name={capital(kind.name)}
                  meter={kind.name}
                  total={total}
                  tail={tail}
                  goal={kind.goal}
                />
              ))}
              {FOOD.map(({ field, unit }) => (
                <Reading
                  key={field}
                  name={capital(field)}
                  meter={field}
                  total={foodTotal(entryDay, field)}
                  tail={` ${unit}`}
                  goal={config.food[field]}
                />
              ))}
              <li className="log-pane-reading log-pane-slot" data-slot="weight">
                <span className="log-pane-name">Weight</span>
                <span className="log-pane-total">—</span>
                <span className="log-pane-goal">no weigh-ins yet</span>
              </li>
            </ul>

            <section aria-label="Add" className="log-pane-add cm-log-row">
              <div ref={quickBox} className="log-pane-quick" />
              <input
                ref={amountField}
                className="cm-log-amount"
                aria-label="Amount"
                placeholder="amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </section>

            <section aria-label="Entries" className="log-pane-section">
              <div className="log-pane-row">
                <h2>Entries</h2>
                {actions.canUndo ? (
                  <button
                    type="button"
                    className="log-pane-button"
                    onClick={() => void actions.undoDelete()}
                  >
                    Undo
                  </button>
                ) : null}
              </div>
              {rows.length === 0 && days !== undefined ? <p>{`Nothing logged on ${day}`}</p> : null}
              <EntryList
                groups={groups}
                rows={rows}
                at={at}
                editing={editing}
                formRef={form}
                onOpen={openEdit}
                onChange={(next) => setEditing((previous) => previous && { ...previous, ...next })}
                onSave={save}
                onCancel={leave}
                onDelete={remove}
              />
            </section>
          </section>

          <section
            id={`${id}-trends`}
            aria-label="Trends"
            className="log-pane-col"
            hidden={narrow && tab !== "trends"}
          >
            <h2 className={narrow ? "sr-only" : undefined}>Trends</h2>
            <fieldset className="log-pane-row log-pane-range">
              <legend className="sr-only">Range</legend>
              {RANGES.map((span) => (
                <button
                  key={span}
                  type="button"
                  className="log-pane-button"
                  aria-pressed={range === span}
                  onClick={() => setRange(span)}
                >
                  {`${span}d`}
                </button>
              ))}
            </fieldset>
            {trendError ? <p role="alert">{messageOf(trendError)}</p> : null}
            <LogTrends days={trend ?? []} config={config} from={from} range={range} today={today} />
          </section>
        </div>
      </div>
    </section>
  );
}
