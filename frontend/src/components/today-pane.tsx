import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { fetchTodos, type SearchHit, searchNotes, type TodoHit } from "@/lib/api";
import { readClock, shiftDay } from "@/lib/clock";
import { noteName } from "@/lib/note-path";
import { isOpen, parseTodo, STATE_SYMBOL, type Todo, type TodoState } from "@/lib/todo";
import { sectionOf } from "@/lib/todo-view";
import { useReviewWaiting } from "@/lib/use-review-waiting";

/** The states that are work somebody has started and not finished, and not due today. */
const LOOP_STATES: ReadonlySet<TodoState> = new Set(["doing", "waiting", "blocked"]);

/** How many notes the middle column lists. */
const RECENT = 8;

/** The frontmatter's own lines: a `modified:` further down is someone's text. */
const FRONTMATTER_LINES = 20;

const STAMP = "modified: ";

/** The date the page is about, as the heading shows it: `Thursday, 22 October 2026`. */
function headingOf(now: Date, weekday: string): string {
  const month = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(now);
  return `${weekday}, ${now.getDate()} ${month} ${now.getFullYear()}`;
}

/** `21 Oct`, from a stamp's leading date. Noon, so no offset moves the day. */
function dayOf(stamp: string): string {
  return new Date(`${stamp.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** The newest `modified:` stamp of each note, newest first, at most `RECENT`. */
function recentOf(hits: SearchHit[]): { path: string; stamp: string }[] {
  const newest = new Map<string, string>();
  for (const hit of hits) {
    const line = hit.text.trim();
    if (hit.line > FRONTMATTER_LINES || !line.startsWith(STAMP)) continue;
    const stamp = line.slice(STAMP.length);
    if (stamp > (newest.get(hit.path) ?? "")) newest.set(hit.path, stamp);
  }
  return [...newest]
    .map(([path, stamp]) => ({ path, stamp }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
    .slice(0, RECENT);
}

/**
 * The home screen an empty pane shows: the date, then what is today, what was
 * written lately, and what is due. Every column reads an answer the app already
 * asks for, under the same keys, so opening a pane costs no new request.
 */
export function TodayPane({
  archive,
  onOpen,
  onReview,
}: {
  archive: boolean;
  onOpen: (path: string, line?: number) => void;
  onReview: () => void;
}) {
  const now = new Date();
  const clock = readClock(now);
  const today = clock.date;
  const month = today.slice(0, 7);
  const lastMonth = shiftDay(`${month}-01`, -1).slice(0, 7);

  const todos = useQuery({ queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) });
  const thisMonth = useQuery({
    queryKey: ["search", `${STAMP}${month}`, archive],
    queryFn: () => searchNotes(`${STAMP}${month}`, archive),
  });
  const priorMonth = useQuery({
    queryKey: ["search", `${STAMP}${lastMonth}`, archive],
    queryFn: () => searchNotes(`${STAMP}${lastMonth}`, archive),
  });
  const review = useReviewWaiting(archive);

  const parsed = (todos.data ?? []).flatMap((hit) => {
    const todo = parseTodo(hit.text);
    return todo === null ? [] : [{ hit, todo }];
  });
  const todayTodos = parsed.filter(({ todo }) => sectionOf(todo, today) === "today");
  const overdue = parsed.filter(({ todo }) => sectionOf(todo, today) === "overdue" && isOpen(todo));
  const loops = parsed.filter(
    ({ todo }) => LOOP_STATES.has(todo.state) && sectionOf(todo, today) !== "today",
  );
  const recent = recentOf([...(thisMonth.data ?? []), ...(priorMonth.data ?? [])]);
  const reviewing = review !== undefined && review > 0;
  const nothingDue = !reviewing && overdue.length === 0 && loops.length === 0;

  return (
    <section
      data-today
      aria-label="Today"
      className="@container mx-auto w-full max-w-[1100px] px-4 py-6 md:px-12"
    >
      <h1 className="font-serif text-k-36 text-k-ink">{headingOf(now, clock.weekday)}</h1>
      <div className="mt-8 grid gap-12 @[776px]:grid-cols-3">
        <div data-today-column className="flex min-w-0 flex-col gap-2">
          <h2 className="font-sans text-k-13 text-k-muted tracking-k-label">Today</h2>
          {todayTodos.length === 0 && <Plain>Nothing for today.</Plain>}
          {todayTodos.map(({ hit, todo }) => (
            <TodoRow key={`${hit.path}:${hit.line}`} hit={hit} todo={todo} onOpen={onOpen} />
          ))}
        </div>

        <div data-today-column className="flex min-w-0 flex-col gap-2">
          <h2 className="font-sans text-k-13 text-k-muted tracking-k-label">Recent</h2>
          {recent.length === 0 && <Plain>Nothing written lately.</Plain>}
          {recent.map(({ path, stamp }) => (
            <Row key={path} between onClick={() => onOpen(path)}>
              <span className="min-w-0 truncate">{noteName(path)}</span>
              <span className="shrink-0 font-sans text-k-13 text-k-muted">{dayOf(stamp)}</span>
            </Row>
          ))}
        </div>

        <div data-today-column className="flex min-w-0 flex-col gap-2">
          <h2 className="font-sans text-k-13 text-k-muted tracking-k-label">Due</h2>
          {reviewing && (
            <Group label="Review">
              <Row onClick={onReview}>
                <span>{`${review} ${review === 1 ? "card" : "cards"} waiting`}</span>
              </Row>
            </Group>
          )}
          {overdue.length > 0 && (
            <Group label="Overdue">
              {overdue.map(({ hit, todo }) => (
                <TodoRow key={`${hit.path}:${hit.line}`} hit={hit} todo={todo} onOpen={onOpen} />
              ))}
            </Group>
          )}
          {loops.length > 0 && (
            <Group label="Open loops">
              {loops.map(({ hit, todo }) => (
                <TodoRow key={`${hit.path}:${hit.line}`} hit={hit} todo={todo} onOpen={onOpen} />
              ))}
            </Group>
          )}
          {nothingDue && <Plain>Nothing due.</Plain>}
        </div>
      </div>
    </section>
  );
}

function Plain({ children }: { children: ReactNode }) {
  return <p className="px-2 py-1 font-sans text-k-15 text-k-muted">{children}</p>;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <h3 className="px-2 font-sans text-k-13 text-k-muted tracking-k-label">{label}</h3>
      {children}
    </div>
  );
}

/** A todo's state and words, opened at its line. */
function TodoRow({
  hit,
  todo,
  onOpen,
}: {
  hit: TodoHit;
  todo: Todo;
  onOpen: (path: string, line?: number) => void;
}) {
  return (
    <Row onClick={() => onOpen(hit.path, hit.line)}>
      <span role="img" aria-label={todo.state} className="shrink-0">
        {STATE_SYMBOL[todo.state]}
      </span>
      <span className="min-w-0">{todo.text}</span>
    </Row>
  );
}

/** A full-width row. `between` pushes its last child to the far end, which only the Recent rows' dates want. */
function Row({
  onClick,
  between,
  children,
}: {
  onClick: () => void;
  between?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`k-row flex w-full items-baseline gap-2 rounded-[var(--k-radius-6)] ${between ? "justify-between" : ""} px-2 py-1 text-left font-sans text-k-15 text-k-ink transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-accent`}
    >
      {children}
    </button>
  );
}
