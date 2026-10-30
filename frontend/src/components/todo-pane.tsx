import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { type BoardKeys, TodoBoard } from "@/components/todo-board";
import { TodoFooter } from "@/components/todo-footer";
import { TodoHeader } from "@/components/todo-header";
import { TodoLegend } from "@/components/todo-legend";
import { TodoList } from "@/components/todo-list";
import { fetchTodos, type SearchHit, type TodoHit } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import type { TodoState } from "@/lib/todo/todo";
import { useArmed } from "@/lib/todo/use-armed";
import { useBlockerPick } from "@/lib/todo/use-blocker-pick";
import { useTodoFilter } from "@/lib/todo/use-todo-filter";
import { useTodoFocus } from "@/lib/todo/use-todo-focus";
import { useTodoHold } from "@/lib/todo/use-todo-hold";
import { SET, type TodoKeyActions, useTodoKeys } from "@/lib/todo/use-todo-keys";
import { type Mode, rowKey, useTodoRows } from "@/lib/todo/use-todo-rows";

import { useTodoTwins } from "@/lib/todo/use-todo-twins";
import { useViewport } from "@/lib/use-viewport";

/** The row the pane's `@` acts on, with its twins where it has any. */
export interface AgentRow {
  hit: SearchHit;
  twins?: number[];
}

interface TodoPaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  onOpen: (path: string, line: number) => void;
  /**
   * Cycles the row's todo in the vault, or sets the state a key named. Takes the
   * hit, not the todo: the write re-reads the note and finds the line by its path and line.
   */
  onCycle: (hit: SearchHit, state?: TodoState, twins?: number[]) => void;
  /** Open the prompt that writes a todo into today's note. */
  onAdd: () => void;
  /** Opens the add prompt on a row, so the part lands in the parent's note beside its line. */
  onSubtask: (hit: SearchHit) => void;
  /**
   * Puts the row's line back in its note, edited. The one press that carries text:
   * what the input holds is what the vault gets.
   */
  onEdit: (hit: SearchHit, line: string) => void;
  /**
   * Says the first row's todo waits for the second's. The write puts a `⛔` on one
   * line and may put an id on the other.
   */
  onBlock: (hit: SearchHit, blocker: SearchHit) => void;
  /**
   * Whether the archive is on the list. It sits in the query key, so a toggle reads
   * its own cached answer; the search panel keys the same way, so both agree.
   */
  archive?: boolean;
  /**
   * Starts a session on the row's todo, or closes the ones running. The write
   * finds the task line by the hit's path and line.
   */
  onTimer: (hit: SearchHit, twins?: number[]) => void;
  /**
   * Tags the row's todo `#agent` for the worker, or takes the tag off. The write
   * finds the task line by the hit's path and line.
   */
  onAgent: (hit: SearchHit, twins?: number[]) => void;
  /**
   * The row `@` would act on, or null where it does nothing, for the palette to read as it opens.
   * A ref, not a callback, so a cursor move renders nothing; only the focused pane gets it.
   */
  cursorRow?: { current: AgentRow | null };
  /**
   * Moves the row's todo and its parts into its project's note. A TodoHit, so the
   * project is the backend's answer; a board drop passes its lane's project instead.
   */
  onRefile: (hit: TodoHit, project?: string) => void;
  /** Say why a card dropped on the board moved nothing. */
  onNotice: (text: string) => void;
  /** Raised by the route when this pane has been moved to. See `Editor`. */
  focusSignal: number;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
}

/**
 * Every open todo the vault holds, grouped by when it is due; shares the todo overlay's query key.
 * A pending leader sequence resolves first, but `<leader>x` is left out: bare `x` acts on a row.
 */
