import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { ActivityGrid, Bars, Ring, WeightLine } from "@/components/charts";
import { totalOf } from "@/components/log-trends";
import {
  fetchCards,
  fetchNote,
  fetchTodos,
  fetchWritten,
  type LineHit,
  NoteMissing,
  type TodoHit,
} from "@/lib/api";
import { shiftDay } from "@/lib/clock";
import type { EditorCommands } from "@/lib/key-bindings";
import { LOG_NOTE } from "@/lib/layout";
import { fetchLog, type LogDay } from "@/lib/log/food-api";
import { overMax } from "@/lib/log/log-day";
import { DEFAULT_CONFIG, type LogConfig, parseConfig } from "@/lib/log/log-kinds";
import { hasFood, streakOf } from "@/lib/log/log-streak";
import { rangeDates, weightOf } from "@/lib/log/log-weight";
import { goalPhrase, grouped } from "@/lib/log/log-words";
import {
  type Bar,
  barsOf,
  daysBack,
  doneCounts,
  reviewCounts,
  runOf,
  todoTally,
  writtenCounts,
  yearTally,
} from "@/lib/overview";
import {
  fortnightCaption,
  fortnightLabel,
  plural,
  ringLabel,
  ringWords,
  todayWords,
  weightLabel,
  weightWords,
} from "@/lib/overview-words";
import { readRetry } from "@/lib/read-retry";
import { deckNotes } from "@/lib/review";
import { useEntrance } from "@/lib/stagger";
import { useLeader } from "@/lib/use-leader";

/** The eight cards, in the order the pane draws them. */
const KEYS = ["food", "today", "weight", "water", "flashcards", "todos", "writing", "year"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "The read did not load";
}

interface Card {
  key: string;
  name: string;
  /** What the card's button opens, in the words its name gives: `Food, open the log`. */
  target: string;
  open: () => void;
  figure: string;
  words: string;
  chart: ReactNode;
  /** What the chart shows, in words under it, so the chart reads without its colours. */
  caption: string;
  /** The read's message, when the read this card feeds failed. */
  failure?: string;
}

export interface OverviewPaneProps {
  commands: EditorCommands;
  /** Raised by the route when this pane has been moved to. See `LogPane`. */
  focusSignal: number;
  archive: boolean;
  /** Today, as `YYYY-MM-DD`. The route reads the clock; this stays pure of it. */
  today: string;
}

/** What the reads answered, with the errors they gave, and the days the cards are about. */
interface Reads {
  today: string;
  /** January 1 of this year, where This year starts. */
  year: string;
  config: LogConfig;
  days: LogDay[];
  logError?: string;
  cards: LineHit[];
  cardsError?: string;
  todos: TodoHit[];
  todosError?: string;
  written: string[];
  writtenError?: string;
}

/** The queries the cards read, each once, under the keys the other panes share. */
function useReads(today: string, archive: boolean): Reads {
  // The same config read the log pane makes, so a missing note draws the defaults here too.
  const logConfig = useQuery({
    queryKey: ["note", LOG_NOTE],
    queryFn: () => fetchNote(LOG_NOTE),
    select: parseConfig,
  });
  // Ninety days, the log pane's longest range, so both read the same answer.
  const from = shiftDay(today, -89);
  const log = useQuery({ queryKey: ["log", from, today], queryFn: () => fetchLog(from, today) });
  const todos = useQuery({ queryKey: ["todos", archive], queryFn: () => fetchTodos(archive) });
  const cards = useQuery({
    queryKey: ["cards", archive],
    queryFn: () => fetchCards(archive),
    ...readRetry,
  });
  // From Jan 1 or thirteen days back, whichever is earlier: Writing and This year both read it.
  const year = `${today.slice(0, 4)}-01-01`;
  const writtenFrom = year < shiftDay(today, -13) ? year : shiftDay(today, -13);
  const written = useQuery({
    queryKey: ["written", writtenFrom, today],
    queryFn: () => fetchWritten(writtenFrom, today),
  });

  return {
    today,
    year,
    config:
      logConfig.error instanceof NoteMissing ? DEFAULT_CONFIG : (logConfig.data ?? DEFAULT_CONFIG),
    days: log.data ?? [],
    logError: log.error ? messageOf(log.error) : undefined,
    cards: cards.data ?? [],
    cardsError: cards.error ? messageOf(cards.error) : undefined,
    todos: todos.data ?? [],
    todosError: todos.error ? messageOf(todos.error) : undefined,
    written: written.data ?? [],
    writtenError: written.error ? messageOf(written.error) : undefined,
  };
}

