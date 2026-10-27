import { useMemo } from "react";
import type { SearchHit, TodoHit } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { rankLines } from "@/lib/fuzzy";
import { dailyDate } from "@/lib/periodic";
import { isOpen, parseTodo, type Todo, type TodoState } from "@/lib/todo/todo";
import { type Closed, closedAmong } from "@/lib/todo/todo-blocked";
import { kindOf, onBoard } from "@/lib/todo/todo-board";
import type { TodoPriority } from "@/lib/todo/todo-fields";
import { matchesFilter, parseFilter } from "@/lib/todo/todo-shorthand";
import { parseSession, type Session } from "@/lib/todo/todo-time";
import {
  dependentsOf,
  descendants,
  HEADING,
  inherited,
  isClient,
  type Node,
  namedTodos,
  nextActionOf,
  type Placed,
  progressOf,
  SECTIONS,
  sectionOf,
  treeOf,
  waiting,
} from "@/lib/todo/todo-view";

/** One line the vault answered with, read once. A line is one or the other. */
interface Read {
  hit: TodoHit;
  todo: Todo | null;
  session: Session | null;
}

/** One drawn row: the line the vault answered with, and that line read. */
export interface Row {
  hit: TodoHit;
  todo: Todo;
  /** The todo this one is a part of, drawn in front of it where it is not above it. */
  under?: string;
  /** What this hangs off, which decides the indent once the group is known. */
  parent?: Placed;
  /** How many steps in the row is drawn, counted inside its own group. */
  depth?: number;
  /** Done since the list was drawn, and held where it was until the list is asked again. */
  struck?: boolean;
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

/**
 * Where each priority sorts. No priority sits between medium and low, the way
 * obsidian-tasks reads a bare line: a normal task beats one marked down.
 */
const RANK: Record<TodoPriority, number> = { highest: 0, high: 1, medium: 2, low: 4, lowest: 5 };
const NORMAL = 3;

/**
 * One group's rows, the important work first.
 *
 * What sorts is not the rows but the run each one heads: a part whose parent is
 * in this group joins the run above it, so it travels with what holds it
 * whatever its own priority says, and `nest` still meets a parent before its
 * children. Between two runs of one priority, client work goes first: it is a
 * tiebreak and never lifts a run over a higher priority. Stable, so the order
 * the vault answered in decides what is left.
 */
function byPriority(rows: Row[]): Row[] {
  const here = new Set(rows.map((row) => rowKey(row.hit)));
  const runs: Row[][] = [];

  for (const row of rows) {
    const last = runs[runs.length - 1];
    const held = row.parent !== undefined && here.has(`${row.hit.path}:${row.parent.line}`);
    if (held && last !== undefined) last.push(row);
    else runs.push([row]);
  }

  const rank = (run: Row[]) => {
    const priority = run[0]?.todo.priority;
    return priority === undefined ? NORMAL : RANK[priority];
  };
  const internal = (run: Row[]) => (run[0] !== undefined && isClient(run[0].todo) ? 0 : 1);
  return runs.sort((a, b) => rank(a) - rank(b) || internal(a) - internal(b)).flat();
}

/** Which list the pane is showing. `d` and `n` each toggle their own back. */
export type Mode = "open" | "done" | "next";

export function rowKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

/** The rows the filter line keeps, the list's and the board's alike. */
function narrow(rows: Row[], line: string, today: string): Row[] {
  const terms = parseFilter(line);
  const kept = rows.filter(({ todo }) => matchesFilter(todo, terms, today));
  if (terms.text === "") return kept;
  // Whatever was not a term ranks as text, the way it does everywhere else.
  // Here the ranking only decides membership: the sections set the order.
  const reads = new Set(
    rankLines(
      // The names a todo carries are off its words and on its row, so they are
      // ranked with them: typing a name finds what is for that person or waits on them.
      kept.map(({ todo }) => `${todo.text} ${todo.assignee ?? ""} ${todo.waitingOn ?? ""}`),
      terms.text,
    ),
  );
  return kept.filter((_, index) => reads.has(index));
}

/**
 * The kind a row is, read the way the board reads a card: its own tag, else the
 * nearest ancestor's. Walked up the forest the way the lanes walk it, so a part
 * the filter hides still takes its parent's kind.
 */
function kindAt(parents: Map<string, Placed>, hit: TodoHit, todo: Todo): string | null {
  const above: Todo[] = [];
  for (
    let up = parents.get(rowKey(hit));
    up !== undefined;
    up = parents.get(`${hit.path}:${up.line}`)
  ) {
    above.push(up.todo);
  }
  return kindOf(todo, above);
}

/**
 * What a view keeps: the kind the filter names, and the shared lists unless they
 * are hidden, then the filter line. The kind and the shared lists are read off
 * the whole tree before the line narrows anything, so all three hold at once.
 */
function scoped(
  rows: Row[],
  ofKind: (row: Row) => boolean,
  sharedOn: boolean,
  line: string,
  today: string,
): Row[] {
  const kept = rows.filter((row) => ofKind(row) && (sharedOn || row.hit.shared !== true));
  return narrow(kept, line, today);
}

/**
 * How far back `d` reaches, in days.
 *
 * Seven, and read the way `due:<7d` is read, so the seventh day back is already
 * out. A list reaching to the beginning of the vault is not one anybody reads
 * to the end of.
 */
const DONE_DAYS = 7;

/** What the rows are read against: the sessions, the links and the parts' counts. */
export interface RowFacts {
  running: Map<string, string>;
  links: {
    named: ReturnType<typeof namedTodos>;
    closed: Closed;
    dependents: ReturnType<typeof dependentsOf>;
  };
  progress: Map<string, string>;
}

/**
 * Every open todo the vault holds, grouped by when it is due.
 *
 * A third thing a pane can hold, beside a note and a terminal. It asks the
 * vault once and narrows what came back, the way the todo overlay does and for
 * the same reason: what there is to do is a set the vault decides, and the
 * filter line was never choosing the rows. The two share a query key, so
 * opening one after the other reads one answer.
 */
export function useTodoRows(o: {
  data: TodoHit[] | undefined;
  today: string;
  picking: SearchHit | null;
  listed: Mode;
  line: string;
  board: boolean;
  /** The kind the chips name, or null for All. */
  kind: string | null;
  /** Whether the shared lists are shown. */
  shared: boolean;
}): RowFacts & {
  parents: Map<string, Placed>;
  timers: number;
  shown: Row[];
  cards: Row[];
  groups: { heading: string; rows: Row[] }[];
  rows: Row[];
  /** The Done this week fold under the open list: what `d` reads, scoped and narrowed. */
  doneWeek: Row[];
  /** The legend's count per state, of what is shown. */
  counts: Record<TodoState, number>;
  /** How many rows the view would add if the shared lists were shown. */
  sharedHidden: number;
} {
  const { data, today, picking, listed, line, board, kind, shared } = o;

  // Every line the vault answered with, read once. One endpoint answers both
  // shapes, so a line is a todo or a session and never both, and the four memos
  // below read this rather than parsing the same list four times over.
  const parsed = useMemo(
    () =>
      (data ?? []).map((hit): Read => {
        const todo = parseTodo(hit.text);
        return { hit, todo, session: todo === null ? parseSession(hit.text) : null };
      }),
    [data],
  );

  // The forest each note's todos make, and the hit each line arrived on. Both
  // the count on a row and the `n` list are questions about this one tree, and
  // it is read off every todo the vault answered with rather than off the rows
  // on screen: a closed part is exactly what the list above leaves out.
  const forest = useMemo(() => {
    const notes = new Map<string, Placed[]>();
    const hits = new Map<string, TodoHit>();
    for (const { hit, todo } of parsed) {
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
        inherited(treeOf([...lines].sort((one, other) => one.line - other.line))),
      ]),
    );
    // What each todo hangs off, so a row can be drawn under it or, where that
    // one is not on screen, name it, and each todo with what it took off its
    // parent, which is what every row below is drawn and grouped from.
    const parents = new Map<string, Placed>();
    const todos = new Map<string, Todo>();
    for (const [path, roots] of trees) {
      for (const root of roots) {
        for (const node of [root, ...descendants(root)]) {
          todos.set(`${path}:${node.line}`, node.todo);
          for (const child of node.children) parents.set(`${path}:${child.line}`, node);
        }
      }
    }

    return { trees, hits, parents, todos };
  }, [parsed]);

  /** Whether a row is the kind the chips name. All passes every row. */
  const ofKind = useMemo(
    () => (row: Row) => kind === null || kindAt(forest.parents, row.hit, row.todo) === kind,
    [forest, kind],
  );

  // A session line is not work to do, and neither is a finished todo. A todo
  // whose `🛫` has not arrived goes with them: a list of things you cannot start
  // yet is not a list of what to do.
  const open = useMemo(() => {
    const found: Row[] = [];
    for (const { hit, todo } of parsed) {
      // The todo as the tree left it, so a part carrying no date of its own
      // waits, groups and sorts with whatever holds it.
      const full = forest.todos.get(rowKey(hit)) ?? todo;
      if (full === null || !isOpen(full)) continue;
      // A todo that cannot be started yet can still be what another waits for,
      // so the picker lists it.
      if (picking === null && waiting(full, today)) continue;
      found.push({ hit, todo: full, parent: forest.parents.get(rowKey(hit)) });
    }
    return found;
  }, [parsed, today, forest, picking]);

  // What each `⛔` names and what waits for each todo, read off every line the
  // vault answered with: a blocker the filter has hidden still blocks.
  const links = useMemo(() => {
    const todos = parsed.flatMap(({ todo }) => todo ?? []);
    const closed = closedAmong(todos);
    return { named: namedTodos(todos), closed, dependents: dependentsOf(todos, closed) };
  }, [parsed]);

  /**
   * Which todos have a session running, and the day of the oldest one, keyed by
   * id.
   *
   * The pane sums nothing: the `⏱` on the task line is what a row draws, and
   * these lines are read for one thing only, which rows are going and since
   * when. A session outside a daily note is left out for the reason a stop
   * leaves it alone, nothing saying which day it belongs to.
   */
  const running = useMemo(() => {
    const since = new Map<string, string>();
    for (const { hit, session } of parsed) {
      if (session?.end !== undefined || session?.id === undefined) continue;
      const day = dailyDate(hit.path);
      const seen = since.get(session.id);
      if (day !== null && (seen === undefined || day < seen)) since.set(session.id, day);
    }
    return since;
  }, [parsed]);

  /** How many timers are going, which is sessions rather than rows: they run in parallel. */
  const timers = useMemo(
    () =>
      parsed.filter(
        ({ hit, session }) =>
          session !== null && session.end === undefined && dailyDate(hit.path) !== null,
      ).length,
    [parsed],
  );

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
    for (const { hit, todo } of parsed) {
      // The tree's todo for the reason `open` reads it: one list cannot draw a
      // part's inherited date while the other draws it blank.
      const full = forest.todos.get(rowKey(hit)) ?? todo;
      if (full?.done !== undefined && full.done > since) found.push({ hit, todo: full });
    }
    return found;
  }, [parsed, today, forest]);

  const lists = useMemo(
    (): Record<Mode, Row[]> => ({ open, done: finished, next }),
    [open, finished, next],
  );

  const shown = useMemo(
    () => scoped(lists[listed], ofKind, shared, line, today),
    [lists, listed, ofKind, shared, line, today],
  );

  // What `c` draws: the open todos and the ones finished lately, rejected too,
  // each as the tree left it. A todo whose `🛫` has not arrived stays off, as
  // it does in the list. Narrowed after, in `cards`, so the shared count can
  // read the same rows with the lists shown.
  const boardRows = useMemo(() => {
    if (!board) return [];
    const found: Row[] = [];
    for (const { hit, todo } of parsed) {
      const full = forest.todos.get(rowKey(hit)) ?? todo;
      if (full === null || !onBoard(full, today)) continue;
      if (isOpen(full) && waiting(full, today)) continue;
      found.push({ hit, todo: full });
    }
    return found;
  }, [board, parsed, forest, today]);

  const cards = useMemo(
    () => scoped(boardRows, ofKind, shared, line, today),
    [boardRows, ofKind, shared, line, today],
  );

  // The Done this week fold under the open list. Not on the board, which has
  // its own done cards, and not while a blocker is picked: a finished todo is
  // no blocker to pick, so the picker leaves it out.
  const foldShown = listed === "open" && picking === null;
  const doneWeek = useMemo(
    () => (foldShown && !board ? scoped(finished, ofKind, shared, line, today) : []),
    [foldShown, board, finished, ofKind, shared, line, today],
  );

  // Rejected todos the board would draw, for the legend. Read with `onBoard`,
  // as the board reads them, so the count and the cards agree.
  const rejected = useMemo(() => {
    const found: Row[] = [];
    for (const { hit, todo } of parsed) {
      const full = forest.todos.get(rowKey(hit)) ?? todo;
      if (full !== null && full.state === "rejected" && onBoard(full, today)) {
        found.push({ hit, todo: full });
      }
    }
    return scoped(found, ofKind, shared, line, today);
  }, [parsed, forest, today, ofKind, shared, line]);

  const counts = useMemo(() => {
    const found: Record<TodoState, number> = {
      open: 0,
      doing: 0,
      review: 0,
      waiting: 0,
      blocked: 0,
      done: doneWeek.length,
      rejected: rejected.length,
    };
    if (listed === "open") for (const { todo } of shown) found[todo.state] += 1;
    return found;
  }, [shown, listed, doneWeek, rejected]);

  // How many rows the view would add with the shared lists on: the same rows,
  // read twice, once with them and once without. Nothing while they are shown.
  const sharedHidden = useMemo(() => {
    if (shared) return 0;
    const hidden = (rows: Row[]) =>
      scoped(rows, ofKind, true, line, today).length -
      scoped(rows, ofKind, false, line, today).length;
    if (board) return scoped(boardRows, ofKind, true, line, today).length - cards.length;
    const doneHidden = foldShown ? hidden(finished) : 0;
    return hidden(lists[listed]) + doneHidden;
  }, [shared, board, boardRows, cards, lists, listed, foldShown, finished, ofKind, line, today]);

  // The heading is the group's name here, not a lookup at the draw, because
  // `d` groups on a date and there is no table of every day there has been.
  const groups = useMemo(() => {
    if (listed === "done") {
      // Newest day first, which ISO dates sort into by themselves.
      const days = [...new Set(shown.map(({ todo }) => todo.done ?? ""))].sort().reverse();
      return days.map((heading) => ({
        heading,
        rows: shown.filter(({ todo }) => todo.done === heading),
      }));
    }
    return SECTIONS.map((section) => ({
      heading: HEADING[section],
      rows: nest(byPriority(shown.filter((row) => sectionOf(row.todo, today) === section))),
    })).filter((group) => group.rows.length > 0);
  }, [shown, listed, today]);
  // The same rows flattened, because `j` and `k` move down a list and a heading
  // is not a row the cursor can sit on.
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  return {
    running,
    links,
    progress,
    parents: forest.parents,
    timers,
    shown,
    cards,
    groups,
    rows,
    doneWeek,
    counts,
    sharedHidden,
  };
}
