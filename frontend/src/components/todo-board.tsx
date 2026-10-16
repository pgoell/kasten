import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { SearchHit } from "@/lib/api";
import { ROW } from "@/lib/overlay-styles";
import { PRIORITY_SYMBOL, type Todo, type TodoState } from "@/lib/todo";
import {
  COLUMN_HEADING,
  COLUMNS,
  type Column,
  columnOf,
  KINDS,
  kindOf,
  laneName,
  projectChoices,
  projectOf,
  withProjectLink,
} from "@/lib/todo-board";
import { type Placed, waitsFor } from "@/lib/todo-view";

/** One todo the board draws, as the pane read it: the tree's todo, not the line's. */
export interface Card {
  hit: SearchHit;
  todo: Todo;
}

/** What the pane asks of the board: a key it may take, or leave to the pane. */
export interface BoardKeys {
  onKey: (key: string) => boolean;
}

/** The state each shifted key names, as the list's own table spells it. */
const SET: Record<string, TodoState> = {
  O: "open",
  P: "doing",
  X: "done",
  B: "blocked",
  W: "waiting",
  R: "rejected",
};

/** The keyboard cursor, the list's own. */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-one-cursor/45",
  "focus:outline-2 focus:outline-one-cursor focus:bg-one-cursor/15",
].join(" ");

function cardKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

interface Lane {
  /** The project's whole path or the kind, since two roots can hold a folder of one name. */
  id: string;
  name: string;
  /** The lane's cards, one list per column, in `COLUMNS` order. */
  cells: Card[][];
}

interface TodoBoardProps {
  ref: React.Ref<BoardKeys>;
  /** What the filter left of the open todos and the recently finished ones. */
  cards: Card[];
  /** What each todo hangs off, keyed `path:line`, which kind and project walk up. */
  parents: Map<string, Placed>;
  /** What each `⛔` names. */
  named: Map<string, Todo>;
  /** `3/5` keyed by `path:line`. */
  progress: Map<string, string>;
  /** Every path in the vault, which a link resolves against. */
  files: string[];
  today: string;
  coarse: boolean;
  /** The pane's `held`: whether the keys were ours before a redraw dropped the focus. */
  held: React.RefObject<boolean>;
  onOpen: (path: string, line: number) => void;
  onCycle: (hit: SearchHit, state?: TodoState) => void;
  onEdit: (hit: SearchHit, line: string) => void;
}

/**
 * The todo pane's `c`: the same cards in columns by state and lanes by kind or
 * by project.
 *
 * It holds no keys of its own. The pane hands it each key after a leader
 * sequence has had its chance, so `<leader>` and `q` read the same here as
 * they do over the list.
 */
