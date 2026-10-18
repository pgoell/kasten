import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { SearchHit, TodoHit } from "@/lib/api";
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
  withProjectLink,
} from "@/lib/todo-board";
import { dropOf, pinnedBy, type Spot } from "@/lib/todo-drag";
import { type Placed, waitsFor } from "@/lib/todo-view";

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

function cardKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

/** How far, in pixels, a pressed pointer may wander and still be a click or a tap. */
const SLOP = 5;

/** How long a finger holds still on a card before it picks the card up. */
const LONG_PRESS_MS = 400;

/** A press on a card, which becomes a drag once the card is lifted. */
interface Press {
  card: Card;
  from: Spot;
  x: number;
  y: number;
  touch: boolean;
  /** Past the slop for a mouse, past the long press for a finger. */
  lifted: boolean;
  /** The cell under the pointer, null over anything else. */
  over: Spot | null;
  timer?: ReturnType<typeof setTimeout>;
  /** Takes the window's listeners off again. */
  off: () => void;
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
  /** What each todo hangs off, keyed `path:line`, which kind walks up. */
  parents: Map<string, Placed>;
  /** What each `⛔` names. */
  named: Map<string, Todo>;
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
  /**
   * The press under way. A ref, since the window's listeners read it between
   * renders; `lifted` and `overZone` draw the same thing.
   */
  const press = useRef<Press | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  /** The drop zone under the pointer, by a name each zone draws itself against. */
  const [overZone, setOverZone] = useState<string | null>(null);
  /** A drag let go over the card it lifted still clicks it, which opens nothing. */
  const swallow = useRef(false);

  // A board taken away mid drag leaves no listener on the window.
  useEffect(
    () => () => {
      clearTimeout(press.current?.timer);
      press.current?.off();
    },
    [],
  );

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
      // The backend's answer, so an agent reading `/api/todos` sees the lane
      // drawn here and no second copy of the rule can drift from it.
      if (byProject) return card.hit.project;
      const above = ancestors.get(cardKey(card.hit)) ?? [];
      return kindOf(
        card.todo,
        above.map((one) => one.todo),
      );
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
  }, [cards, ancestors, byProject]);

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

  /** Escape, a cancelled pointer, a finger that scrolled, or the end of a drop. */
  function endDrag() {
    const held = press.current;
    if (held === null) return;
    clearTimeout(held.timer);
    held.off();
    press.current = null;
    setLifted(null);
    setOverZone(null);
  }

  /** The pointer came over a drop zone; `lane` left out is the lane the card left. */
  function hover(zone: string, column: Column, lane?: string) {
    const held = press.current;
    if (!held?.lifted) return;
    held.over = { lane: lane ?? held.from.lane, column };
    setOverZone(zone);
  }

  function unhover() {
    const held = press.current;
    if (!held?.lifted) return;
    held.over = null;
    setOverZone(null);
  }

  // The keys' own writes, so a state drop still runs what `X` runs and a lane
  // drop goes through `m`'s refile. Nothing here says where in a column the
  // card goes: the board draws the vault's order and keeps none of its own.
  function land({ card, from }: Press, to: Spot) {
    const above = ancestors.get(cardKey(card.hit)) ?? [];
    const tags = [card.todo, ...above.map((one) => one.todo)].flatMap((todo) => todo.tags);
    const drop = dropOf(from, to, byProject, pinnedBy(tags));
    if (drop.kind === "state") onCycle(card.hit, drop.state);
    else if (drop.kind === "refile") onRefile(card.hit, drop.project);
    else if (drop.kind === "refused") onNotice(drop.why);
  }

  // Pointer events rather than HTML drag and drop, which a phone does not
  // fire for a finger. A mouse lifts the card once it moves past the slop, so
  // a click still opens it. A finger lifts it after a long press, and one that
  // moves first is a scroll the browser goes on with.
  function grab(event: React.PointerEvent<HTMLElement>, card: Card, from: Spot) {
    swallow.current = false;
    if (event.button !== 0 || press.current !== null) return;
    const target = event.currentTarget;
    const { pointerId } = event;
    const touch = event.pointerType === "touch";
    const stop = (other: Event) => other.preventDefault();
    const cancel = () => endDrag();

    const lift = () => {
      held.lifted = true;
      swallow.current = true;
      setLifted(cardKey(card.hit));
      if (!touch) return;
      // A finger's pointer is held by the card it went down on, so no other
      // cell would hear it pass. jsdom has no pointer capture to let go of.
      if ("releasePointerCapture" in target) target.releasePointerCapture(pointerId);
      // From here the finger carries the card: no scroll and no menu. A
      // `touch-action` on the card would have stopped every scroll that
      // starts on one.
      window.addEventListener("touchmove", stop, { passive: false });
      window.addEventListener("contextmenu", stop);
    };
    const move = (other: PointerEvent) => {
      if (held.lifted || Math.hypot(other.clientX - held.x, other.clientY - held.y) <= SLOP) return;
      if (touch) endDrag();
      else lift();
    };
    const up = () => {
      const { lifted: carried, over } = held;
      endDrag();
      if (carried && over !== null) land(held, over);
    };

    const held: Press = {
      card,
      from,
      x: event.clientX,
      y: event.clientY,
      touch,
      lifted: false,
      over: null,
      timer: touch ? setTimeout(lift, LONG_PRESS_MS) : undefined,
      off: () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("touchmove", stop);
        window.removeEventListener("contextmenu", stop);
      },
    };
    press.current = held;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  }

  // The pane's keys never reach CodeMirror: they land on the section, whose
  // handler calls this. So vim mode on or off changes nothing here.
  useImperativeHandle(ref, () => ({
    onKey(key: string): boolean {
      // Only while a card is up, so Escape otherwise goes on to the pane.
      if (key === "Escape" && press.current?.lifted) {
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
    const blockers = waitsFor(todo, named);
    const face = (
      <button
        type="button"
        data-card={key}
        data-testid="todo-card"
        data-lifted={lifted === key ? "" : undefined}
        tabIndex={focused ? 0 : -1}
        onPointerDown={(event) => grab(event, card, { lane, column: columnOf(todo) })}
        onClick={() => {
          if (swallow.current) swallow.current = false;
          else onOpen(hit.path, hit.line);
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
                // A drop on a tab sets that column's state.
                data-over={marked(`tab:${name}`)}
                onPointerOver={() => hover(`tab:${name}`, name)}
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
                onPointerOver={() => hover(name, column, lane.id)}
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
                    onPointerOver={() => hover(name, column, lane.id)}
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
