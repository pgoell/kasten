import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { BoardCard, SET } from "@/components/board-card";
import { BoardPicker } from "@/components/board-picker";
import type { SearchHit, TodoHit } from "@/lib/api";
import type { Todo, TodoState } from "@/lib/todo";
import type { Closed } from "@/lib/todo-blocked";
import {
  COLUMN_HEADING,
  COLUMNS,
  type Column,
  projectChoices,
  withProjectLink,
} from "@/lib/todo-board";
import { dropOf, pinnedBy } from "@/lib/todo-drag";
import type { Placed } from "@/lib/todo-view";
import { cardKey, useBoardLanes } from "@/lib/use-board-lanes";
import { useCardDrag } from "@/lib/use-card-drag";
import { useColumnSwipe } from "@/lib/use-column-swipe";

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

/**
 * Where Rejected sits in the columns. It is folded on a desktop by default, the
 * one column a board folds, since the work done a week ago is rarely what the
 * eye is after.
 */
const REJECTED = COLUMNS.indexOf("rejected");

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
  /** `g`, and the `project` button: lanes by project rather than by kind. */
  const [byProject, setByProject] = useState(false);
  /**
   * The lanes a tap folded, by id. Memory only, so a reload draws them all open
   * again, as the lanes' own state is kept per mount.
   */
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  /** Whether the Rejected column was unfolded by a click, which `l` onto it also does while the cursor is there. */
  const [rejectedOpen, setRejectedOpen] = useState(false);
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

  // The cards the keys walk. A lane the user folded draws none, so the cursor
  // passes over it rather than onto a card nobody can see.
  const walkable = useMemo(
    () =>
      COLUMNS.map((_, index) =>
        lanes.filter((lane) => !folded.has(lane.id)).flatMap((lane) => lane.cells[index] ?? []),
      ),
    [lanes, folded],
  );

  // Rejected is drawn unfolded while the cursor is on it, so `l` opens it, and
  // `h` folds it again by leaving.
  const rejectedDrawn = rejectedOpen || col === REJECTED;

  const swipe = useColumnSwipe({
    active: coarse,
    index: col,
    count: COLUMNS.length,
    carrying: () => carrying(),
    onShow: showColumn,
  });

  // Clamped as the list clamps its cursor: a move or a narrower filter can
  // take the card it was on out of the column.
  const column = walkable[col] ?? [];
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

  /** `g`. */
  function switchLanes() {
    chooseLanes(!byProject);
  }

  /** The `kind` and `project` buttons, and `g` through `switchLanes`. */
  function chooseLanes(next: boolean) {
    if (next === byProject) return;
    // The cell the card left is gone, and with it what a drop would mean.
    endDrag();
    setByProject(next);
    setRow(0);
    settle();
  }

  /** A tab tap or a swipe shows the column at `index`, from its top. */
  function showColumn(index: number) {
    setCol(index);
    setRow(0);
  }

  /** A tap on a lane's heading folds the lane or unfolds it. */
  function toggleLane(id: string) {
    setFolded((before) => {
      const after = new Set(before);
      if (after.has(id)) after.delete(id);
      else after.add(id);
      return after;
    });
  }

  /**
   * The Rejected heading: unfolds the column, or folds it again. Folding it
   * while the cursor is on it moves the cursor to Done, or the column would
   * stay drawn open under the cursor.
   */
  function toggleRejected() {
    if (!rejectedDrawn) {
      setRejectedOpen(true);
      return;
    }
    setRejectedOpen(false);
    if (col === REJECTED) showColumn(REJECTED - 1);
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
    const key = cardKey(card.hit);
    return (
      <BoardCard
        key={key}
        card={card}
        lane={lane}
        focused={key === cursorKey}
        lifted={lifted === key}
        coarse={coarse}
        parent={parents.get(key)}
        progress={progress.get(key)}
        named={named}
        closed={closed}
        today={today}
        files={files}
        drag={{ grab, swallowed }}
        more={more}
        onMore={setMore}
        onOpen={onOpen}
        onCycle={onCycle}
        onProject={project}
        onRefile={onRefile}
      />
    );
  }

  /**
   * A lane's heading, a button that folds it. It names the lane and counts the
   * cards it holds, which a folded lane keeps. `locked` is a lane with nothing
   * in the shown state: it folds on its own and cannot be opened.
   */
  function laneHeading(
    id: string,
    name: string,
    count: number,
    open: boolean,
    locked: boolean,
    span: string,
  ) {
    return (
      <h3 className={`${heading} ${span}`}>
        <button
          type="button"
          aria-expanded={open}
          disabled={locked}
          onClick={() => toggleLane(id)}
          // The count is drawn from the attribute, not typed as text, so the heading's text
          // stays the lane's name: a folded lane's count is still there, and the names read alone.
          data-count={count}
          className={`flex w-full items-center gap-1.5 text-left after:ml-1 after:text-[12px] after:text-k-muted after:content-[attr(data-count)] ${coarse ? "min-h-11" : ""}`}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`size-3 shrink-0 transition-transform duration-[var(--k-hover)] ease-[var(--k-ease-out)] motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          >
            <path
              d="M6 4l4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {name}
        </button>
      </h3>
    );
  }

  const heading = "px-3 pt-2 pb-1 text-[11px] tracking-wider text-k-muted uppercase";

  /** The mark a drop zone carries while the pointer brings a card over it. */
  const marked = (name: string) => (overZone === name ? "" : undefined);
  const lit = (name: string) => (overZone === name ? "bg-k-accent/15" : "");

  /** The `kind` and `project` buttons that switch the lanes, one of them pressed. */
  function laneSwitch(label: string, value: boolean) {
    const pressed = byProject === value;
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-pressed={pressed}
        onClick={() => chooseLanes(value)}
        className={`border-b-2 px-2 ${coarse ? "min-h-11" : ""} ${pressed ? "border-k-accent text-k-ink" : "border-transparent text-k-muted"}`}
      >
        {label}
      </button>
    );
  }

  return (
    <div ref={root} className="flex-1 overflow-auto py-1 font-sans text-[13px]">
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

      {/* Lanes by kind or by project, at the top on a desktop and a phone alike. */}
      <div className="flex gap-1 border-b border-k-rule px-2">
        {laneSwitch("kind", false)}
        {laneSwitch("project", true)}
      </div>

      {/* A phone has room for one column, so the tabs pick which. */}
      {coarse && (
        // A lifted card holds the page still, so a tab scrolled out of the
        // strip could not be reached: while one is up, the tabs wrap.
        <div
          role="tablist"
          data-carrying={lifted !== null ? "" : undefined}
          className={`flex border-b border-k-rule ${lifted !== null ? "flex-wrap" : "overflow-x-auto"}`}
        >
          {COLUMNS.map((name, index) => (
            <button
              key={name}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={index === col}
              onClick={() => showColumn(index)}
              // A drop on a tab sets that column's state.
              data-over={marked(`tab:${name}`)}
              onPointerOver={(event) => hover(event, `tab:${name}`, name)}
              onPointerLeave={unhover}
              className={`min-h-11 shrink-0 border-b-2 px-3 ${index === col ? "border-k-accent text-k-ink" : "border-transparent text-k-muted"} ${lit(`tab:${name}`)}`}
            >
              {COLUMN_HEADING[name]} {columns[index]?.length ?? 0}
            </button>
          ))}
        </div>
      )}

      {cards.length === 0 ? (
        <p className="px-3 py-1 text-k-muted">nothing on the board</p>
      ) : coarse ? (
        // The swipe is on the column alone: the tabs and the page keep their own touches.
        <div
          ref={swipe.ref}
          style={{ touchAction: "pan-y", overscrollBehaviorX: "contain" }}
          {...swipe.handlers}
        >
          {lanes.map((lane) => {
            // A drop on a lane of the column shown refiles.
            const name = `lane:${lane.id}`;
            const shown = lane.cells[col] ?? [];
            // A lane with nothing in the shown state folds on its own, and stays
            // shut until a card of it is shown: a folded lane takes no drop.
            const empty = shown.length === 0;
            const shut = empty || folded.has(lane.id);
            return (
              <div
                key={lane.id}
                data-lane={lane.id}
                data-over={shut ? undefined : marked(name)}
                onPointerOver={
                  shut ? undefined : (event) => hover(event, name, COLUMNS[col] ?? "open", lane.id)
                }
                onPointerLeave={unhover}
                className={shut ? undefined : lit(name)}
              >
                {laneHeading(lane.id, lane.name, shown.length, !shut, empty, "")}
                {!shut && shown.map((card) => drawCard(card, lane.id))}
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className={`grid min-w-[63rem] gap-x-1 ${rejectedDrawn ? "grid-cols-7" : "grid-cols-[repeat(6,minmax(0,1fr))_3rem]"}`}
        >
          {COLUMNS.map((name: Column, index) => (
            <div
              key={name}
              data-testid="todo-column"
              className={`${heading} ${index === col ? "text-k-ink" : ""}`}
            >
              {name === "rejected" ? (
                <button
                  type="button"
                  aria-expanded={rejectedDrawn}
                  onClick={toggleRejected}
                  className={`text-left ${rejectedDrawn ? "" : "min-w-0 truncate"}`}
                >
                  {COLUMN_HEADING[name]} {columns[index]?.length ?? 0}
                </button>
              ) : (
                <>
                  {COLUMN_HEADING[name]} {columns[index]?.length ?? 0}
                </>
              )}
            </div>
          ))}
          {lanes.map((lane) => {
            // A folded lane is its heading alone: no cell, so no drop.
            const shut = folded.has(lane.id);
            const count = lane.cells.reduce((sum, cell) => sum + cell.length, 0);
            return (
              <div key={lane.id} className="col-span-7 grid grid-cols-subgrid">
                {laneHeading(
                  lane.id,
                  lane.name,
                  count,
                  !shut,
                  false,
                  "col-span-7 border-t border-k-rule",
                )}
                {!shut &&
                  COLUMNS.map((column, index) => {
                    if (column === "rejected" && !rejectedDrawn) return <div key={column} />;
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
            );
          })}
        </div>
      )}
    </div>
  );
}