/**
 * The bars of the last fortnight's days in `days`, `value` of each, with no bar for a day not in
 * them. Each bar keeps its slot in the fortnight, so a day left out leaves a gap, not a shift.
 */
function fortnight(reads: Reads, value: (day: LogDay) => number, days = reads.days): Bar[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return daysBack(reads.today, 14).flatMap((date, index) => {
    const logged = byDate.get(date);
    return logged === undefined ? [] : [{ index, amount: value(logged) }];
  });
}

function todayDayOf(reads: Reads): LogDay | undefined {
  return reads.days.find((day) => day.date === reads.today);
}

function foodCard(reads: Reads, commands: EditorCommands): Card {
  const goal = reads.config.food.kcal;
  const byDate = new Map(reads.days.map((day) => [day.date, day]));
  const streak = streakOf(rangeDates(shiftDay(reads.today, -89), 90), byDate, reads.today, goal);
  // A day of drinks is no food day, so it draws no bar, as the log pane's kcal charts leave it out.
  const bars = fortnight(reads, (day) => day.totals.food.kcal, reads.days.filter(hasFood));
  const over =
    goal?.type === "ceiling" ? bars.filter(({ amount }) => overMax(amount, goal)).length : 0;
  const bound = goal?.type === "floor" ? "at least" : "at most";
  // A fortnight with days logged but no food line says so, since drinks are logged, just no food.
  const loggedIn14 = daysBack(reads.today, 14).some((date) => byDate.has(date));
  return {
    key: "food",
    caption:
      bars.length === 0
        ? `${loggedIn14 ? "no food" : "nothing"} logged in 14 days`
        : fortnightCaption("kcal per day, 14 days", goal, over),
    name: "Food",
    target: "the log",
    open: () => commands.openLog(),
    figure: plural(streak, "day"),
    words:
      reads.days.length === 0
        ? "nothing logged"
        : goal === undefined
          ? "logged days in a row"
          : `in a row within ${bound} ${grouped(goal.value)} kcal`,
    chart: (
      <Bars
        label={fortnightLabel("kcal", " kcal", goal, over)}
        points={bars}
        slots={14}
        goal={goal}
        todayIndex={13}
      />
    ),
    failure: reads.logError,
  };
}

function todayCard(reads: Reads, commands: EditorCommands): Card {
  const day = todayDayOf(reads);
  const kcal = day?.totals.food.kcal ?? 0;
  const macros = (["protein", "carbs", "fat"] as const).map((field) => ({
    field,
    value: day?.totals.food[field] ?? 0,
    goal: reads.config.food[field],
  }));
  return {
    key: "today",
    caption: macros.some(({ goal }) => goal !== undefined)
      ? "macros against today's goal"
      : "macros today, no goals",
    name: "Today",
    target: "the log",
    open: () => commands.openLog(),
    figure: `${grouped(kcal)} kcal`,
    words: todayWords(kcal, reads.config.food.kcal),
    chart: (
      <div className="overview-rings">
        {macros.map(({ field, value, goal }) => (
          <div key={field} className="overview-ring">
            <Ring value={value} goal={goal} label={ringLabel(field, value, goal)} />
            <p className="overview-ring-label">{ringWords(field, value, goal)}</p>
          </div>
        ))}
      </div>
    ),
    failure: reads.logError,
  };
}

function weightCard(reads: Reads, commands: EditorCommands): Card {
  const kind = reads.config.kinds.find((found) => found.last === true);
  const dates = rangeDates(shiftDay(reads.today, -29), 30);
  const weight = kind === undefined ? undefined : weightOf(kind, dates, reads.days);
  const latest = weight?.last ?? null;
  return {
    key: "weight",
    caption:
      (weight?.count ?? 0) === 0
        ? "weight, 30 days, no weigh-ins yet"
        : "weight, 30 days, 7-day average",
    name: "Weight",
    target: "the log",
    open: () => commands.openLog(),
    figure: kind === undefined || latest === null ? "—" : `${grouped(latest)} ${kind.unit}`,
    words: weightWords(weight?.count ?? 0, weight?.change ?? null, kind?.unit ?? ""),
    chart: (
      <WeightLine
        values={weight?.values ?? dates.map(() => null)}
        averages={weight?.averages ?? dates.map(() => null)}
        label={weightLabel(weight, kind?.unit ?? "")}
      />
    ),
    failure: reads.logError,
  };
}

