import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTodos, type SearchHit } from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import { rankLines } from "@/lib/fuzzy";
import { type EditorCommands, LEADER } from "@/lib/key-bindings";
import { INPUT, LABEL, ROW } from "@/lib/overlay-styles";
import { isOpen, PRIORITY_SYMBOL, parseTodo, STATE_SYMBOL, type Todo } from "@/lib/todo";
import { matchesFilter, parseFilter } from "@/lib/todo-shorthand";

export type Section = "overdue" | "today" | "week" | "later" | "none";

/** In the order the pane draws them: what is late first, what has no date last. */
const SECTIONS: readonly Section[] = ["overdue", "today", "week", "later", "none"];

const HEADING: Record<Section, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No date",
};

/**
 * Which group a todo belongs to, read off its due date alone.
 *
 * The scheduled and start dates are phase 2, and they are what move a row out
 * of the group its due date names, so phase 1 reads `📅` and nothing else. ISO
 * dates sort as strings, which is the whole of the maths.
 */
export function sectionOf(todo: Todo, today: string): Section {
  if (todo.due === undefined) return "none";
  if (todo.due < today) return "overdue";
  if (todo.due === today) return "today";
  // The window `due:<7d` names, so the seventh day out is already later.
  return todo.due < shiftDay(today, 7) ? "week" : "later";
}

/** One drawn row: the line the vault answered with, and that line read. */
interface Row {
  hit: SearchHit;
  todo: Todo;
}

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
export function TodoPane({ commands, onOpen, focusSignal, today }: TodoPaneProps) {
  const [typed, setTyped] = useState("");
  /** Which row the keys act on. */
  const [active, setActive] = useState(0);
  /** The keys of an unfinished leader sequence, starting with the space. */
  const [pending, setPending] = useState("");
  const panel = useRef<HTMLElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  /** The signal already answered, so the first render answers nothing. */
  const answered = useRef(focusSignal);

  const { data } = useQuery({ queryKey: ["todos"], queryFn: fetchTodos });

  // The endpoint matches the shape of a checkbox and nothing else, so reading
  // each line is what drops the `## Time` sessions and the finished todos.
  const open = useMemo(() => {
    const found: Row[] = [];
    for (const hit of data ?? []) {
      const todo = parseTodo(hit.text);
      if (todo !== null && isOpen(todo)) found.push({ hit, todo });
    }
    return found;
  }, [data]);

  const shown = useMemo(() => {
    const terms = parseFilter(typed);
    const kept = open.filter(({ todo }) => matchesFilter(todo, terms, today));
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
  }, [open, typed, today]);

  const groups = useMemo(
    () =>
      SECTIONS.map((section) => ({
        section,
        rows: shown.filter((row) => sectionOf(row.todo, today) === section),
      })).filter((group) => group.rows.length > 0),
    [shown, today],
  );
  // The same rows flattened, because `j` and `k` move down a list and a heading
  // is not a row the cursor can sit on.
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

  // Narrowing the list can strand the cursor past the end of it.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));
  const at = rows[cursor];
  const cursorKey = at === undefined ? "" : rowKey(at.hit);

  const blocked = shown.filter(({ todo }) => todo.state === "blocked").length;

  // Arriving from another pane. The cursor row is the pane's only tab stop, so
  // that is where the focus lands.
  useEffect(() => {
    if (focusSignal === answered.current) return;
    answered.current = focusSignal;
    panel.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusSignal]);

  // Only when the list already holds the focus, and never while the filter
  // does: typing narrows the list, which moves the cursor, and following it
  // would pull the focus out of the input mid-word.
  useEffect(() => {
    const element = panel.current;
    if (!element?.contains(document.activeElement)) return;
    if (document.activeElement === filter.current) return;
    element.querySelector<HTMLElement>(`[data-row="${cursorKey}"]`)?.focus();
  }, [cursorKey]);

  /** Hand the focus back to the list, which is where the keys below act. */
  function focusList() {
    panel.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
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
          <p className="px-3 py-1 text-[13px] text-one-muted">nothing to do</p>
        ) : (
          groups.map(({ section, rows: group }) => (
            <div key={section}>
              <h3 className="px-3 pt-2 pb-1 text-[11px] tracking-wider text-one-muted uppercase">
                {HEADING[section]}
              </h3>
              {group.map(({ hit, todo }) => {
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
                    <span className="min-w-0 flex-1 truncate">{todo.text}</span>
                    {/* Out of the truncation, so a long todo loses its words
                        rather than the date they are due on. The year is the
                        heading's job: every row under one shares it. */}
                    {todo.due !== undefined && (
                      <span className="shrink-0 text-one-muted">{todo.due.slice(5)}</span>
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
          {shown.length - blocked} open, {blocked} blocked
        </span>
        <span>/ filter&ensp;&ensp;q close&ensp;&ensp;Escape editor</span>
      </footer>
    </section>
  );
}
