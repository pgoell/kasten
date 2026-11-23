import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { TryAgain } from "@/components/review/review-answer";
import { TodoStateBox } from "@/components/todo/todo-state-box";
import { TimersRow } from "@/lib/app/push/timers-row";
import { cycleStoreTodo, fetchTodos, type PlanBlock, type TodoHit } from "@/lib/core/api";
import { readClock } from "@/lib/core/clock";
import { noteName } from "@/lib/notes/links/note-path";
import { useReviewLimits } from "@/lib/review/use-review-limits";
import { useReviewWaiting } from "@/lib/review/use-review-waiting";
import { recentKeys, useRecentNotes } from "@/lib/search/use-recent-notes";
import { isOpen, parseTodo, STATE_SYMBOL, type Todo, type TodoState } from "@/lib/todo/todo";
import { openTodo } from "@/lib/todo/todo-api";
import { sectionOf } from "@/lib/todo/todo-view";
import { useDayPlan } from "@/lib/todo/use-day-plan";
import { absorb } from "@/lib/todo/use-todo-actions";

/** The states that are work somebody has started and not finished, and not due today. */
const LOOP_STATES: ReadonlySet<TodoState> = new Set(["doing", "waiting", "blocked"]);

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

/**
 * Whether every read under `keys` has answered or failed once, and for the cards whether any has
 * failed once. A failed read counts, so a backend that drops reads still gets the editor.
 */
function useAnswered(keys: QueryKey[]): { all: boolean; cardsFailed: boolean } {
  const cache = useQueryClient().getQueryCache();
  const answered = useSyncExternalStore(
    (change) => cache.subscribe(change),
    () =>
      keys.every((queryKey) => {
        const state = cache.find({ queryKey, exact: true })?.state;
        return state !== undefined && (state.data !== undefined || state.fetchFailureCount > 0);
      }),
  );
  const cardsFailed = useSyncExternalStore(
    (change) => cache.subscribe(change),
    () => cache.findAll({ queryKey: ["cards"] }).some((query) => query.state.fetchFailureCount > 0),
  );
  return { all: answered, cardsFailed };
}

/**
 * Whether the home view may draw below its date: every read above the editor has answered, so no
 * answer landing later moves a card or the editor under a finger (#2296). Once true it stays.
 */
function useReady(archive: boolean, today: string, review: number | null | undefined): boolean {
  const answered = useAnswered([
    ["todos", archive],
    ...recentKeys(archive, today),
    ["timers"],
    ["push"],
    ["plan", today],
  ]);
  const [drawn, setDrawn] = useState(false);
  const ready = drawn || (answered.all && (review !== undefined || answered.cardsFailed));
  if (ready && !drawn) setDrawn(true);
  return ready;
}

/**
 * The home screen an empty pane shows: the date, the timers, then what is today,
 * what was written lately, and what is due, with the pane's editor below. Every column reads an
 * answer the app already asks for, under the same keys, so opening a pane costs no new request.
 */