export function TodoBoard({
  ref,
  cards,
  parents,
  named,
  progress,
  files,
  today,
  coarse,
  held,
  onOpen,
  onCycle,
  onEdit,
}: TodoBoardProps) {
  /** `g`: lanes by project rather than by kind. */
  const [byProject, setByProject] = useState(false);
  /** Bumped by a tapped button, which the focus effect below reads as its cue. */
  const [settled, setSettled] = useState(0);
  const [col, setCol] = useState(0);
  const [row, setRow] = useState(0);
  /** The card `p` was pressed on and the choice under the picker's cursor. */
  const [picker, setPicker] = useState<{ hit: SearchHit; at: number } | null>(null);
  /** The card whose `⋯` is open, by key and text for the reason the list's is. */
  const [more, setMore] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const choices = useMemo(() => projectChoices(files), [files]);

  // The todos above each card, nearest first, off the whole forest rather than
  // the cards: a parent the filter hid still gives its part a kind.
  const ancestors = useMemo(() => {
    const walk = (hit: SearchHit) => {
      const found: Placed[] = [];
      for (
        let up = parents.get(cardKey(hit));
        up !== undefined;
        up = parents.get(`${hit.path}:${up.line}`)
      ) {
        found.push(up);
      }
      return found;
    };
    return new Map(cards.map((card) => [cardKey(card.hit), walk(card.hit)]));
  }, [cards, parents]);

  const lanes = useMemo((): Lane[] => {
    const laneOf = (card: Card): string | null => {
      const above = ancestors.get(cardKey(card.hit)) ?? [];
      if (!byProject) {
        return kindOf(
          card.todo,
          above.map((one) => one.todo),
        );
      }
      // Top down, so each step hands its project to the part below it.
      let project: string | null = null;
      for (const one of [...above].reverse()) {
        project = projectOf(card.hit.path, one.todo, files, project);
      }
      return projectOf(card.hit.path, card.todo, files, project);
    };

    const groups = new Map<string | null, Card[]>();
    for (const card of cards) {
      const lane = laneOf(card);
      groups.set(lane, [...(groups.get(lane) ?? []), card]);
    }

    // By kind: the three in their fixed order, then the rest. By project: the
    // pile still to sort first, as the inbox is in Things, then by name.
    const order = byProject
      ? [...groups.keys()].sort((a, b) =>
          a === null ? -1 : b === null ? 1 : laneName(a).localeCompare(laneName(b)),
        )
      : [...KINDS, null].filter((kind) => groups.has(kind));

    return order.map((lane) => {
      const members = groups.get(lane) ?? [];
      return {
        id: lane ?? "",
        name: byProject ? laneName(lane) : (lane ?? "No kind"),
        cells: COLUMNS.map((column) => members.filter(({ todo }) => columnOf(todo) === column)),
      };
    });
  }, [cards, ancestors, byProject, files]);

  // A column's cards top to bottom across the lanes, which is what `j` and `k` walk.
  const columns = useMemo(
    () => COLUMNS.map((_, index) => lanes.flatMap((lane) => lane.cells[index] ?? [])),
    [lanes],
  );

  // Clamped as the list clamps its cursor: a move or a narrower filter can
  // take the card it was on out of the column.
  const column = columns[col] ?? [];
  const cursor = Math.min(row, Math.max(column.length - 1, 0));
  const at = column[cursor];
  const cursorKey = at === undefined ? "" : cardKey(at.hit);

  // The pane's `dropped` effect, said of the board. A move takes the card off
  // its column, the browser hands the focus to the body, and without this the
  // first card moved leaves the pane deaf.
  //
  // `settled` is the same case for a tapped button: `cancel` unmounts under
  // the finger, and `lanes` keeps the focus on itself, so a keyboard attached
  // to the phone would go on typing into nothing the board hears.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cards` and `settled` are triggers and not values this reads. A redraw or a tap is what says the focused card may be gone.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const dropped = held.current && document.activeElement === document.body;
    if (!dropped && !element.contains(document.activeElement)) return;
    const card = element.querySelector<HTMLElement>(`[data-card="${cursorKey}"]`);
    (card ?? element.closest<HTMLElement>("section"))?.focus();
  }, [cursorKey, cards, held, settled]);

  /** A button was tapped: the focus goes back to the card under the cursor. */
  function settle() {
    setSettled((count) => count + 1);
  }

  /** `g`, and `lanes` by finger. */
  function switchLanes() {
    setByProject(!byProject);
    setRow(0);
    settle();
  }

  /** Escape, and `cancel` by finger. */
  function closePicker() {
    setPicker(null);
    settle();
  }

  function pick(hit: SearchHit, choice: (typeof choices)[number]) {
    closePicker();
    // Null where the line already links there: a second pick writes nothing.
    const line = withProjectLink(hit.text, choice, files);
    if (line !== null) onEdit(hit, line);
  }

  function project(hit: SearchHit) {
    setPicker({ hit, at: 0 });
  }

  // The pane's keys never reach CodeMirror: they land on the section, whose
  // handler calls this. So vim mode on or off changes nothing here.
  useImperativeHandle(ref, () => ({
    onKey(key: string): boolean {
      if (picker !== null) {
        const choice = choices[picker.at];
        if (key === "j") setPicker({ ...picker, at: Math.min(picker.at + 1, choices.length - 1) });
        else if (key === "k") setPicker({ ...picker, at: Math.max(picker.at - 1, 0) });
        else if (key === "Enter" && choice !== undefined) pick(picker.hit, choice);
        else if (key === "Escape") closePicker();
        // Nothing moves under an open picker, but the leader still opens.
        else return key !== " ";
        return true;
      }

      switch (key) {
        case "h":
          setCol(Math.max(col - 1, 0));
          setRow(cursor);
          break;
        case "l":
          setCol(Math.min(col + 1, COLUMNS.length - 1));
          setRow(cursor);
          break;
        case "j":
          setRow(Math.min(cursor + 1, Math.max(column.length - 1, 0)));
          break;
        case "k":
          setRow(Math.max(cursor - 1, 0));
          break;
        case "g":
          switchLanes();
          break;
        case "Enter":
          if (at !== undefined) onOpen(at.hit.path, at.hit.line);
          break;
        case "x":
          if (at !== undefined) onCycle(at.hit);
          break;
        case "O":
        case "P":
        case "X":
        case "B":
        case "W":
        case "R":
          if (at !== undefined) onCycle(at.hit, SET[key]);
          break;
        case "p":
          if (at !== undefined) project(at.hit);
          break;
        default:
          return false;
      }
      return true;
    },
  }));

  function drawCard(card: Card) {
    const { hit, todo } = card;
    const key = cardKey(hit);
    const focused = key === cursorKey;
    const parent = parents.get(key);
    const blockers = waitsFor(todo, named);
    const face = (
      <button
        type="button"
        data-card={key}
        data-testid="todo-card"
        tabIndex={focused ? 0 : -1}
        onClick={() => onOpen(hit.path, hit.line)}
        title={key}
        className={`${ROW} flex min-w-0 flex-col gap-0.5 text-one-fg ${focused ? CURSOR : ""} ${coarse ? "min-h-11 justify-center" : ""}`}
      >
        {parent !== undefined && (
          <span className="w-full truncate text-[11px] text-one-muted">↳ {parent.todo.text}</span>
        )}
        <span className="flex w-full gap-2">
          {todo.priority !== undefined && (
            <span className="shrink-0">{PRIORITY_SYMBOL[todo.priority]}</span>
          )}
          <span className="min-w-0 flex-1 truncate">{todo.text}</span>
        </span>
        {(progress.has(key) || blockers.length > 0 || todo.due !== undefined) && (
          <span className="flex w-full gap-2 text-[11px] text-one-muted">
            {progress.has(key) && <span className="shrink-0">{progress.get(key)}</span>}
            {blockers.length > 0 && (
              <span title={`waits for:\n${blockers.join("\n")}`} className="min-w-0 truncate">
                ⛔ {blockers.join(", ")}
              </span>
            )}
            {/* Cut as the list cuts it: the year only where it is not this one. */}
            {todo.due !== undefined && (
              <span className="ml-auto shrink-0">
                {todo.due.startsWith(today.slice(0, 4)) ? todo.due.slice(5) : todo.due}
              </span>
            )}
          </span>
        )}
      </button>
    );
    if (!coarse) return <div key={key}>{face}</div>;

    const opening = `${key}\n${hit.text}`;
    const opened = more === opening;
    // A state picked here is meant, so one tap sets it, as in the list's strip.
    const actions: [string, () => void][] = [
      ...Object.values(SET).map((state): [string, () => void] => [
        state,
        () => onCycle(hit, state),
      ]),
      ["project", () => project(hit)],
    ];
    return (
      <div key={key}>
        <div className="flex">
          {face}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setMore(opened ? null : opening)}
            aria-label={`more for ${todo.text}`}
            aria-expanded={opened}
            className="min-h-11 min-w-11 shrink-0 text-one-muted"
          >
            ⋯
          </button>
        </div>
        {opened && (
          <div className="flex flex-wrap px-1 text-[11px] text-one-muted">
            {actions.map(([label, run]) => (
              <button
                key={label}
                type="button"
                tabIndex={-1}
                onClick={() => {
                  setMore(null);
                  run();
                }}
                aria-label={`${label} ${todo.text}`}
                className="min-h-11 px-3"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const heading = "px-3 pt-2 pb-1 text-[11px] tracking-wider text-one-muted uppercase";

  return (
    <div ref={root} className="flex-1 overflow-auto py-1">
      {picker !== null && (
        // Stuck to the top of the scroll, so a `p` far down a long column
        // opens a picker that is in sight.
        <div
          data-testid="todo-project-pick"
          className="sticky top-0 z-10 border-b border-one-line bg-one-bg pb-1"
        >
          <div className="flex items-center gap-3 px-3 text-[11px] text-one-accent">
            <span className="min-w-0 flex-1 truncate py-1">project for: {picker.hit.text}</span>
            {/* Escape by finger, as the list's blocker picker has it. */}
            {coarse && (
              <button
                type="button"
                tabIndex={-1}
                onClick={closePicker}
                className="min-h-11 shrink-0 px-3 text-one-muted"
              >
                cancel
              </button>
            )}
          </div>
          {choices.length === 0 && (
            <p className="px-3 py-1 text-[13px] text-one-muted">no folder under 02 Projects</p>
          )}
          {choices.map((choice, index) => (
            <button
              key={choice.folder}
              type="button"
              tabIndex={-1}
              onClick={() => pick(picker.hit, choice)}
              aria-current={index === picker.at}
              className={`${ROW} block ${index === picker.at ? "bg-one-cursor/15 text-one-fg" : "text-one-muted"} ${coarse ? "min-h-11" : ""}`}
            >
              {choice.name}
            </button>
          ))}
        </div>
      )}

      {/* A phone has room for one column, so the tabs pick which. */}
      {coarse && (
        <div className="flex border-b border-one-line text-[11px]">
          <div role="tablist" className="flex min-w-0 flex-1 overflow-x-auto">
            {COLUMNS.map((name, index) => (
              <button
                key={name}
                type="button"
                role="tab"
                tabIndex={-1}
                aria-selected={index === col}
                onClick={() => {
                  setCol(index);
                  setRow(0);
                }}
                className={`min-h-11 shrink-0 px-3 ${index === col ? "text-one-fg" : "text-one-muted"}`}
              >
                {COLUMN_HEADING[name]} {columns[index]?.length ?? 0}
              </button>
            ))}
          </div>
          {/* `g` by finger. */}
          <button
            type="button"
            tabIndex={-1}
            onClick={switchLanes}
            aria-pressed={byProject}
            className="min-h-11 shrink-0 px-3 text-one-muted"
          >
            lanes
          </button>
        </div>
      )}

      {cards.length === 0 ? (
        <p className="px-3 py-1 text-[13px] text-one-muted">nothing on the board</p>
      ) : coarse ? (
        lanes
          .filter((lane) => (lane.cells[col]?.length ?? 0) > 0)
          .map((lane) => (
            <div key={lane.id}>
              <h3 className={heading}>{lane.name}</h3>
              {lane.cells[col]?.map(drawCard)}
            </div>
          ))
      ) : (
        <div className="grid min-w-[54rem] grid-cols-6 gap-x-1">
          {COLUMNS.map((name: Column, index) => (
            <div
              key={name}
              data-testid="todo-column"
              className={`${heading} ${index === col ? "text-one-fg" : ""}`}
            >
              {COLUMN_HEADING[name]} {columns[index]?.length ?? 0}
            </div>
          ))}
          {lanes.map((lane) => (
            <div key={lane.id} className="col-span-6 grid grid-cols-subgrid">
              <h3 className={`${heading} col-span-6 border-t border-one-line`}>{lane.name}</h3>
              {lane.cells.map((cell, index) => (
                <div key={COLUMNS[index]} className="min-w-0">
                  {cell.map(drawCard)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
