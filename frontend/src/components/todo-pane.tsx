import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTodos, type SearchHit } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { rankLines } from "@/lib/fuzzy";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import { INPUT, LABEL, ROW } from "@/lib/overlay-styles";
import { isOpen, PRIORITY_SYMBOL, parseTodo, STATE_SYMBOL, type Todo } from "@/lib/todo";
import { matchesFilter, parseFilter } from "@/lib/todo-shorthand";
import {
  descendants,
  HEADING,
  type Node,
  nextActionOf,
  type Placed,
  progressOf,
  SECTIONS,
  sectionOf,
  treeOf,
  waiting,
} from "@/lib/todo-view";

/** One drawn row: the line the vault answered with, and that line read. */
interface Row {
  hit: SearchHit;
  todo: Todo;
  /** The todo this one is a part of, drawn in front of it where it is not above it. */
  under?: string;
  /** What this hangs off, which decides the indent once the group is known. */
  parent?: Placed;
  /** How many steps in the row is drawn, counted inside its own group. */
  depth?: number;
}

/**
 * Where each row of one group sits: a step in under whatever it hangs off, or
 * back at the edge naming it.
 *
 * Read inside the group rather than off the todo's own indent, because a part
 * can land in a group its parent is not in: a `📅` of its own puts it there,
 * and a parent that is done is not on this list at all. Drawing such a row
 * indented would hang it off whichever row happens to sit above it, which is a
 * lie about the note. So it goes back to the edge and names its parent instead.
 *
 * One pass is enough: a part is always further down its note than what holds
 * it, and the rows of a group keep the order the vault answered in.
 */
function nest(rows: Row[]): Row[] {
  const depth = new Map<string, number>();

  return rows.map((row) => {
    const above =
      row.parent === undefined ? undefined : depth.get(`${row.hit.path}:${row.parent.line}`);
    depth.set(rowKey(row.hit), above === undefined ? 0 : above + 1);

    // `n` names the todo its row is an action on, and keeps that name here.
    return above === undefined
      ? { ...row, depth: 0, under: row.under ?? row.parent?.todo.text }
      : { ...row, depth: above + 1 };
  });
}

/** How far one step of nesting shifts a row, in `rem`, past the list's own padding. */
const STEP = 1.1;

/** The padding `ROW` carries, which a nested row has to start from. */
const GUTTER = 0.75;

/** Which list the pane is showing. `d` and `n` each toggle their own back. */
type Mode = "open" | "done" | "next";

function rowKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

/** The keyboard cursor, drawn the way the file tree draws its own. */
const CURSOR = [
  "outline-1 -outline-offset-1 outline-one-cursor/45",
  "focus:outline-2 focus:outline-one-cursor focus:bg-one-cursor/15",
].join(" ");

interface TodoPaneProps {
  /** Reached by a leader sequence typed here, so every leader key still works. */
  commands: EditorCommands;
  onOpen: (path: string, line: number) => void;
  /**
   * Walk the row's todo one step on, in the vault.
   *
   * The hit rather than the todo: the write reads the note off disk again, and
   * the path and the line are how it finds the line to cycle.
   */
  onCycle: (hit: SearchHit) => void;
  /** Open the prompt that writes a todo into today's note. */
  onAdd: () => void;
  /** Raised by the route when this pane has been moved to. See `Editor`. */
  focusSignal: number;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
}

/**
 * How far back `d` reaches, in days.
 *
 * Seven, and read the way `due:<7d` is read, so the seventh day back is already
 * out. A list reaching to the beginning of the vault is not one anybody reads
 * to the end of.
 */
