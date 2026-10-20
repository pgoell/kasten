import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { BoardPicker } from "@/components/board-picker";
import type { SearchHit, TodoHit } from "@/lib/api";
import { ROW } from "@/lib/overlay-styles";
import { PRIORITY_SYMBOL, type Todo, type TodoState } from "@/lib/todo";
import type { Closed } from "@/lib/todo-blocked";
import {
  COLUMN_HEADING,
  COLUMNS,
  type Column,
  columnOf,
  projectChoices,
  withProjectLink,
} from "@/lib/todo-board";
import { dropOf, pinnedBy } from "@/lib/todo-drag";
import { type Placed, waitsFor } from "@/lib/todo-view";
import { cardKey, useBoardLanes } from "@/lib/use-board-lanes";
import { useCardDrag } from "@/lib/use-card-drag";

/** One todo the board draws, as the pane read it: the tree's todo, not the line's. */
export interface Card {
  /** Carries the todo's project, which the backend works out. */
  hit: TodoHit;
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
  V: "review",
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

interface TodoBoardProps {
  ref: React.Ref<BoardKeys>;
  /** What the filter left of the open todos and the recently finished ones. */
  cards: Card[];
  /** What each todo hangs off, keyed `path:line`, which kind walks up. */
  parents: Map<string, Placed>;
  /** What each `⛔` names. */
  named: Map<string, Todo>;
  /** Which of those ids are closed, and which two todos carry. */
  closed: Closed;
  /** `3/5` keyed by `path:line`. */
  progress: Map<string, string>;
  /** Every path in the vault, which `p` lists projects from and a link resolves against. */
  files: string[];
  today: string;
  coarse: boolean;
  /** The pane's `held`: whether the keys were ours before a redraw dropped the focus. */
  held: React.RefObject<boolean>;
  onOpen: (path: string, line: number) => void;
  onCycle: (hit: SearchHit, state?: TodoState) => void;
  onEdit: (hit: SearchHit, line: string) => void;
  /** The pane's `m`, said of a card, or a card dropped on the lane of `project`. */
  onRefile: (hit: TodoHit, project?: string) => void;
  /** Why a dropped card moved nothing. */
  onNotice: (text: string) => void;
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
  closed,
  progress,
  files,
  today,
  coarse,
  held,
  onOpen,
  onCycle,
  onEdit,
  onRefile,
  onNotice,
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
  // The pointer code's state and listeners, which the cards and zones draw from.
  // Its cleanup effect runs first, as the board's did when it was written here.
  const { lifted, overZone, grab, hover, unhover, endDrag, carrying, swallowed } =
    useCardDrag<Card>(
      (card) => cardKey(card.hit),
      (card, from, to) => {
        // The keys' own writes, so a state drop still runs what `X` runs and a lane
        // drop goes through `m`'s refile. Nothing here says where in a column the
        // card goes: the board draws the vault's order and keeps none of its own.
        const above = ancestors.get(cardKey(card.hit)) ?? [];
        const tags = [card.todo, ...above.map((one) => one.todo)].flatMap((todo) => todo.tags);
        const drop = dropOf(from, to, byProject, pinnedBy(tags));
        if (drop.kind === "state") onCycle(card.hit, drop.state);
        else if (drop.kind === "refile") onRefile(card.hit, drop.project);
        else if (drop.kind === "refused") onNotice(drop.why);
      },
    );

  const choices = useMemo(() => projectChoices(files), [files]);

