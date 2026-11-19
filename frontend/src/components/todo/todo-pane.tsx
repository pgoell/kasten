import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type BoardKeys, TodoBoard } from "@/components/todo/todo-board";
import { TodoFooter } from "@/components/todo/todo-footer";
import { TodoHeader } from "@/components/todo/todo-header";
import { type Editing, TodoList } from "@/components/todo/todo-list";
import { fetchTodos, type SearchHit, type TodoHit } from "@/lib/core/api";
import type { TodoState } from "@/lib/todo/todo";
import { noteLineOf } from "@/lib/todo/todo-api";
import { aimAgain, aimOf, cursorAfter } from "@/lib/todo/todo-hold";
import { followRow, twinsOf } from "@/lib/todo/todo-press-echo";
import { useArmed } from "@/lib/todo/use-armed";
import { useBlockerPick } from "@/lib/todo/use-blocker-pick";
import { useTodoFilter } from "@/lib/todo/use-todo-filter";
import { useTodoFocus } from "@/lib/todo/use-todo-focus";
import { useTodoHold } from "@/lib/todo/use-todo-hold";
import { SET, type TodoKeyActions, useTodoKeys } from "@/lib/todo/use-todo-keys";
import { type Mode, type Row, rowKey, useTodoRows } from "@/lib/todo/use-todo-rows";
import { useTodoTwins } from "@/lib/todo/use-todo-twins";
import { useViewport } from "@/lib/ui/input/use-viewport";
import type { EditorCommands } from "@/lib/ui/keys/key-bindings";

/** The row an edit opened on, by its key, and the words it was typed over. */
function editAt(editing: Editing) {
  const cut = editing.key.lastIndexOf(":");
  return {
    path: editing.key.slice(0, cut),
    line: Number(editing.key.slice(cut + 1)),
    text: editing.from,
  };
}

function editOf(hit: SearchHit, line: string, rows: Row[]): Editing {
  const twins = twinsOf(
    hit,
    rows.map((row) => row.hit),
  );
  return { key: rowKey(hit), line, from: hit.text, twins };
}

/** One empty list for every render, so a row that compares its props sees no change. */
const NO_FILES: string[] = [];

/** The row the pane's `@` acts on, with its twins where it has any. */
export interface AgentRow {
  hit: SearchHit;
  twins?: number[];
}

