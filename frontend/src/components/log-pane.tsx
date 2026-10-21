import { useQuery } from "@tanstack/react-query";
import { Fragment, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import {
  type Day,
  foodTotal,
  goalWords,
  type Line,
  LogTrends,
  share,
  totalOf,
} from "@/components/log-trends";
import { fetchNote } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { fetchLog } from "@/lib/food-api";
import { foodPanel } from "@/lib/food-search";
import type { EditorCommands } from "@/lib/key-bindings";
import { LOG_NOTE } from "@/lib/layout";
import { editedLine } from "@/lib/log-edit";
import {
  DEFAULT_CONFIG,
  type FoodField,
  type Goal,
  kindLine,
  type LogKind,
  parseConfig,
  tapLine,
} from "@/lib/log-kinds";
import { useLeader } from "@/lib/use-leader";
import type { LogActions } from "@/lib/use-log-actions";

type Range = 7 | 30 | 90;

const RANGES: Range[] = [7, 30, 90];

/** The meals a food line names, in the order the pane groups them. `""` is no meal. */
const MEALS = ["breakfast", "lunch", "dinner", "snack", ""] as const;

const FOOD: { field: FoodField; mark: string; unit: string }[] = [
  { field: "kcal", mark: "🔥", unit: "kcal" },
  { field: "protein", mark: "🥩", unit: "g" },
  { field: "carbs", mark: "🍞", unit: "g" },
  { field: "fat", mark: "🧈", unit: "g" },
];

/** The row being edited, what its form holds, and why the last save was refused. */
interface Editing {
  line: number;
  amount: string;
  meal: string;
  servings: string;
  why: string | null;
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

/** One kind's total against its goal, or the plain total where it has none. */
function Reading({
  name,
  head,
  tail,
  total,
  goal,
}: {
  name: string;
  head: string;
  tail: string;
  total: number;
  goal: Goal | undefined;
}) {
  if (goal === undefined) return <li className="log-pane-reading">{`${head}${tail}`}</li>;
  const words = goalWords(head, tail, total, goal);
  return (
    <li className={`log-pane-reading log-pane-${words.state}`}>
      <span>{words.text}</span>
      {/* biome-ignore lint/a11y/useSemanticElements: the bar is a styled div, and role meter carries its values for a reader. */}
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={goal.value}
        aria-valuenow={total}
        className="log-pane-meter"
      >
        <div className="log-pane-meter-fill" style={{ width: `${share(total, goal)}%` }} />
      </div>
    </li>
  );
}

function EditForm({
  line,
  edit,
  formRef,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  line: Line;
  edit: Editing;
  formRef: RefObject<HTMLFormElement | null>;
  onChange: (next: Partial<Editing>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <form
      ref={formRef}
      className="log-pane-edit"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      // Escape leaves the form here, and stops there, so the pane does not also act on it.
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
    >
      {line.kind === "food" ? (
        <>
          <label className="log-pane-field">
            <span>Meal</span>
            <select
              aria-label="Meal"
              value={edit.meal}
              onChange={(event) => onChange({ meal: event.target.value })}
            >
              {MEALS.map((meal) => (
                <option key={meal} value={meal}>
                  {meal === "" ? "no meal" : meal}
                </option>
              ))}
            </select>
          </label>
          <label className="log-pane-field">
            <span>Servings</span>
            <input
              aria-label="Servings"
              inputMode="decimal"
              value={edit.servings}
              onChange={(event) => onChange({ servings: event.target.value })}
            />
          </label>
        </>
      ) : (
        <label className="log-pane-field">
          <span>Amount</span>
          <input
            aria-label="Amount"
            value={edit.amount}
            onChange={(event) => onChange({ amount: event.target.value })}
          />
        </label>
      )}
      {edit.why === null ? null : (
        <p role="alert" className="log-pane-why">
          {edit.why}
        </p>
      )}
      <div className="log-pane-row">
        <button type="submit" className="log-pane-button">
          Save
        </button>
        <button type="button" className="log-pane-button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="log-pane-button" onClick={onDelete}>
          Delete
        </button>
      </div>
    </form>
  );
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
  const [foodOpen, setFoodOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const foodHost = useRef<HTMLDivElement>(null);
  // The food panel outlives the render that opened it, so it writes through the latest actions.
  const writer = useRef(actions);
  const leader = useLeader(commands);

  // The raw note under the key every reader of log.md shares, parsed on the way out, so the
  // cache holds text. A missing note has no data, and the defaults are drawn.
  const { data: config = DEFAULT_CONFIG } = useQuery({
    queryKey: ["note", LOG_NOTE],
    queryFn: () => fetchNote(LOG_NOTE),
    select: parseConfig,
  });

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
      title: meal === "" ? "no meal" : meal,
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
  });

  // The food search is a panel of this pane, opened for the day shown and dropped when the day moves.
  useEffect(() => {
    const host = foodHost.current;
    if (!foodOpen || host === null) return;
    const root = foodPanel(day, {
      log: (line) => {
        // A refused write keeps the search open, so the line can be tried again.
        void writer.current.addLine(day, line).then((ok) => {
          if (ok) setFoodOpen(false);
        });
      },
      close: () => setFoodOpen(false),
    });
    host.append(root);
    root.querySelector<HTMLInputElement>('input[aria-label="Food"]')?.focus();
    return () => root.remove();
  }, [foodOpen, day]);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** The day moves, and what was open on the old one closes with it. */
  function moveTo(next: string) {
    setDay(next);
    setCursor(0);
    setEditing(null);
    setFoodOpen(false);
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
    if (target instanceof Node && foodHost.current?.contains(target)) return;
    if (leader.feed(event)) return;

    switch (key) {
      case " ":
        leader.start();
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
        setFoodOpen(true);
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
    return {
      kind,
      total,
      head: `${kind.mark} ${total}`,
      tail: `${unit === "" ? "" : ` ${unit}`}${grams}`,
    };
  });

  return (
    <section ref={panel} tabIndex={-1} aria-label="Log" onKeyDown={onKeyDown} className="log-pane">
      <header className="log-pane-head">
        <button
          type="button"
          className="log-pane-button"
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
          className="log-pane-button"
          aria-label="Day after"
          onClick={() => shift(1)}
        >
          ›
        </button>
        <button type="button" className="log-pane-button" onClick={() => moveTo(today)}>
          Today
        </button>
      </header>

      <section aria-label="Today" className="log-pane-section">
        <h2>{day === today ? "Today" : day}</h2>
        {dayError ? <p role="alert">{messageOf(dayError)}</p> : null}
        <ul className="log-pane-readings">
          {totals.map(({ kind, total, head, tail }) => (
            <Reading
              key={kind.mark}
              name={kind.name}
              head={head}
              tail={tail}
              total={total}
              goal={kind.goal}
            />
          ))}
          {FOOD.map(({ field, mark, unit }) => (
            <Reading
              key={field}
              name={field}
              head={`${mark} ${foodTotal(entryDay, field)}`}
              tail={` ${unit}`}
              total={foodTotal(entryDay, field)}
              goal={config.food[field]}
            />
          ))}
        </ul>
      </section>

      <section aria-label="Add" className="log-pane-section">
        <div className="log-pane-row">
          {config.kinds.map((kind) => (
            <button
              key={kind.mark}
              type="button"
              className="log-pane-button"
              aria-label={`Log ${kind.name}`}
              onClick={() => tapKind(kind)}
            >
              {`+ ${tapLine(kind).slice(2)}`}
            </button>
          ))}
          <input
            ref={amountField}
            className="log-pane-amount"
            aria-label="Amount"
            placeholder="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button type="button" className="log-pane-button" onClick={() => setFoodOpen(true)}>
            + 🍽 food
          </button>
        </div>
        <div ref={foodHost} />
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
        <ul className="log-pane-list">
          {groups.map((group) => (
            <Fragment key={group.title ?? "drinks"}>
              {group.title === null ? null : (
                <li className="log-pane-group">
                  <h3>{group.title}</h3>
                </li>
              )}
              {group.lines.map((line) => {
                const selected = rows.indexOf(line) === at;
                return (
                  // The cursor's row is marked with aria-selected, which a list item does not take by role.
                  // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the cursor row is the one marked, as the spec names.
                  <li
                    key={line.line}
                    aria-selected={selected}
                    className={
                      selected ? "log-pane-row-item log-pane-selected" : "log-pane-row-item"
                    }
                  >
                    {editing !== null && editing.line === line.line ? (
                      <EditForm
                        line={line}
                        edit={editing}
                        formRef={form}
                        onChange={(next) =>
                          setEditing((previous) => previous && { ...previous, ...next })
                        }
                        onSave={() => save(line, editing)}
                        onCancel={leave}
                        onDelete={() => remove(line)}
                      />
                    ) : (
                      <button
                        type="button"
                        className="log-pane-line"
                        onClick={() => openEdit(line)}
                      >
                        {line.text.replace(/^- /, "")}
                      </button>
                    )}
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      </section>

      <section aria-label="Trends" className="log-pane-section">
        <h2>Trends</h2>
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
        <LogTrends days={trend ?? []} config={config} from={from} range={range} />
      </section>
    </section>
  );
}