function waterCard(reads: Reads, commands: EditorCommands): Card {
  const kind = reads.config.kinds.find((found) => found.builtin === "water");
  const day = todayDayOf(reads);
  const ml = kind === undefined ? 0 : totalOf(kind, day);
  const goal = kind?.goal;
  const bars = kind === undefined ? [] : fortnight(reads, (logged) => totalOf(kind, logged));
  const over =
    goal?.type === "ceiling" ? bars.filter(({ amount }) => overMax(amount, goal)).length : 0;
  return {
    key: "water",
    caption:
      bars.length === 0
        ? "nothing logged in 14 days"
        : fortnightCaption("water per day, 14 days", goal, over),
    name: "Water",
    target: "the log",
    open: () => commands.openLog(),
    figure: kind === undefined ? "—" : `${grouped(ml)} ml`,
    words: goal === undefined ? "no water goal" : goalPhrase(ml, goal),
    chart: (
      <Bars
        label={fortnightLabel("water", " ml", goal, over)}
        points={bars}
        slots={14}
        goal={goal}
        todayIndex={13}
      />
    ),
    failure: reads.logError,
  };
}

function flashcardsCard(reads: Reads, commands: EditorCommands): Card {
  // Only the notes the review pane counts as decks: a schedule in any other note is no card.
  const decks = new Set(deckNotes(reads.cards));
  const reviews = reviewCounts(reads.cards.filter((hit) => decks.has(hit.path)));
  const rated = reviews.get(reads.today) ?? 0;
  return {
    key: "flashcards",
    caption: "cards rated per day, 14 days",
    name: "Flashcards",
    target: "the review pane",
    open: () => commands.openReview(),
    figure: plural(
      runOf((day) => (reviews.get(day) ?? 0) > 0, reads.today),
      "day",
    ),
    words:
      reviews.size === 0 ? "no cards rated" : `in a row with a review, ${grouped(rated)} today`,
    chart: (
      <Bars
        label={`cards rated per day over 14 days, ${grouped(rated)} today`}
        points={barsOf(daysBack(reads.today, 14), reviews)}
        slots={14}
        todayIndex={13}
      />
    ),
    failure: reads.cardsError,
  };
}

function todosCard(reads: Reads, commands: EditorCommands): Card {
  const done = doneCounts(reads.todos);
  const doneToday = done.get(reads.today) ?? 0;
  const tally = todoTally(reads.todos, reads.today);
  return {
    key: "todos",
    caption: "todos done per day, 14 days",
    name: "Todos",
    target: "the todo pane",
    open: () => commands.openTodos(),
    figure: grouped(doneToday),
    words: `done today, ${grouped(tally.open)} open, ${grouped(tally.overdue)} overdue`,
    chart: (
      <Bars
        label={`todos done per day over 14 days, ${grouped(doneToday)} today`}
        points={barsOf(daysBack(reads.today, 14), done)}
        slots={14}
        todayIndex={13}
      />
    ),
    failure: reads.todosError,
  };
}

function writingCard(reads: Reads, commands: EditorCommands): Card {
  const notes = writtenCounts(reads.written);
  const week = daysBack(reads.today, 7).reduce((sum, day) => sum + (notes.get(day) ?? 0), 0);
  const today = notes.get(reads.today) ?? 0;
  return {
    key: "writing",
    caption: "notes written per day, 14 days",
    name: "Writing",
    target: "today's note",
    open: () => commands.openDaily(),
    figure: grouped(week),
    words: `notes in 7 days, ${grouped(today)} today`,
    chart: (
      <Bars
        label={`notes written per day over 14 days, ${grouped(today)} today`}
        points={barsOf(daysBack(reads.today, 14), notes)}
        slots={14}
        todayIndex={13}
      />
    ),
    failure: reads.writtenError,
  };
}

