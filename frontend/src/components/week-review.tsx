import { Bars } from "@/components/charts";
import {
  Caption,
  Failed,
  monthDay,
  Reading,
  Section,
  Tile,
  Words,
} from "@/components/review-parts";
import type { LineHit, TodoHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { rangeDates, weightOf } from "@/lib/log/log-weight";
import { grouped } from "@/lib/log/log-words";
import { goalWords, plural } from "@/lib/overview/overview-words";
import type { weeklyWeek } from "@/lib/periodic";
import type { ReviewSource } from "@/lib/review/periodic-review";
import { deckNotes } from "@/lib/review/review";
import {
  cardsPerDay,
  carriedOver,
  doneIn,
  kcalPerDay,
  todosPerDay,
  weekTiles,
} from "@/lib/review/review-week";
import { minutesWords } from "@/lib/review/review-year";
import { useWeekReads, type WeekReads, weekDates } from "@/lib/review/use-review-reads";
import { parseTodo } from "@/lib/todo/todo";

type WeekOf = NonNullable<ReturnType<typeof weeklyWeek>>;

/** The week review, drawn in the weekly note: the week the name gives, Monday to Sunday. */
export function WeekReview({ week, open }: { week: WeekOf; open: ReviewSource["open"] }) {
  const today = readClock(new Date()).date;
  const name = `${week.year}-W${String(week.week).padStart(2, "0")}`;
  return (
    <div className="review review-week">
      <h2 className="review-title">Week in review</h2>
      <p className="review-subtitle">{`${name}, ${monthDay(week.monday)} to ${monthDay(week.sunday)}`}</p>
      {week.monday > today ? (
        <Words>This week has not started.</Words>
      ) : (
        <WeekBody week={week} today={today} open={open} />
      )}
    </div>
  );
}

function WeekBody({
  week,
  today,
  open,
}: {
  week: WeekOf;
  today: string;
  open: ReviewSource["open"];
}) {
  const reads = useWeekReads(week.monday, week.sunday);
  const dates = weekDates(week.monday);
  const todayIndex = dates.indexOf(today);
  const decks = new Set(deckNotes(reads.cards.data));
  const cards = reads.cards.data.filter((hit) => decks.has(hit.path));

  // Each section takes its own read's failure, so the ones that read nothing failed still draw.
  return (
    <>
      <Tiles week={week} reads={reads} />
      <GitHubLine reads={reads} />
      <div className="review-charts">
        <Kcal reads={reads} dates={dates} todayIndex={todayIndex} />
        <Todos reads={reads} dates={dates} today={today} todayIndex={todayIndex} />
      </div>
      <Rows
        heading="Done"
        hits={doneIn(reads.todos.data, week.monday, week.sunday)}
        empty="No todo ticked done this week."
        error={reads.todos.error}
        pending={reads.todos.pending}
        open={open}
      />
      <Rows
        heading="Carried over"
        hits={carriedOver(reads.todos.data, week.monday, week.sunday, today)}
        empty={
          week.monday <= today && today <= week.sunday
            ? "Nothing carried over into today."
            : "Nothing carried over from this week."
        }
        error={reads.todos.error}
        pending={reads.todos.pending}
        open={open}
      />
      <Flashcards
        cards={cards}
        dates={dates}
        today={today}
        todayIndex={todayIndex}
        error={reads.cards.error}
        pending={reads.cards.pending}
      />
    </>
  );
}

function Tiles({ week, reads }: { week: WeekOf; reads: WeekReads }) {
  const config = reads.config.data;
  const kind = config.kinds.find((found) => found.last === true);
  const tiles = weekTiles({
    todos: reads.todos.data,
    days: reads.days.data,
    config,
    notes: reads.notes.data,
    from: week.monday,
    to: week.sunday,
  });
  const weighed =
    kind === undefined ? 0 : weightOf(kind, rangeDates(week.monday, 7), reads.days.data).count;
  const change = tiles.weightChange;
  const weightWords =
    kind === undefined
      ? "no weight kind"
      : weighed === 0
        ? "no weigh-ins"
        : weighed === 1
          ? "one weigh-in"
          : "over the week";
  // A tile whose read failed says the failure in its words, where its number would be; one
  // whose read is still out says so, with a dot where the number goes.
  const shown = (
    read: { error?: string; pending: boolean },
    figure: string,
    words: string,
  ): { figure: string; words: string } =>
    read.error !== undefined
      ? { figure: "—", words: read.error }
      : read.pending
        ? { figure: "…", words: "Reading…" }
        : { figure, words };
  const todos = shown(reads.todos, grouped(tiles.todosDone), "ticked done this week");
  const minutes = shown(reads.notes, minutesWords(tiles.minutes), "in the day notes' sessions");
  // The kcal and weight tiles read the config too: the goal and the weight kind come from it.
  const dayRead = {
    error: reads.days.error ?? reads.config.error,
    pending: reads.days.pending || reads.config.pending,
  };
  const kcal = shown(
    dayRead,
    tiles.withinKcal === null ? "—" : `${tiles.withinKcal} of 7`,
    tiles.withinKcal === null ? "no kcal goal" : "days within the goal",
  );
  const weight = shown(
    dayRead,
    change === null || kind === undefined
      ? "—"
      : `${change > 0 ? "+" : ""}${change + 0} ${kind.unit}`,
    weightWords,
  );
  return (
    <div className="review-tiles">
      <Tile label="Todos done" {...todos} />
      <Tile label="Time logged" {...minutes} />
      <Tile label="Days within kcal" {...kcal} />
      <Tile label="Weight change" {...weight} />
    </div>
  );
}

/**
 * The GitHub line, in a section of its own: a line of words straight under the tiles would
 * read as the caption of the weight tile above it.
 */
function GitHubLine({ reads }: { reads: WeekReads }) {
  return (
    <div className="review-section">
      <GitHubWords reads={reads} />
    </div>
  );
}

function GitHubWords({ reads }: { reads: WeekReads }) {
  const github = reads.github;
  if (github.error !== undefined)
    return <Failed message={`GitHub could not be read. ${github.error}`} />;
  if (github.pending) return <Reading />;
  if (!github.data.on) return <Words>GitHub is off: the backend has no token.</Words>;
  const total = Object.values(github.data.days).reduce((sum, count) => sum + count, 0);
  return <Words>{`GitHub: ${plural(total, "contribution")} this week`}</Words>;
}

function Kcal({
  reads,
  dates,
  todayIndex,
}: {
  reads: WeekReads;
  dates: string[];
  todayIndex: number;
}) {
  const goal = reads.config.data.food.kcal;
  const bars = kcalPerDay(reads.days.data, reads.config.data, dates);
  if (reads.config.error !== undefined) {
    return (
      <Section heading="kcal per day">
        <Failed message={reads.config.error} />
      </Section>
    );
  }
  if (reads.days.error !== undefined) {
    return (
      <Section heading="kcal per day">
        <Failed message={reads.days.error} />
      </Section>
    );
  }
  if (reads.days.pending || reads.config.pending) {
    return (
      <Section heading="kcal per day">
        <Reading />
      </Section>
    );
  }
  return (
    <Section heading="kcal per day">
      <Bars
        label={`kcal per day this week, ${goal === undefined ? "no kcal goal" : goalWords(goal, " kcal")}`}
        points={bars}
        slots={7}
        goal={goal}
        todayIndex={todayIndex < 0 ? undefined : todayIndex}
      />
      <Caption>
        {goal === undefined ? "kcal per day, no goal" : "kcal per day, the dashed line the goal"}
      </Caption>
    </Section>
  );
}

function Todos({
  reads,
  dates,
  today,
  todayIndex,
}: {
  reads: WeekReads;
  dates: string[];
  today: string;
  todayIndex: number;
}) {
  const bars = todosPerDay(reads.todos.data, dates, today);
  const total = bars.reduce((sum, bar) => sum + bar.amount, 0);
  if (reads.todos.error !== undefined) {
    return (
      <Section heading="Todos per day">
        <Failed message={reads.todos.error} />
      </Section>
    );
  }
  if (reads.todos.pending) {
    return (
      <Section heading="Todos per day">
        <Reading />
      </Section>
    );
  }
  return (
    <Section heading="Todos per day">
      <Bars
        label={`todos done per day this week, ${grouped(total)} in all`}
        points={bars}
        slots={7}
        todayIndex={todayIndex < 0 ? undefined : todayIndex}
      />
      <Caption>{`todos done per day, ${grouped(total)} in all`}</Caption>
    </Section>
  );
}

function Rows({
  heading,
  hits,
  empty,
  error,
  pending,
  open,
}: {
  heading: string;
  hits: TodoHit[];
  empty: string;
  error: string | undefined;
  pending: boolean;
  open: ReviewSource["open"];
}) {
  return (
    <Section heading={heading}>
      {error !== undefined ? (
        <Failed message={error} />
      ) : pending ? (
        <Reading />
      ) : hits.length === 0 ? (
        <Words>{empty}</Words>
      ) : (
        <ul className="review-rows">
          {hits.map((hit) => (
            <li key={`${hit.path}:${hit.line}`}>
              <button type="button" className="review-row" onClick={() => open(hit.path, hit.line)}>
                {parseTodo(hit.text)?.text ?? hit.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Flashcards({
  cards,
  dates,
  today,
  todayIndex,
  error,
  pending,
}: {
  cards: LineHit[];
  dates: string[];
  today: string;
  todayIndex: number;
  error: string | undefined;
  pending: boolean;
}) {
  if (error !== undefined) {
    return (
      <Section heading="Flashcards">
        <Failed message={error} />
      </Section>
    );
  }
  if (pending) {
    return (
      <Section heading="Flashcards">
        <Reading />
      </Section>
    );
  }
  const bars = cardsPerDay(cards, dates, today);
  const total = bars.reduce((sum, bar) => sum + bar.amount, 0);
  return (
    <Section heading="Flashcards">
      <Bars
        label={`cards rated per day this week, ${grouped(total)} in all`}
        points={bars}
        slots={7}
        todayIndex={todayIndex < 0 ? undefined : todayIndex}
      />
      <Caption>{`${plural(total, "card")} rated this week, last rating only`}</Caption>
    </Section>
  );
}