  const { ancestors, lanes, columns } = useBoardLanes(cards, parents, byProject);

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
    // The cell the card left is gone, and with it what a drop would mean.
    endDrag();
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
      // Only while a card is up, so Escape otherwise goes on to the pane.
      if (key === "Escape" && carrying()) {
        endDrag();
        return true;
      }
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
        case "V":
        case "X":
        case "B":
        case "W":
        case "R":
          if (at !== undefined) onCycle(at.hit, SET[key]);
          break;
        case "p":
          if (at !== undefined) project(at.hit);
          break;
        case "m":
          if (at !== undefined) onRefile(at.hit);
          break;
        default:
          return false;
      }
      return true;
    },
  }));

  function drawCard(card: Card, lane: string) {
    const { hit, todo } = card;
    const key = cardKey(hit);
    const focused = key === cursorKey;
    const parent = parents.get(key);
    const blockers = waitsFor(todo, named, closed);
    const face = (
      <button
        type="button"
        data-card={key}
        data-testid="todo-card"
        data-lifted={lifted === key ? "" : undefined}
        tabIndex={focused ? 0 : -1}
        onPointerDown={(event) => grab(event, card, { lane, column: columnOf(todo) })}
        onClick={() => {
          if (swallowed()) return;
          onOpen(hit.path, hit.line);
        }}
        title={key}
        className={`${ROW} flex min-w-0 flex-col gap-0.5 text-one-fg ${focused ? CURSOR : ""} ${coarse ? "min-h-11 justify-center" : ""} ${lifted === key ? "opacity-40" : ""}`}
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
      ["refile", () => onRefile(hit)],
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

  /** The mark a drop zone carries while the pointer brings a card over it. */
  const marked = (name: string) => (overZone === name ? "" : undefined);
  const lit = (name: string) => (overZone === name ? "bg-one-cursor/15" : "");

  return (
    <div ref={root} className="flex-1 overflow-auto py-1">
      {picker !== null && (
        <BoardPicker
          title={picker.hit.text}
          choices={choices}
          at={picker.at}
          coarse={coarse}
          onPick={(choice) => pick(picker.hit, choice)}
          onCancel={closePicker}
        />
      )}

      {/* A phone has room for one column, so the tabs pick which. */}
      {coarse && (
        <div className="flex border-b border-one-line text-[11px]">
          {/* A lifted card holds the page still, so a tab scrolled out of the
              strip could not be reached: while one is up, the tabs wrap. */}
          <div
            role="tablist"
            data-carrying={lifted !== null ? "" : undefined}
            className={`flex min-w-0 flex-1 ${lifted !== null ? "flex-wrap" : "overflow-x-auto"}`}
          >
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
                // A drop on a tab sets that column's state.
                data-over={marked(`tab:${name}`)}
                onPointerOver={(event) => hover(event, `tab:${name}`, name)}
                onPointerLeave={unhover}
                className={`min-h-11 shrink-0 px-3 ${index === col ? "text-one-fg" : "text-one-muted"} ${lit(`tab:${name}`)}`}
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
          .map((lane) => {
            // A drop on a lane of the column shown refiles.
            const name = `lane:${lane.id}`;
            const column = COLUMNS[col] ?? "open";
            return (
              <div
                key={lane.id}
                data-lane={lane.id}
                data-over={marked(name)}
                onPointerOver={(event) => hover(event, name, column, lane.id)}
                onPointerLeave={unhover}
                className={lit(name)}
              >
                <h3 className={heading}>{lane.name}</h3>
                {lane.cells[col]?.map((card) => drawCard(card, lane.id))}
              </div>
            );
          })
      ) : (
        <div className="grid min-w-[63rem] grid-cols-7 gap-x-1">
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
            <div key={lane.id} className="col-span-7 grid grid-cols-subgrid">
              <h3 className={`${heading} col-span-7 border-t border-one-line`}>{lane.name}</h3>
              {COLUMNS.map((column, index) => {
                const name = `cell:${lane.id}:${column}`;
                return (
                  <div
                    key={column}
                    data-lane={lane.id}
                    data-column={column}
                    data-over={marked(name)}
                    onPointerOver={(event) => hover(event, name, column, lane.id)}
                    onPointerLeave={unhover}
                    className={`min-w-0 ${lit(name)}`}
                  >
                    {lane.cells[index]?.map((card) => drawCard(card, lane.id))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