function yearCard(reads: Reads, commands: EditorCommands): Card {
  const notes = writtenCounts(reads.written);
  const year = yearTally(notes, reads.today);
  return {
    key: "year",
    caption: "notes written per day this year",
    name: "This year",
    target: "this year's note",
    open: () => commands.openYearly(),
    figure: grouped(year.total),
    words:
      year.total === 0
        ? "no notes this year"
        : `notes on ${grouped(year.onDays)} of ${grouped(year.days)} days`,
    chart: (
      <ActivityGrid
        counts={notes}
        from={reads.year}
        to={reads.today}
        label={`notes written each day, ${grouped(year.total)} this year, from 1 January to today`}
      />
    ),
    failure: reads.writtenError,
  };
}

/** The eight cards, in the order the pane draws them. */
function cardsOf(reads: Reads, commands: EditorCommands): Card[] {
  return [
    foodCard(reads, commands),
    todayCard(reads, commands),
    weightCard(reads, commands),
    waterCard(reads, commands),
    flashcardsCard(reads, commands),
    todosCard(reads, commands),
    writingCard(reads, commands),
    yearCard(reads, commands),
  ];
}

/**
 * The keys of the cards: h j k l and the arrows move between the buttons, Enter (native) opens
 * one, and the leader works inside. The pane takes the focus when the route moves to it.
 */
function useCardKeys(commands: EditorCommands, focusSignal: number) {
  const panel = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const leader = useLeader(commands);

  useEffect(() => {
    if (focusSignal) panel.current?.focus();
  }, [focusSignal]);

  /** The card buttons in the order they are drawn, which is the order Tab walks them. */
  function buttons(): HTMLButtonElement[] {
    return Array.from(grid.current?.querySelectorAll<HTMLButtonElement>(".overview-open") ?? []);
  }

  /**
   * Cards per row as the layout draws them, read off the grid's computed columns. jsdom
   * lays nothing out and answers no tracks, so a card row there is one card high.
   */
  function columns(): number {
    const tracks = grid.current ? getComputedStyle(grid.current).gridTemplateColumns : "";
    return Math.max(1, tracks.split(" ").filter(Boolean).length);
  }

  function move(step: number) {
    const all = buttons();
    if (all.length === 0) return;
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    const next = at === -1 ? 0 : Math.min(Math.max(at + step, 0), all.length - 1);
    all[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    // A key typed with a modifier is the browser's or the app's, not the pane's.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (leader.feed(event)) return;

    if (event.key === " ") {
      // Space is the leader on a card too, so the native click it would make is stopped here.
      leader.start(event);
      event.preventDefault();
      return;
    }
    const step = STEPS[event.key];
    if (step === undefined) return;
    move(step(columns()));
    event.preventDefault();
  }

  return { panel, grid, onKeyDown };
}

/** How far each movement key goes, in cards: one along, or one row up or down. */
const STEPS: Record<string, (columns: number) => number> = {
  h: () => -1,
  ArrowLeft: () => -1,
  l: () => 1,
  ArrowRight: () => 1,
  k: (columns) => -columns,
  ArrowUp: (columns) => -columns,
  j: (columns) => columns,
  ArrowDown: (columns) => columns,
};

/**
 * The overview: eight cards, each a number, a line of words and a small chart, all worked
 * out from the notes. Reads what the log, todo, flashcard and note panes already read, under
 * the same keys, and writes nothing.
 */
export function OverviewPane({ commands, focusSignal, archive, today }: OverviewPaneProps) {
  const reads = useReads(today, archive);
  const { panel, grid, onKeyDown } = useCardKeys(commands, focusSignal);
  const entering = useEntrance(KEYS);
  const cards = cardsOf(reads, commands);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label="Overview"
      onKeyDown={onKeyDown}
      className="overview-pane"
    >
      <div ref={grid} className="overview-grid">
        {cards.map((card, index) => {
          const failed = card.failure !== undefined;
          return (
            <article
              key={card.key}
              className={`overview-card${entering(card.key) ? " k-enter" : ""}`}
              style={entering(card.key) ? ({ "--i": index } as React.CSSProperties) : undefined}
            >
              <h2 className="overview-name">
                <button
                  type="button"
                  className="overview-open"
                  aria-label={`${card.name}, open ${card.target}`}
                  onClick={card.open}
                >
                  {card.name}
                </button>
              </h2>
              <p className="overview-figure">{failed ? "—" : card.figure}</p>
              {failed ? (
                <p role="alert" className="overview-words">
                  {card.failure}
                </p>
              ) : (
                <p className="overview-words">{card.words}</p>
              )}
              {failed ? null : <div className="overview-chart">{card.chart}</div>}
              {failed ? null : <p className="overview-caption">{card.caption}</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