const DONE_DAYS = 7;

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
export function TodoPane({ commands, onOpen, onCycle, onAdd, focusSignal, today }: TodoPaneProps) {
  const [typed, setTyped] = useState("");
  /** Which row the keys act on. */
  const [active, setActive] = useState(0);
  /** Which list is drawn: the open todos, `d`'s finished ones, or `n`'s actions. */
  const [mode, setMode] = useState<Mode>("open");
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  /** Whether the keys are ours, so a row that leaves can hand them back. */
  const held = useRef(false);

  const { data } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });

  // The forest each note's todos make, and the hit each line arrived on. Both
  // the count on a row and the `n` list are questions about this one tree, and
  // it is read off every todo the vault answered with rather than off the rows
  // on screen: a closed part is exactly what the list above leaves out.
  const forest = useMemo(() => {
    const notes = new Map<string, Placed[]>();
    const hits = new Map<string, SearchHit>();
    for (const hit of data ?? []) {
      const todo = parseTodo(hit.text);
      if (todo === null) continue;
      const lines = notes.get(hit.path) ?? [];
      lines.push({ line: hit.line, todo });
      notes.set(hit.path, lines);
      hits.set(rowKey(hit), hit);
    }

    // By line, because the tree is read off the order the note holds them in
    // and rg answers a note's hits in whatever order it found them.
    const trees = new Map(
      [...notes].map(([path, lines]): [string, Node[]] => [
        path,
        treeOf([...lines].sort((one, other) => one.line - other.line)),
      ]),
    );
    // What each todo hangs off, so a row can be drawn under it or, where that
    // one is not on screen, name it.
    const parents = new Map<string, Placed>();
    for (const [path, roots] of trees) {
      for (const root of roots) {
        for (const node of [root, ...descendants(root)]) {
          for (const child of node.children) parents.set(`${path}:${child.line}`, node);
        }
      }
    }

    return { trees, hits, parents };
  }, [data]);

  // The endpoint matches the shape of a checkbox and nothing else, so reading
  // each line is what drops the `## Time` sessions and the finished todos. A
  // todo whose `🛫` has not arrived goes with them: a list of things you cannot
  // start yet is not a list of what to do.
  const open = useMemo(() => {
    const found: Row[] = [];
    for (const hit of data ?? []) {
      const todo = parseTodo(hit.text);
      if (todo === null || !isOpen(todo) || waiting(todo, today)) continue;
      found.push({ hit, todo, parent: forest.parents.get(rowKey(hit)) });
    }
    return found;
  }, [data, today, forest]);

  /** `3/5` for every row that has parts, keyed by the row it belongs to. */
  const progress = useMemo(() => {
    const labels = new Map<string, string>();
    for (const [path, roots] of forest.trees) {
      for (const root of roots) {
        for (const node of [root, ...descendants(root)]) {
          const count = progressOf(node);
          if (count !== null) labels.set(`${path}:${node.line}`, `${count.closed}/${count.total}`);
        }
      }
    }
    return labels;
  }, [forest]);

  // What `n` shows: one row per open top level todo, naming the one thing that
  // could be started on it. A todo with no parts is its own next action, so a
  // flat list reads here exactly as it does out of this mode.
  const next = useMemo(() => {
    const found: Row[] = [];
    for (const [path, roots] of forest.trees) {
      for (const root of roots) {
        if (!isOpen(root.todo)) continue;
        const action = nextActionOf(root, today);
        const hit = action === null ? undefined : forest.hits.get(`${path}:${action.line}`);
        if (action === null || hit === undefined) continue;
        found.push({
          hit,
          todo: action.todo,
          under: action.line === root.line ? undefined : root.todo.text,
        });
      }
    }
    return found;
  }, [forest, today]);

  // What `d` shows. Grouped on the day it was finished rather than on the day
  // it was due: a finished todo has no due date worth grouping on.
  const finished = useMemo(() => {
    const since = shiftDay(today, -DONE_DAYS);
    const found: Row[] = [];
    for (const hit of data ?? []) {
      const todo = parseTodo(hit.text);
      if (todo?.done !== undefined && todo.done > since) found.push({ hit, todo });
    }
    return found;
  }, [data, today]);

  const shown = useMemo(() => {
    const terms = parseFilter(typed);
    const lists: Record<Mode, Row[]> = { open, done: finished, next };
    const kept = lists[mode].filter(({ todo }) => matchesFilter(todo, terms, today));
    if (terms.text === "") return kept;
    // Whatever was not a term ranks as text, the way it does everywhere else.
    // Here the ranking only decides membership: the sections set the order.
    const reads = new Set(
      rankLines(
        kept.map(({ todo }) => todo.text),
        terms.text,
      ),
    );
    return kept.filter((_, index) => reads.has(index));
  }, [open, finished, next, mode, typed, today]);

  // The heading is the group's name here, not a lookup at the draw, because
  // `d` groups on a date and there is no table of every day there has been.
  const groups = useMemo(() => {
    if (mode === "done") {
      // Newest day first, which ISO dates sort into by themselves.
      const days = [...new Set(shown.map(({ todo }) => todo.done ?? ""))].sort().reverse();
      return days.map((heading) => ({
        heading,
        rows: shown.filter(({ todo }) => todo.done === heading),
      }));
    }
    return SECTIONS.map((section) => ({
      heading: HEADING[section],
      rows: nest(shown.filter((row) => sectionOf(row.todo, today) === section)),
    })).filter((group) => group.rows.length > 0);
  }, [shown, mode, today]);
  // The same rows flattened, because `j` and `k` move down a list and a heading
  // is not a row the cursor can sit on.
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  // Narrowing the list can strand the cursor past the end of it.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));
  const at = rows[cursor];
  const cursorKey = at === undefined ? "" : rowKey(at.hit);

  const blocked = shown.filter(({ todo }) => todo.state === "blocked").length;

  // Arriving from another pane, which unmounted whatever held the focus, so
  // nothing but this can take it. The section rather than a row: the rows come
  // with the query a render later, and the effect below moves the focus onto
  // one the moment they do. It is also the only thing left to focus when there
  // is nothing to do, and `q` has to work on an empty list.
  //
  // Unlike `file-explorer.tsx`, which guards its first render, this pane mounts
  // when it is moved to, so its first render is the arrival.
  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  // Only when the keys are already ours, and never while the filter holds them:
  // typing narrows the list, which moves the cursor, and following it would
  // pull the focus out of the input mid-word.
  //
  // `dropped` is the case `contains` cannot see. `x` writes, the list is asked
  // again, and the row the cursor was on leaves it. The browser hands the focus
  // to the body rather than to whatever replaced the row, so without this the
  // first thing you tick off leaves the pane deaf to every key after it.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const dropped = held.current && document.activeElement === document.body;
    if (!dropped && !element.contains(document.activeElement)) return;
    if (document.activeElement === filter.current) return;
    (element.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`) ?? element).focus();
  }, [cursorKey]);

  /** Hand the focus back to the list, which is where the keys below act. */
  function focusList() {
    const element = panel.current;
    // The section when there is no row to land on, so the keys still reach it.
    (element?.querySelector<HTMLElement>('[tabindex="0"]') ?? element)?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing into the filter is not the list's keys: `j` there is a letter.
    if (event.target === filter.current) return;
    const { key } = event;

    if (pending) {
      const sequence = pending + key;
      const wanted = sequence.slice(1);
      const binding = LEADER.find((entry) => entry.key === wanted);
      // A leader key can be more than one letter, so a sequence that still
      // prefixes one waits for the rest instead of being dropped.
      const partial = !binding && LEADER.some((entry) => entry.key.startsWith(wanted));
      setPending(partial ? sequence : "");

      if (binding) {
        event.preventDefault();
        // With no argument, every one of them: no row here names a note the
        // way the file tree's cursor does.
        commands[binding.command]();
      }
      return;
    }

    switch (key) {
      case "j":
        setActive(Math.min(cursor + 1, rows.length - 1));
        break;
      case "k":
        setActive(Math.max(cursor - 1, 0));
        break;
      case " ":
        setPending(key);
        break;
      case "Enter":
        if (at !== undefined) onOpen(at.hit.path, at.hit.line);
        break;
      // The editor's `<leader>x` said without the leader, which a pane holding
      // no buffer has no need of.
      case "x":
        if (at !== undefined) onCycle(at.hit);
        break;
      // The one key here that writes a note nothing on screen names: the todo
      // goes into today's, wherever the cursor happens to be sitting.
      case "a":
        onAdd();
        break;
      // One field rather than a boolean each: `d` and `n` swap the same list,
      // and two flags could both be on.
      case "d":
        setMode((previous) => (previous === "done" ? "open" : "done"));
        setActive(0);
        break;
      case "n":
        setMode((previous) => (previous === "next" ? "open" : "next"));
        setActive(0);
        break;
      // What vim spells a narrowing. `j` and `k` have to go on moving the
      // cursor, so the input cannot hold the focus by default.
      case "/":
        filter.current?.focus();
        break;
      case "q":
        commands.closeNote();
        break;
      case "Escape":
        // The editor is the only other place the focus belongs, and it owns no
        // React handle here, so the pane finds it the way the reader sees it.
        document.querySelector<HTMLElement>(".cm-content")?.focus();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

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
      className="flex h-full flex-col bg-one-bg font-mono"
    >
      <header className="flex items-center gap-3 border-b border-one-line px-3 py-1">
        <span className={LABEL}>todos</span>
        <input
          ref={filter}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setActive(0);
          }}
          // Both ways out of the input, and both leave the filter applied.
          onKeyDown={(event) => {
            if (event.key !== "Escape" && event.key !== "Enter") return;
            event.preventDefault();
            focusList();
          }}
          aria-label="filter todos"
          autoComplete="off"
          spellCheck={false}
          className={INPUT}
        />
      </header>

      <div className="flex-1 overflow-auto py-1">
        {rows.length === 0 ? (
          <p className="px-3 py-1 text-[13px] text-one-muted">
            {mode === "done" ? "nothing finished" : "nothing to do"}
          </p>
        ) : (
          groups.map(({ heading, rows: group }) => (
            <div key={heading}>
              <h3 className="px-3 pt-2 pb-1 text-[11px] tracking-wider text-one-muted uppercase">
                {heading}
              </h3>
              {group.map(({ hit, todo, under, depth }) => {
                const key = rowKey(hit);
                // One tab stop for the whole pane: tab reaches the cursor, and
                // the vim keys move it from there.
                const tabIndex = key === cursorKey ? 0 : -1;

                return (
                  <button
                    key={key}
                    type="button"
                    data-row={key}
                    tabIndex={tabIndex}
                    onClick={() => onOpen(hit.path, hit.line)}
                    title={key}
                    // A step in per level of nesting, so the list reads the way
                    // the note does. `ROW` carries the first one as padding.
                    style={{ paddingLeft: `${GUTTER + (depth ?? 0) * STEP}rem` }}
                    // A blocked row is drawn muted rather than gathered under a
                    // heading of its own: its state is written on the line, and
                    // the date group is still where the work belongs.
                    className={`${ROW} flex gap-2 ${
                      todo.state === "blocked" ? "text-one-muted" : "text-one-fg"
                    } ${tabIndex === 0 ? CURSOR : ""}`}
                  >
                    <span className="shrink-0">{STATE_SYMBOL[todo.state]}</span>
                    {/* Between the state and the words, where the spec's mock
                        puts it, and absent rather than blank on a row that
                        carries none. */}
                    {todo.priority !== undefined && (
                      <span className="shrink-0">{PRIORITY_SYMBOL[todo.priority]}</span>
                    )}
                    {/* What this is a part of, in front of the part itself, so
                        a next action reads as work on something. Muted: the row
                        is about the action, and this says where it sits. */}
                    {under !== undefined && (
                      <span className="max-w-[40%] shrink-0 truncate text-one-muted">{under}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{todo.text}</span>
                    {/* Between the words and the date, where the spec's mock
                        puts it, and out of the truncation for the reason the
                        date is: it is the shortest thing on the row. */}
                    {progress.has(key) && (
                      <span className="shrink-0 text-one-muted">{progress.get(key)}</span>
                    )}
                    {/* Out of the truncation, so a long todo loses its words
                        rather than the date they are due on. The year is cut
                        from a date inside this one, where every row shares it,
                        and kept on any other: `Later` reaches years out, and
                        two rows reading `01-01` say nothing about which is
                        sooner. */}
                    {todo.due !== undefined && (
                      <span className="shrink-0 text-one-muted">
                        {todo.due.startsWith(today.slice(0, 4)) ? todo.due.slice(5) : todo.due}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Only the keys this phase binds. A footer offering one that does
          nothing is worse than a short one. */}
      <footer
        data-testid="todo-footer"
        className="flex justify-between gap-3 border-t border-one-line px-3 py-1 text-[11px] text-one-muted"
      >
        <span>
          {mode === "done" ? (
            `${shown.length} finished`
          ) : (
            <>
              {shown.length - blocked} open, {blocked} blocked
            </>
          )}
        </span>
        <span>
          x cycle&ensp;&ensp;a add&ensp;&ensp;d done&ensp;&ensp;n next&ensp;&ensp;/
          filter&ensp;&ensp;q close&ensp;&ensp;Escape editor
        </span>
      </footer>
    </section>
  );
}
