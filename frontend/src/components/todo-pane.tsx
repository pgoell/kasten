import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { type BoardKeys, TodoBoard } from "@/components/todo-board";
import { TodoFooter } from "@/components/todo-footer";
import { TodoHeader } from "@/components/todo-header";
import { TodoList } from "@/components/todo-list";
import { fetchTodos, type SearchHit, type TodoHit } from "@/lib/api";
import type { EditorCommands } from "@/lib/key-bindings";
import type { TodoState } from "@/lib/todo";
import { useArmed } from "@/lib/use-armed";
import { useBlockerPick } from "@/lib/use-blocker-pick";
import { useTodoFilter } from "@/lib/use-todo-filter";
import { useTodoFocus } from "@/lib/use-todo-focus";
import { SET, type TodoKeyActions, useTodoKeys } from "@/lib/use-todo-keys";
import { type Mode, rowKey, useTodoRows } from "@/lib/use-todo-rows";
import { useTodoTwins } from "@/lib/use-todo-twins";
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
   * Walk the row's todo one step on, in the vault, or put it in the state a
   * key named.
   *
   * The hit rather than the todo: the write reads the note off disk again, and
   * the path and the line are how it finds the line to cycle.
   */
  onCycle: (hit: SearchHit, state?: TodoState, twins?: number[]) => void;
  /** Open the prompt that writes a todo into today's note. */
  onAdd: () => void;
  /**
   * Open that same prompt on a row, so what it takes lands as a part of it.
   *
   * The hit for the reason `onCycle` takes one: the part is written into the
   * note the parent lives in, beside the line it hangs off.
   */
  onSubtask: (hit: SearchHit) => void;
  /**
   * Put the line the row was read from back in its note, edited.
   *
   * The hit for the reason `onCycle` takes one, and the line beside it because
   * this is the one press that carries text: what the reader left in the input
   * is what the vault gets.
   */
  onEdit: (hit: SearchHit, line: string) => void;
  /**
   * Say that the first row's todo waits for the second's.
   *
   * Two hits, each for the reason `onCycle` takes one: the write puts a `⛔`
   * on one line and may put an id on the other.
   */
  onBlock: (hit: SearchHit, blocker: SearchHit) => void;
  /**
   * Whether the archive is on the list, which the route holds and one key flips.
   *
   * In the query key as well as the request, so the two readings are two cached
   * answers rather than one that goes stale on a toggle. The search panel keys
   * its own todo query the same way, which is what keeps the pane and the
   * overlay reading one answer.
   */
  archive?: boolean;
  /**
   * Start a session on the row's todo, or close the ones it has running.
   *
   * The hit for the reason `onCycle` takes one: the write reads the note off
   * disk again, and the path and the line are how it finds the task line.
   */
  onTimer: (hit: SearchHit, twins?: number[]) => void;
  /**
   * Tag the row's todo `#agent` for the worker, or take the tag back off.
   *
   * The hit for the reason `onCycle` takes one: the write reads the note off
   * disk again, and the path and the line are how it finds the task line.
   */
  onAgent: (hit: SearchHit, twins?: number[]) => void;
  /**
   * Where this pane puts the row `@` would act on, or null where `@` would do
   * nothing, for the palette's entry of that key to read as it opens.
   *
   * A ref and not a callback, so a move of the cursor renders nothing else.
   * The route hands it only to the focused pane, which is the one the palette
   * opens over.
   */
  cursorRow?: { current: AgentRow | null };
  /**
   * Move the row's todo, with its parts, into its project's note.
   *
   * The `TodoHit` rather than a bare hit, because the project it moves to is
   * the one the backend answered with, never one worked out here. A board
   * card dropped on a project's lane names that project instead.
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
 * Every open todo the vault holds, grouped by when it is due.
 *
 * A third thing a pane can hold, beside a note and a terminal. It asks the
 * vault once and narrows what came back, the way the todo overlay does and for
 * the same reason: what there is to do is a set the vault decides, and the
 * filter line was never choosing the rows. The two share a query key, so
 * opening one after the other reads one answer.
 *
 * The keys are resolved the way `file-explorer.tsx` resolves its own, a pending
 * sequence first, so the leader reaches everything from in here. `<leader>x` is
 * not among them, which is right: there is no buffer under this cursor, and the
 * bare `x` is the key that will act on a row.
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
  /** The board's keys, which the handler below hands it in board mode. */
  const boardKeys = useRef<BoardKeys>(null);
  /**
   * The row being edited and the line as it now stands, or null while none is.
   *
   * The key rather than the hit: the row it belongs to is looked up at the
   * press, and holding the text here is what lets the input be the row itself.
   */
  const [editing, setEditing] = useState<{ key: string; line: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const draft = useRef<HTMLInputElement>(null);
  // A finger has no keys at all, so a touch screen draws each of them as a
  // button: the add, the state, the views and what `⋯` opens under a row.
  const { coarse } = useViewport();
  const armed = useArmed();

  const { data } = useQuery({ queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) });
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
  });

  // Narrowing the list can strand the cursor past the end of it.
  const cursor = Math.min(active, Math.max(facts.rows.length - 1, 0));
  const at = facts.rows[cursor];
  const cursorKey = at === undefined ? "" : rowKey(at.hit);
  const { onCycle, onTimer, onAgent } = useTodoTwins({
    data,
    cycle,
    timer,
    agent,
    cursorRow,
    at,
    idle: board || blocker.picking !== null,
  });

  // The row that has become an input, or nothing while every row is a row. Its
  // own name because the effect below turns on which row it is: typing is not a
  // reason to move the cursor inside it again.
  const editingKey = editing?.key;

  const { held, focusList } = useTodoFocus({
    panel,
    filter,
    draft,
    focusSignal,
    cursorKey,
    rows: facts.rows,
    board,
    editingKey,
  });

  // The three below are what a key and a button both do, so each is said once.

  /** `d` and `n`: swap the list for the one named, or give the open one back. */
  function show(list: Mode) {
    setMode((previous) => (previous === list ? "open" : list));
    setActive(0);
  }

  /** `v`: the next view, writing the note first where the vault has none. */
  function nextView() {
    narrowing.nextView();
    setActive(0);
  }

  /**
   * A click on the strip, then the focus back on the cursor. A browser leaves
   * the focus on the clicked button, which draws the cursor unfocused and
   * turns Space and Enter into another click. The row or card handed it may
   * unmount at once, as `c` does to the list, and the `dropped` effects carry
   * it on from there. The refocus is by mouse only: a finger brings no keys to
   * catch.
   *
   * Nothing at all, by mouse or by finger, while a row is an input or the list
   * is a picker. The input has no blur to close it, so the edit would outlive
   * its row and deafen the pane, and the picker would stay up over a list or a
   * board its Enter and Escape no longer mean what it says.
   */
  function strip(run: () => void) {
    if (editing !== null || blocker.picking !== null) return;
    run();
    if (!coarse) focusList();
  }

  /**
   * `i`: the row becomes its line. By the row's own key, so a tap need not move the cursor.
   *
   * Not while another row is being edited. The keys are off then, and a tap
   * that got through would drop that row's draft unwritten.
   */
  function edit(hit: SearchHit) {
    if (editing !== null) return;
    setEditing({ key: rowKey(hit), line: hit.text });
  }

  function block(hit: SearchHit) {
    if (blocker.block(hit)) setActive(0);
  }

  /** A row opens its note, or is the blocker picked while the list is the picker. */
  function onRow(hit: SearchHit) {
    if (blocker.picking === null) onOpen(hit.path, hit.line);
    else blocker.pick(hit);
  }

  // A state picked out of an open strip is meant, so one tap sets it, as the
  // shifted keys do, with no question asked.
  const actions = (hit: TodoHit): [string, () => void][] => [
    ...Object.values(SET).map((state): [string, () => void] => [state, () => onCycle(hit, state)]),
    ["timer", () => onTimer(hit)],
    ["part", () => onSubtask(hit)],
    ["edit", () => edit(hit)],
    ["blocked by", () => block(hit)],
    ["refile", () => onRefile(hit)],
    ["agent", () => onAgent(hit)],
  ];

  // What each key does here. Each act checks the row it needs, so a key that
  // binds no row (`a`, `d`, `n`) reaches the pane without one.
  const act: TodoKeyActions = {
    toggleBoard: () => setBoard(!board),
    down: () => setActive(Math.min(cursor + 1, facts.rows.length - 1)),
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
      if (at !== undefined) onRefile(at.hit);
    },
    add: () => onAdd(),
    subtask: () => {
      if (at !== undefined) onSubtask(at.hit);
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

  return (
    // The handler sits on the pane, not the rows: the keys act on the row the
    // cursor is on, which is not always the one holding focus.
    <section
      ref={panel}
      aria-label="Todos"
      onFocus={() => {
        held.current = true;
      }}
      // Only a move onto something outside gives the keys up. A row that
      // unmounts fires no blur at all, which is exactly the case above.
      onBlur={(event) => {
        held.current = panel.current?.contains(event.relatedTarget) === true;
      }}
      // Focusable, but not in the tab order: the cursor row is the tab stop,
      // and this is where the focus rests before a row exists to hold it.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={armed.disarmElsewhere}
      className="flex h-full flex-col bg-one-bg font-mono"
    >
      <TodoHeader
        filter={filter}
        line={narrowing.line}
        onType={(value) => {
          narrowing.type(value);
          setActive(0);
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
          board: () => strip(() => setBoard(!board)),
        }}
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
        <TodoList
          groups={facts.groups}
          empty={
            facts.rows.length === 0
              ? listed === "done"
                ? "nothing finished"
                : "nothing to do"
              : null
          }
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
          onWrite={onEdit}
          onCycle={onCycle}
          actions={actions}
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
      />
    </section>
  );
}