interface TodoPaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  onOpen: (path: string, line?: number) => void;
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
   * what the input holds is what the vault gets. Answers whether it wrote.
   */
  onEdit: (hit: SearchHit, line: string) => Promise<boolean>;
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
  onOpen: openLine,
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
  const queryClient = useQueryClient();
  /** Opens a row's note on its todo's embed: a listed line counts the note's todos. */
  const onOpen = (path: string, line: number) => {
    const at = noteLineOf(queryClient, path, line);
    if (typeof at === "number") openLine(path, at);
    // A note that will not read still opens, at its top.
    else
      void at.then(
        (found) => openLine(path, found),
        () => openLine(path, 1),
      );
  };
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
  const [editing, setEditing] = useState<Editing | null>(null);
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const draft = useRef<HTMLInputElement>(null);
  // A finger has no keys, so a touch screen draws each of them as a button.
  const { coarse } = useViewport();

  const { data: answer } = useQuery({
    queryKey: ["todos", archive],
    queryFn: () => fetchTodos(archive),
  });
  // Deferred so a long answer renders in yielding passes (#1355). Every reader takes
  // this value, so the hold and twins keep step with the rows.
  const data = useDeferredValue(answer);
  const narrowing = useTodoFilter();
  // Undefined only while the list loads: a failed one leaves each chip dashed, not waiting (#2124).
  const paths = narrowing.files ?? (narrowing.filesFailed ? NO_FILES : undefined);
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

  /** The rows and cursor as last drawn, and the rows to land on once a settled hold lets go. */
  const drawn = useRef<{ rows: Row[]; cursor: number; open: number }>({
    rows: [],
    cursor: 0,
    open: 0,
  });
  const follow = useRef<{ keys: string[]; inFold: boolean } | null>(null);

  // The order the rows are drawn in, held while a press is being read.
  const { groups, groupRows, foldRows, pressing, release, holding, ids } = useTodoHold({
    data,
    current: facts.groups,
    doneWeek: facts.doneWeek,
    listed,
    board,
    doneOpen,
    onSettle: () => {
      const { rows: before, cursor: was, open } = drawn.current;
      follow.current = {
        keys: before.slice(was).map((row) => rowKey(row.hit)),
        inFold: was >= open,
      };
    },
  });
  // What `j` and `k` walk: the groups, and the Done this week rows once their
  // fold is open. A folded row is not on screen, so the cursor does not stop on it.
  const rows = useMemo(
    () => (doneOpen ? [...groupRows, ...foldRows] : groupRows),
    [groupRows, doneOpen, foldRows],
  );
  const armed = useArmed(useMemo(() => rows.map((row) => row.hit), [rows]));

  // Narrowing the list can strand the cursor past the end of it.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));
  const at = rows[cursor];
  const cursorKey = at === undefined ? "" : rowKey(at.hit);
  drawn.current = { rows, cursor, open: groupRows.length };

  // An open edit stays on its todo when a redraw moves its line, or closes keeping its text in the notice (#2087).
  const edited =
    editing === null
      ? undefined
      : followRow(
          editAt(editing),
          editing.twins,
          rows.map((row) => row.hit),
        );
  if (editing !== null && edited && rowKey(edited) !== editing.key) {
    setEditing({ ...editing, key: rowKey(edited) });
  }
  const lost = edited === null ? editing?.line : undefined;
  useEffect(() => {
    if (lost === undefined) return;
    setEditing(null);
    onNotice(`Nothing moved: that line left the list while it was edited. The edit read: ${lost}`);
  }, [lost, onNotice]);

  // Done rows leave as the hold lets go, so the cursor follows its row rather than its place,
  // or the first row under it that stays where its own row left.
  useLayoutEffect(() => {
    const from = follow.current;
    if (from === null) return;
    follow.current = null;
    const keysOf = (each: Row[]) => each.map((row) => rowKey(row.hit));
    const found = cursorAfter(from, keysOf(groupRows), keysOf(rows));
    if (found !== undefined) setActive(found);
  }, [groupRows, rows]);
  // While a press holds the order, a row that arrives above the cursor's row pushes it down,
  // so the cursor follows its row, not its index (#2001). A key moves `active` and is left be.
  const aimed = useRef<{ rows: Row[]; active: number; aim?: { id: string; key: string } }>({
    rows,
    active,
  });
  useLayoutEffect(() => {
    const was = aimed.current;
    aimed.current = { rows, active, aim: aimOf(at, ids) };
    if (!holding || was.rows === rows || was.active !== active || was.aim === undefined) return;
    const found = aimAgain(was.aim, rows, ids);
    if (found !== undefined && found !== cursor) setActive(found);
  }, [rows, active, at, ids, holding, cursor]);
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

  // The words it was typed over, which neither typing nor a follow changes, so neither re-runs the focus effect.
  const editingKey = editing?.from;

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
    setEditing(editOf(hit, hit.text, rows));
  }

  /** Enter on the edit row. A refused or failed edit opens the row again on what was typed (#2087). */
  function write(hit: SearchHit, line: string) {
    void onEdit(hit, line).then((wrote) => {
      if (!wrote) setEditing((open) => open ?? editOf(hit, line, drawn.current.rows));
    });
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
          files={paths}
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
          files={paths}
          onPerson={(path) => openLine(path, 1)}
          onWrite={write}
          onCycle={onCycle}
          actions={actions}
          doneWeek={foldRows}
          doneOpen={doneOpen}
          onDoneFold={() => setDoneOpen(!doneOpen)}
        />
      )}

      <TodoFooter
        board={board}
        cards={facts.cards.length}
        listed={listed}
        shown={facts.shown}
        timers={facts.timers}
        coarse={coarse}
        picking={blocker.picking !== null}
        counts={facts.counts}
      />
    </section>
  );
}