export function TodoPane({
  commands,
  onOpen,
  onCycle: cycle,
  onAdd,
  onSubtask,
  onEdit,
  onBlock,
  onTimer: timer,
  onAgent: agent,
  cursorRow,
  onRefile,
  onNotice,
  focusSignal,
  today,
  archive = false,
}: TodoPaneProps) {
  /** Which row the keys act on. */
  const [active, setActive] = useState(0);
  /** Which list is drawn: the open todos, `d`'s finished ones, or `n`'s actions. */
  const [mode, setMode] = useState<Mode>("open");
  /** `c`: the todos drawn as a board rather than as the list. */
  const [board, setBoard] = useState(false);
  /**
   * The Done this week fold, closed at the start so the list reads as what is left.
   * `j` and `k` walk its rows only while it is open.
   */
  const [doneOpen, setDoneOpen] = useState(false);
  /** The board's keys, which the handler below hands it in board mode. */
  const boardKeys = useRef<BoardKeys>(null);
  /**
   * The row being edited and its line as it stands, or null. The key, not the hit:
   * the row is looked up at each press, and the text here is the input itself.
   */
  const [editing, setEditing] = useState<{ key: string; line: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const draft = useRef<HTMLInputElement>(null);
  // A finger has no keys, so a touch screen draws each of them as a button.
  const { coarse } = useViewport();
  const armed = useArmed();

  const { data: answer } = useQuery({
    queryKey: ["todos", archive],
    queryFn: () => fetchTodos(archive),
  });
  // Deferred so a long answer renders in yielding passes (#1355). Every reader takes
  // this value, so the hold and twins keep step with the rows.
  const data = useDeferredValue(answer);
  const narrowing = useTodoFilter();
  const blocker = useBlockerPick(onBlock);
  // A blocker is picked off the open list, whichever list `b` was pressed on.
  const listed: Mode = blocker.picking === null ? mode : "open";

  const facts = useTodoRows({
    data,
    today,
    picking: blocker.picking,
    listed,
    line: narrowing.line,
    board,
    kind: narrowing.kind,
    shared: narrowing.shared,
  });

  // The order the rows are drawn in, held while a press is being read.
  const { groups, groupRows, foldRows, pressing, release } = useTodoHold({
    data,
    current: facts.groups,
    doneWeek: facts.doneWeek,
    listed,
    board,
    doneOpen,
  });
  // What `j` and `k` walk: the groups, and the Done this week rows once their
  // fold is open. A folded row is not on screen, so the cursor does not stop on it.
  const rows = useMemo(
    () => (doneOpen ? [...groupRows, ...foldRows] : groupRows),
    [groupRows, doneOpen, foldRows],
  );

  // Narrowing the list can strand the cursor past the end of it.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));
  const at = rows[cursor];
  const cursorKey = at === undefined ? "" : rowKey(at.hit);
  const refile = pressing(onRefile);
  const { onCycle, onTimer, onAgent } = useTodoTwins({
    data,
    cycle: pressing(cycle),
    timer: pressing(timer),
    agent: pressing(agent),
    cursorRow,
    at,
    idle: board || blocker.picking !== null,
  });

  // The key alone, so typing in the row (a new `line`) does not re-run the focus effect.
  const editingKey = editing?.key;

  const { held, focusList } = useTodoFocus({
    panel,
    filter,
    draft,
    focusSignal,
    cursorKey,
    rows,
    board,
    editingKey,
  });

  // The three below are what a key and a button both do, so each is said once.

  /** `d` and `n`: swap the list for the one named, or give the open one back. */
  function show(list: Mode) {
    setMode((previous) => (previous === list ? "open" : list));
    setActive(0);
    release();
  }

  /** `v`: the next view, writing the note first where the vault has none. */
  function nextView() {
    narrowing.nextView();
    setActive(0);
    release();
  }

  /** `c`: the board or the list. Either way the order held for the list is let go. */
  function toggleBoard() {
    setBoard(!board);
    release();
  }

  /**
   * A kind chip narrows the list and board. The cursor goes to the top, as it does
   * on a typed filter, since the rows under it may now differ.
   */
  function pickKind(next: string | null) {
    narrowing.setKind(next);
    setActive(0);
    release();
  }

  /** The shared toggle, which restarts the cursor for the same reason a chip does. */
  function flipShared() {
    narrowing.toggleShared();
    setActive(0);
    release();
  }

  /**
   * Refocuses the cursor after a mouse click, so Space and Enter do not click again.
   * Inert while a row is an input or a picker is up.
   */
  function strip(run: () => void) {
    if (editing !== null || blocker.picking !== null) return;
    run();
    if (!coarse) focusList();
  }

  /**
   * `i`: the row becomes its line, by the row's own key so a tap need not move the cursor.
   * Not while another row is edited: a tap that got through would drop that draft unwritten.
   */
  function edit(hit: SearchHit) {
    if (editing !== null) return;
    // An edited line may change its words, and a held row would take it as a new todo
    // at the group's end, so the list is drawn fresh.
    release();
    setEditing({ key: rowKey(hit), line: hit.text });
  }

  /** `s`: a part of the row, which lands beside its parent in the list drawn fresh. */
  function part(hit: SearchHit) {
    release();
    onSubtask(hit);
  }

  /**
   * `b`: the picker opens over the list. It lists the todos the list hides, so the
   * held order is let go rather than taking them in.
   */
  function block(hit: SearchHit) {
    if (!blocker.block(hit)) return;
    release();
    setActive(0);
  }

  /** A row opens its note, or is the blocker picked while the list is the picker. */
  function onRow(hit: SearchHit) {
    if (blocker.picking === null) onOpen(hit.path, hit.line);
    else blocker.pick(hit);
  }

  // A state picked from an open strip is meant, so one tap sets it, as the shifted keys do.
  const actions = (hit: TodoHit): [string, () => void][] => [
    ...Object.values(SET).map((state): [string, () => void] => [state, () => onCycle(hit, state)]),
    ["timer", () => onTimer(hit)],
    ["part", () => part(hit)],
    ["edit", () => edit(hit)],
    ["blocked by", () => block(hit)],
    ["refile", () => refile(hit)],
    ["agent", () => onAgent(hit)],
  ];

  // Each act checks the row it needs, so a key binding no row (`a`, `d`, `n`) works with none.
  const act: TodoKeyActions = {
    toggleBoard,
    down: () => setActive(Math.min(cursor + 1, rows.length - 1)),
    up: () => setActive(Math.max(cursor - 1, 0)),
    enter: () => {
      if (at === undefined) return;
      if (blocker.picking !== null) blocker.pick(at.hit);
      else onOpen(at.hit.path, at.hit.line);
    },
    cycle: () => {
      if (at !== undefined) onCycle(at.hit);
    },
    set: (state) => {
      if (at !== undefined) onCycle(at.hit, state);
    },
    timer: () => {
      if (at !== undefined) onTimer(at.hit);
    },
    agent: () => {
      if (at !== undefined) onAgent(at.hit);
    },
    refile: () => {
      if (at !== undefined) refile(at.hit);
    },
    add: () => onAdd(),
    subtask: () => {
      if (at !== undefined) part(at.hit);
    },
    edit: () => {
      if (at !== undefined) edit(at.hit);
    },
    block: () => {
      if (at !== undefined) block(at.hit);
    },
    show,
    nextView,
    filter: () => filter.current?.focus(),
    cancelPick: blocker.cancel,
  };

  const onKeyDown = useTodoKeys({
    commands,
    boardKeys,
    editing: editing !== null,
    picking: blocker.picking !== null,
    board,
    act,
  });

  // The fold is a group of its own, so a list of only finished rows still draws it.
  const empty =
    groupRows.length === 0 && facts.doneWeek.length === 0
      ? listed === "done"
        ? "nothing finished"
        : "nothing to do"
      : null;

  return (
    // On the pane, not the rows: keys act on the cursor's row, which may not hold focus.
    <section
      ref={panel}
      aria-label="Todos"
      onFocus={() => {
        held.current = true;
      }}
      // A move outside gives the keys up; a row that unmounts fires no blur at all.
      // Leaving lets the order go, so the list is drawn fresh on return.
      onBlur={(event) => {
        const inside = panel.current?.contains(event.relatedTarget) === true;
        held.current = inside;
        if (!inside) release();
      }}
      // Focusable but not a tab stop: the cursor row is one; this holds focus until a row exists.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={armed.disarmElsewhere}
      className="flex h-full flex-col bg-k-bg font-sans"
    >
      <TodoHeader
        filter={filter}
        line={narrowing.line}
        onType={(value) => {
          narrowing.type(value);
          setActive(0);
          release();
        }}
        onFiltered={focusList}
        named={narrowing.named}
        coarse={coarse}
        onAdd={onAdd}
        picking={blocker.picking}
        onCancelPick={blocker.cancel}
        mode={mode}
        board={board}
        strip={{
          done: () => strip(() => show("done")),
          next: () => strip(() => show("next")),
          view: () => strip(nextView),
          board: () => strip(toggleBoard),
        }}
        kind={narrowing.kind}
        onKind={(next) => strip(() => pickKind(next))}
        shared={narrowing.shared}
        sharedHidden={facts.sharedHidden}
        onShared={() => strip(flipShared)}
      />

      {board ? (
        <TodoBoard
          ref={boardKeys}
          cards={facts.cards}
          parents={facts.parents}
          named={facts.links.named}
          closed={facts.links.closed}
          progress={facts.progress}
          files={narrowing.files ?? []}
          today={today}
          coarse={coarse}
          held={held}
          onOpen={onOpen}
          onCycle={onCycle}
          onEdit={onEdit}
          onRefile={onRefile}
          onNotice={onNotice}
        />
      ) : (
        <>
          {/* The counts are of the open list, so the legend is drawn only over it. */}
          {mode === "open" && blocker.picking === null && <TodoLegend counts={facts.counts} />}
          <TodoList
            groups={groups}
            empty={empty}
            cursorKey={cursorKey}
            facts={facts}
            today={today}
            coarse={coarse}
            picking={blocker.picking !== null}
            editing={editing}
            onEditing={setEditing}
            draft={draft}
            armed={armed.armed}
            onArm={armed.arm}
            onRow={onRow}
            files={narrowing.files ?? []}
            onPerson={(path) => onOpen(path, 1)}
            onWrite={onEdit}
            onCycle={onCycle}
            actions={actions}
            doneWeek={foldRows}
            doneOpen={doneOpen}
            onDoneFold={() => setDoneOpen(!doneOpen)}
          />
        </>
      )}

      <TodoFooter
        board={board}
        cards={facts.cards.length}
        listed={listed}
        shown={facts.shown}
        timers={facts.timers}
        coarse={coarse}
        picking={blocker.picking !== null}
      />
    </section>
  );
}