export function TodayPane({
  archive,
  editor,
  onOpen,
  onReview,
  onOverview,
}: {
  archive: boolean;
  editor: ReactNode;
  onOpen: (path: string, line?: number) => void;
  onReview: () => void;
  onOverview: () => void;
}) {
  const now = new Date();
  const clock = readClock(now);
  const today = clock.date;

  const todos = useQuery({ queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) });
  const recent = useRecentNotes(archive);
  const review = useReviewWaiting(archive);
  // The same query the count waits on, so Try again reads the limits it lacks.
  const { retry: retryLimits } = useReviewLimits();

  const parsed = (todos.data ?? []).flatMap((hit) => {
    const todo = parseTodo(hit.text);
    return todo === null ? [] : [{ hit, todo }];
  });
  const todayTodos = parsed.filter(({ todo }) => sectionOf(todo, today) === "today");
  const overdue = parsed.filter(({ todo }) => sectionOf(todo, today) === "overdue" && isOpen(todo));
  const loops = parsed.filter(
    ({ todo }) => LOOP_STATES.has(todo.state) && sectionOf(todo, today) !== "today",
  );
  // Null when the daily limits could not be read, so no count can be given: the
  // row says so, and "Nothing due." would be a lie about the cards not counted.
  const unread = review === null;
  const reviewing = review !== undefined && review !== null && review > 0;
  const nothingDue = review === 0 && overdue.length === 0 && loops.length === 0;

  const ready = useReady(archive, today, review);

  // Below 768 px the whole pane scrolls as one, so Today's last section is reachable and the
  // editor's first line is never under it. From 768 up, Today takes at most 70% and the editor keeps what is left.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="shrink-0 md:max-h-[70%] md:overflow-y-auto">
        <section
          data-today
          aria-label="Today"
          className="@container mx-auto w-full max-w-[1100px] px-4 py-6 md:px-12"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="font-serif text-k-36 text-k-ink">{headingOf(now, clock.weekday)}</h1>
            {/* Quiet, so the date stays the heading. Taller on a touch screen, where a finger needs it. */}
            <button
              type="button"
              onClick={onOverview}
              className="font-sans text-k-13 text-k-muted transition-colors duration-(--k-hover) hover:text-k-accent pointer-coarse:min-h-11 pointer-coarse:px-2"
            >
              Overview
            </button>
          </div>
          {!ready && <Plain>Loading today…</Plain>}
          {/* Mounted while hidden, so the reads it waits on are asked. */}
          <div hidden={!ready}>
            <TimersRow />
            <PlanNow hits={todos.data ?? []} onOpen={onOpen} />
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
                    <span className="shrink-0 font-sans text-k-13 text-k-muted">
                      {dayOf(stamp)}
                    </span>
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
                {unread && (
                  <Group label="Review">
                    <Row onClick={onReview}>
                      <span>Cards could not be counted: the daily limits could not be read</span>
                    </Row>
                    {/* Wrapped, so the column's flex does not stretch it to the full width. */}
                    <div className="px-2">
                      <TryAgain onClick={retryLimits} />
                    </div>
                  </Group>
                )}
                {overdue.length > 0 && (
                  <Group label="Overdue">
                    {overdue.map(({ hit, todo }) => (
                      <TodoRow
                        key={`${hit.path}:${hit.line}`}
                        hit={hit}
                        todo={todo}
                        onOpen={onOpen}
                      />
                    ))}
                  </Group>
                )}
                {loops.length > 0 && (
                  <Group label="Open loops">
                    {loops.map(({ hit, todo }) => (
                      <TodoRow
                        key={`${hit.path}:${hit.line}`}
                        hit={hit}
                        todo={todo}
                        onOpen={onOpen}
                      />
                    ))}
                  </Group>
                )}
                {nothingDue && <Plain>Nothing due.</Plain>}
              </div>
            </div>
          </div>
        </section>
      </div>
      {/* Mounted at once, so a fresh pane takes keys; unseen and untouchable until it stops moving. */}
      <div className={`min-h-[40%] flex-1 ${ready ? "" : "pointer-events-none opacity-0"}`}>
        {editor}
      </div>
    </div>
  );
}

/** `09:00 to 10:30`, a block's span. */
function spanOf(block: PlanBlock): string {
  return `${block.starts.slice(0, 5)} to ${block.ends.slice(0, 5)}`;
}

/** The day plan's block that holds the present minute with its picked todos, and the next block. */
function PlanNow({
  hits,
  onOpen,
}: {
  hits: TodoHit[];
  onOpen: (path: string, line?: number) => void;
}) {
  const { now, next } = useDayPlan();
  const queryClient = useQueryClient();
  const cycle = useMutation({
    mutationFn: (id: string) => cycleStoreTodo(id),
    onSuccess: (rows) => absorb(queryClient, rows),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["todos"] });
      void queryClient.invalidateQueries({ queryKey: ["files"] });
    },
  });
  if (now === undefined && next === undefined) return null;
  const byId = new Map(hits.flatMap((hit) => (hit.todo ? [[hit.todo.id, hit] as const] : [])));

  return (
    <div data-today-plan className="mt-8 flex flex-col gap-2">
      {now !== undefined && (
        <>
          <h2 className="font-sans text-k-13 text-k-muted tracking-k-label">Now</h2>
          <p className="flex flex-wrap items-baseline gap-2 px-2 font-sans text-k-15 text-k-ink">
            <span>{now.title}</span>
            <span className="text-k-13 text-k-muted">{`${now.kind}, ${spanOf(now)}`}</span>
          </p>
          {now.todos.map((id) => {
            const hit = byId.get(id);
            if (hit?.todo == null) return null;
            const row = hit.todo;
            return (
              <div key={id} className="flex items-baseline gap-1 px-2">
                <button
                  type="button"
                  aria-label={`Cycle ${row.words}`}
                  onClick={() => cycle.mutate(id)}
                  className="self-center pointer-coarse:p-3"
                >
                  <TodoStateBox state={row.state} />
                </button>
                <button
                  type="button"
                  onClick={() => openTodo(hit, onOpen)}
                  className="min-w-0 py-1 text-left font-sans text-k-15 text-k-ink transition-colors duration-(--k-hover) hover:text-k-accent pointer-coarse:min-h-11"
                >
                  {row.words}
                </button>
              </div>
            );
          })}
        </>
      )}
      {next !== undefined && <Plain>{`Next: ${next.starts.slice(0, 5)} ${next.title}`}</Plain>}
    </div>
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
    <Row onClick={() => openTodo(hit, onOpen)}>
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
  // 44 px under a finger by padding, not centring, so a wrapped todo keeps its symbol on line one.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`k-row flex w-full items-baseline gap-2 rounded-[var(--k-radius-6)] ${between ? "justify-between" : ""} px-2 py-1 text-left font-sans text-k-15 text-k-ink transition-[color,background-color,transform] duration-(--k-hover) hover:text-k-accent pointer-coarse:min-h-11 pointer-coarse:py-2.5`}
    >
      {children}
    </button>
  );
}
