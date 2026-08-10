import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createNote, fetchFiles, fetchNote, fetchTodos, type SearchHit } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { rankLines } from "@/lib/fuzzy";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import { INPUT, LABEL, ROW } from "@/lib/overlay-styles";
import { dailyDate } from "@/lib/periodic";
import {
  isOpen,
  PRIORITY_SYMBOL,
  parseTodo,
  STATE_SYMBOL,
  type Todo,
  type TodoState,
} from "@/lib/todo";
import { matchesFilter, parseFilter } from "@/lib/todo-shorthand";
import { parseSession, type Session } from "@/lib/todo-time";
import {
  DEFAULT_VIEWS,
  descendants,
  HEADING,
  type Node,
  nextActionOf,
  type Placed,
  parseViews,
  progressOf,
  SECTIONS,
  sectionOf,
  treeOf,
  VIEWS_NOTE,
  waiting,
} from "@/lib/todo-view";

/** One line the vault answered with, read once. A line is one or the other. */
interface Read {
  hit: SearchHit;
  todo: Todo | null;
  session: Session | null;
}

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

/** The state each shifted key names. `p` for in progress, `d` being spent. */
const SET: Record<string, TodoState> = {
  O: "open",
  P: "doing",
  X: "done",
  B: "blocked",
  R: "rejected",
};

function rowKey(hit: SearchHit): string {
  return `${hit.path}:${hit.line}`;
}

/**
 * The mark a row with a timer going carries, and nothing where none is.
 *
 * The day comes with it where the session was opened on an earlier one, which
 * is how a timer nobody stopped is drawn as unstopped. The year is left off:
 * every other date on a row is cut the same way.
 */
function timerMark(day: string | undefined, today: string): string | null {
  if (day === undefined) return null;
  return day === today ? "▶" : `▶ ${day.slice(5)}`;
}

/** What a row says about the two clocks: worked, estimated, both or neither. */
function clocks(todo: Todo): string | null {
  if (todo.worked !== undefined && todo.estimate !== undefined) {
    return `⏱ ${todo.worked} / ${todo.estimate}`;
  }
  if (todo.worked !== undefined) return `⏱ ${todo.worked}`;
  if (todo.estimate !== undefined) return `⏲ ${todo.estimate}`;
  return null;
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
   * Walk the row's todo one step on, in the vault, or put it in the state a
   * key named.
   *
   * The hit rather than the todo: the write reads the note off disk again, and
   * the path and the line are how it finds the line to cycle.
   */
  onCycle: (hit: SearchHit, state?: TodoState) => void;
  /** Open the prompt that writes a todo into today's note. */
  onAdd: () => void;
  /**
   * Put the line the row was read from back in its note, edited.
   *
   * The hit for the reason `onCycle` takes one, and the line beside it because
   * this is the one press that carries text: what the reader left in the input
   * is what the vault gets.
   */
  onEdit: (hit: SearchHit, line: string) => void;
  /**
   * Start a session on the row's todo, or close the ones it has running.
   *
   * The hit for the reason `onCycle` takes one: the write reads the note off
   * disk again, and the path and the line are how it finds the task line.
   */
  onTimer: (hit: SearchHit) => void;
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
export function TodoPane({
  commands,
  onOpen,
  onCycle,
  onAdd,
  onEdit,
  onTimer,
  focusSignal,
  today,
}: TodoPaneProps) {
  const [typed, setTyped] = useState("");
  /** Whether `v` has been pressed, which is what asks the vault for the views. */
  const [asked, setAsked] = useState(false);
  /** How many times `v` has been pressed. Which view that is, is read below. */
  const [picked, setPicked] = useState(0);
  /** Which row the keys act on. */
  const [active, setActive] = useState(0);
  /** Which list is drawn: the open todos, `d`'s finished ones, or `n`'s actions. */
  const [mode, setMode] = useState<Mode>("open");
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
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
  /** Whether the keys are ours, so a row that leaves can hand them back. */
  const held = useRef(false);
  /** Set as a create goes out, so a second press does not send another. */
  const making = useRef(false);
  const queryClient = useQueryClient();

  const { data } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });

  // The listing is already in the cache, put there by the route, so this asks
  // whether the vault holds the views note without a request, and without a
  // `try` around a `GET` that would have to tell a missing note from a backend
  // that is down.
  const { data: files } = useQuery({ queryKey: ["files"], queryFn: fetchFiles });
  const missing = files !== undefined && !files.includes(VIEWS_NOTE);

  const { data: note, isFetching: reading } = useQuery({
    queryKey: ["note", VIEWS_NOTE],
    queryFn: () => fetchNote(VIEWS_NOTE),
    // Not on every pane open: most of them never reach a view, and the key is
    // the one the editor reads notes with, so the answer is shared and the
    // route's event handler keeps it fresh.
    enabled: asked && files !== undefined && !missing,
    // A note that is not there is an answer, not a blip.
    retry: false,
  });
  const views = useMemo(() => parseViews(note ?? ""), [note]);

  // Off the count rather than off a stored index: the press that starts the
  // read happens with no views in hand, and this resolves it the moment they
  // arrive. The slot past the last view is no view at all, which is how one
  // more press gives the whole list back.
  const slot = views.length === 0 ? 0 : picked % (views.length + 1);
  const view = slot === 0 ? undefined : views[slot - 1];
  /** What the list is filtered by: the view where one is showing, else what was typed. */
  const line = view?.filter ?? typed;
  // One slot for two answers, which cannot both be true. `no views` is the last
  // resort, for a note holding no line this can read and for a create the vault
  // refused: a key that does nothing and says nothing reads as broken.
  const named = view?.name ?? (asked && !reading && views.length === 0 ? "no views" : undefined);

  /**
   * Write the note the vault has none of, holding the defaults.
   *
   * From the key rather than from a `queryFn`: a write in there runs again on
   * every refetch, and react-query refetches on window focus. `picked` is
   * already 1 by the time this lands, so the press that made the note is the
   * press that shows its first view.
   */
  function makeViews() {
    making.current = true;
    void createNote(VIEWS_NOTE, DEFAULT_VIEWS).then(
      (made) => {
        // What the read would have answered with. It stays disabled until the
        // listing catches up, and a disabled query still reads its cache, so
        // seeding the key is what puts the new views on this press.
        queryClient.setQueryData(["note", VIEWS_NOTE], made.content);
        // The tree gains a note. `/api/events` says so too; this is the braces.
        void queryClient.invalidateQueries({ queryKey: ["files"] });
      },
      () => {
        // The vault refused it. The header says `no views`, and the next press
        // asks again, which is what the flag going back down is for.
        making.current = false;
      },
    );
  }

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
    const hits = new Map<string, SearchHit>();
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
  }, [parsed]);

  // A session line is not work to do, and neither is a finished todo. A todo
  // whose `🛫` has not arrived goes with them: a list of things you cannot start
  // yet is not a list of what to do.
  const open = useMemo(() => {
    const found: Row[] = [];
    for (const { hit, todo } of parsed) {
      if (todo === null || !isOpen(todo) || waiting(todo, today)) continue;
      found.push({ hit, todo, parent: forest.parents.get(rowKey(hit)) });
    }
    return found;
  }, [parsed, today, forest]);

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
      if (todo?.done !== undefined && todo.done > since) found.push({ hit, todo });
    }
    return found;
  }, [parsed, today]);

  const shown = useMemo(() => {
    const terms = parseFilter(line);
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
  }, [open, finished, next, mode, line, today]);

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

  /**
   * Hand the focus back to the list, which is where the keys below act.
   *
   * Wrapped because an effect calls it too, and it reads nothing but refs, so
   * one instance stands for the life of the pane.
   */
  const focusList = useCallback(() => {
    const element = panel.current;
    // The section when there is no row to land on, so the keys still reach it.
    (element?.querySelector<HTMLElement>('[tabindex="0"]') ?? element)?.focus();
  }, []);

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
  //
  // On the rows as well as on the cursor, because a redraw can unmount the row
  // the focus is on without moving the cursor off it: an edit that gives a todo
  // a date moves its row to another group, which is a different element for the
  // same `path:line`.
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rows` is the trigger and not a value this reads. That the list redrew is exactly what says the row holding the focus may be gone.
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const dropped = held.current && document.activeElement === document.body;
    if (!dropped && !element.contains(document.activeElement)) return;
    // An input holding the keys keeps them. Both are typed into while the list
    // under them can move: the filter narrows it, and the vault can answer
    // mid-edit.
    if (document.activeElement === filter.current) return;
    if (document.activeElement === draft.current) return;
    (element.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`) ?? element).focus();
  }, [cursorKey, rows]);

  // The row that has become an input, or nothing while every row is a row. Its
  // own name because the effect below turns on which row it is: typing is not a
  // reason to move the cursor inside it again.
  const editingKey = editing?.key;

  // The row has just become an input, so the keys go to it rather than to the
  // list the row was a row of, and back to the row when it is a row again.
  //
  // Here rather than in the key that closes it, because at the press the input
  // is still what is drawn: the row it goes back to does not exist until this
  // render. Off `held` rather than off what has the focus, for the reason the
  // effect above reads `dropped`: an input that unmounts fires no blur, so the
  // browser has already left the focus on the body by now. Only when the keys
  // were ours, so a mount cannot take them from another pane.
  useEffect(() => {
    if (editingKey === undefined) {
      if (held.current) focusList();
      return;
    }

    draft.current?.focus();
    // At the end rather than over the whole line: an edit starts on a line that
    // is already right in the middle, and one keystroke onto a selected line
    // would wipe it.
    const at = draft.current?.value.length ?? 0;
    draft.current?.setSelectionRange(at, at);
  }, [editingKey, focusList]);

  function onKeyDown(event: React.KeyboardEvent) {
    // Typing into an input is not the list's keys: `j` in one is a letter. The
    // filter is one, the row being edited is the other, and the pane holds no
    // third.
    if (event.target instanceof HTMLInputElement) return;
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
      // One key per state, shifted so every lowercase key keeps its meaning.
      // The walk cannot reach blocked or rejected from here: a row leaves this
      // list the moment it is done, and these are how you get to them.
      case "O":
      case "P":
      case "X":
      case "B":
      case "R":
        if (at !== undefined) onCycle(at.hit, SET[key]);
        break;
      // One key for both ends of a session: what the press does depends on
      // whether the vault holds an open one, which only the write can see.
      case "t":
        if (at !== undefined) onTimer(at.hit);
        break;
      // The one key here that writes a note nothing on screen names: the todo
      // goes into today's, wherever the cursor happens to be sitting.
      case "a":
        onAdd();
        break;
      // vim's own key for starting to type where the cursor is. The line is
      // the whole record, so the row becomes that line and you edit it there.
      case "i":
        if (at !== undefined) setEditing({ key: cursorKey, line: at.hit.text });
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
      // ponytail: walking is the whole of the picker. An overlay is what to
      // write the day a vault holds more views than are comfortable to walk.
      case "v":
        setAsked(true);
        setPicked(picked + 1);
        setActive(0);
        if (missing && !making.current) makeViews();
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
          value={line}
          // A keystroke here carries the view's terms into `typed` whole, so
          // the line goes on saying what the list is filtered by and the header
          // stops naming a view it no longer holds.
          onChange={(event) => {
            setTyped(event.target.value);
            setPicked(0);
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
        {named !== undefined && (
          <span data-testid="todo-view" className={LABEL}>
            {named}
          </span>
        )}
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
                const mark = timerMark(
                  todo.id === undefined ? undefined : running.get(todo.id),
                  today,
                );
                const time = clocks(todo);
                // One tab stop for the whole pane: tab reaches the cursor, and
                // the vim keys move it from there.
                const tabIndex = key === cursorKey ? 0 : -1;
                // A step in per level of nesting, so the list reads the way the
                // note does. `ROW` carries the first one as padding.
                const indent = { paddingLeft: `${GUTTER + (depth ?? 0) * STEP}rem` };

                // The whole row, because the whole line is what is edited: the
                // box and every field are on it, and the symbols this draws in
                // their place are a reading of the line rather than the line.
                if (key === editing?.key) {
                  return (
                    <input
                      key={key}
                      ref={draft}
                      value={editing.line}
                      onChange={(event) => setEditing({ key, line: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== "Escape") return;
                        event.preventDefault();
                        // Nothing left in it is nothing to write. Deleting a
                        // todo is not what this key is.
                        if (event.key === "Enter" && editing.line.trim() !== "") {
                          onEdit(hit, editing.line);
                        }
                        setEditing(null);
                      }}
                      aria-label="edit line"
                      autoComplete="off"
                      spellCheck={false}
                      style={indent}
                      // Its own classes rather than `ROW` and `INPUT`: the
                      // overlay input is written to disappear into a panel,
                      // `outline-none` and `bg-transparent`, and both of those
                      // win over the two things this row has to say. It is a
                      // row of the list, at the list's size, wearing the
                      // keyboard cursor's own outline, because this row is
                      // where the keys are going.
                      className="w-full bg-one-cursor/15 px-3 py-[3px] text-[13px] text-one-fg outline-2 -outline-offset-1 outline-one-cursor"
                    />
                  );
                }

                return (
                  <button
                    key={key}
                    type="button"
                    data-row={key}
                    tabIndex={tabIndex}
                    onClick={() => onOpen(hit.path, hit.line)}
                    title={key}
                    style={indent}
                    // A blocked row is drawn muted rather than gathered under a
                    // heading of its own: its state is written on the line, and
                    // the date group is still where the work belongs.
                    className={`${ROW} flex gap-2 ${
                      todo.state === "blocked" ? "text-one-muted" : "text-one-fg"
                    } ${tabIndex === 0 ? CURSOR : ""}`}
                  >
                    <span className="shrink-0">{STATE_SYMBOL[todo.state]}</span>
                    {/* Leftmost of what a row carries beyond its state, so
                        scanning the list finds what is going. */}
                    {mark !== null && <span className="shrink-0 text-one-green">{mark}</span>}
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
                    {/* Out of the truncation for the reason the date is. What
                        is on the line, not a sum: a running session lands here
                        when it is stopped. */}
                    {time !== null && <span className="shrink-0 text-one-muted">{time}</span>}
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
              {timers > 0 && `, ${timers} running`}
            </>
          )}
        </span>
        <span>
          x cycle&ensp;&ensp;O P X B R state&ensp;&ensp;a add&ensp;&ensp;i edit&ensp;&ensp;t
          timer&ensp;&ensp;d done&ensp;&ensp;n next&ensp;&ensp;v view&ensp;&ensp;/
          filter&ensp;&ensp;q close&ensp;&ensp;Escape editor
        </span>
      </footer>
    </section>
  );
}
