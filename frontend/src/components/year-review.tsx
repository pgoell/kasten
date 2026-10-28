import { ActivityGrid, Bars, WeightLine } from "@/components/charts";
import { Caption, daysBetween, Failed, Reading, Section, Words } from "@/components/review-parts";
import type { TodoHit } from "@/lib/api";
import { readClock } from "@/lib/clock";
import { rangeDates, weightOf } from "@/lib/log/log-weight";
import { grouped } from "@/lib/log/log-words";
import { plural } from "@/lib/overview/overview-words";
import { deckNotes } from "@/lib/review/review";
import type { ModelUseLine } from "@/lib/review/review-api";
import {
  costWords,
  monthUse,
  type ProjectUse,
  projectUse,
  tokenWords,
  unpricedTokens,
} from "@/lib/review/review-model-use";
import {
  minutesWords,
  monthCounts,
  type ProjectRow,
  projectRows,
  topTags,
  type WrittenNote,
  yearNumbers,
  yearRange,
} from "@/lib/review/review-year";
import { useYearReads, type YearReads } from "@/lib/review/use-review-reads";

/** The year review, drawn in the yearly note: this year to today, a past year over all of it. */
export function YearReview({ year }: { year: number }) {
  const today = readClock(new Date()).date;
  const range = yearRange(year, today);
  return (
    <div className="review review-year">
      <h2 className="review-title">Year in review</h2>
      <p className="review-subtitle">{String(year)}</p>
      {range === null ? (
        <Words>{`${year} has not started.`}</Words>
      ) : (
        <YearBody year={year} from={range.from} to={range.to} today={today} />
      )}
    </div>
  );
}

function YearBody({
  year,
  from,
  to,
  today,
}: {
  year: number;
  from: string;
  to: string;
  today: string;
}) {
  const reads = useYearReads(from, to);
  const decks = new Set(deckNotes(reads.cards.data));
  const cards = reads.cards.data.filter((hit) => decks.has(hit.path));
  const todos = reads.todos.data;
  const notes = reads.notes.data;
  const numbers = yearNumbers({
    todos,
    written: reads.written.data,
    cards,
    days: reads.days.data,
    from,
    to,
  });

  // A number whose read is still out shows a dot, not the zero the fallback would give.
  const pending = (read: { pending: boolean }, figure: string) => (read.pending ? "…" : figure);
  return (
    <div className="review-year-body">
      <div className="review-main">
        <Projects
          year={year}
          todos={todos}
          notes={notes}
          from={from}
          to={to}
          error={reads.todos.error ?? reads.notes.error}
          pending={reads.todos.pending || reads.notes.pending}
        />
        <GitHub year={year} to={to} reads={reads} />
        <Months
          year={year}
          to={to}
          today={today}
          written={reads.written.data}
          error={reads.written.error}
          pending={reads.written.pending}
        />
        <ModelUse
          year={year}
          today={today}
          lines={reads.modelUse.data}
          error={reads.modelUse.error}
          pending={reads.modelUse.pending}
        />
        <Weight year={year} reads={reads} from={from} to={to} />
        <Tags
          year={year}
          notes={notes}
          from={from}
          to={to}
          error={reads.notes.error}
          pending={reads.notes.pending}
        />
      </div>
      <aside className="review-aside" aria-label="The year's numbers">
        <Stat label="Todos done" figure={pending(reads.todos, grouped(numbers.todosDone))} />
        <Stat label="Time logged" figure={pending(reads.todos, minutesWords(numbers.minutes))} />
        <Stat label="Notes made" figure={pending(reads.written, grouped(numbers.notes))} />
        <Stat
          label="Flashcards answered"
          figure={pending(reads.cards, grouped(numbers.flashcards))}
        />
        <Stat label="Days logged" figure={pending(reads.days, grouped(numbers.daysLogged))} />
      </aside>
    </div>
  );
}

function Stat({ label, figure }: { label: string; figure: string }) {
  return (
    <div className="review-number">
      <p className="review-tile-label">{label}</p>
      <p className="review-figure">{figure}</p>
    </div>
  );
}

function Projects({
  year,
  todos,
  notes,
  from,
  to,
  error,
  pending,
}: {
  year: number;
  todos: TodoHit[];
  notes: WrittenNote[];
  from: string;
  to: string;
  error: string | undefined;
  pending: boolean;
}) {
  return (
    <Section heading="Projects">
      {error !== undefined ? (
        <Failed message={error} />
      ) : pending ? (
        <Reading />
      ) : (
        <ProjectTable year={year} rows={projectRows(todos, notes, from, to)} />
      )}
    </Section>
  );
}

function ProjectTable({ year, rows }: { year: number; rows: ProjectRow[] }) {
  if (rows.length === 0) {
    return <Words>{`No project had a done todo or a note in ${year}.`}</Words>;
  }
  return (
    <table className="review-table">
      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col">Done</th>
          <th scope="col">Time</th>
          <th scope="col">Notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.project}>
            <th scope="row">{row.name}</th>
            <td>{grouped(row.done)}</td>
            <td>{minutesWords(row.minutes)}</td>
            <td>{grouped(row.notes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GitHub({ year, to, reads }: { year: number; to: string; reads: YearReads }) {
  const github = reads.github;
  if (github.error !== undefined) {
    return (
      <Section heading="GitHub">
        <Failed message={`GitHub could not be read. ${github.error}`} />
      </Section>
    );
  }
  if (github.pending) {
    return (
      <Section heading="GitHub">
        <Reading />
      </Section>
    );
  }
  if (!github.data.on) {
    return (
      <Section heading="GitHub">
        <Words>GitHub is off: the backend has no token.</Words>
      </Section>
    );
  }
  const counts = new Map(Object.entries(github.data.days));
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return (
    <Section heading="GitHub">
      <ActivityGrid
        counts={counts}
        from={`${year}-01-01`}
        to={to}
        label={`GitHub contributions each day, ${grouped(total)} contributions in ${year}`}
      />
      <Caption>{`${grouped(total)} contributions in ${year}`}</Caption>
    </Section>
  );
}

function Months({
  year,
  to,
  today,
  written,
  error,
  pending,
}: {
  year: number;
  to: string;
  today: string;
  written: string[];
  error: string | undefined;
  pending: boolean;
}) {
  if (error !== undefined) {
    return (
      <Section heading="Notes per month">
        <Failed message={error} />
      </Section>
    );
  }
  if (pending) {
    return (
      <Section heading="Notes per month">
        <Reading />
      </Section>
    );
  }
  const amounts = monthCounts(written, year, to);
  const total = amounts.reduce((sum, count) => sum + count, 0);
  // The month the year is in now, full strength; the others step back as they do on the overview.
  const todayIndex = today.startsWith(`${year}-`) ? Number(today.slice(5, 7)) - 1 : undefined;
  return (
    <Section heading="Notes per month">
      <Bars
        label={`notes written per month in ${year}, ${grouped(total)} in all`}
        points={amounts.map((amount, index) => ({ index, amount }))}
        slots={12}
        todayIndex={todayIndex}
      />
      <Caption>{`notes written per month, ${grouped(total)} in all`}</Caption>
    </Section>
  );
}

function ModelUse({
  year,
  today,
  lines,
  error,
  pending,
}: {
  year: number;
  today: string;
  lines: ModelUseLine[];
  error: string | undefined;
  pending: boolean;
}) {
  if (error !== undefined) {
    return (
      <Section heading="Model use">
        <Failed message={error} />
      </Section>
    );
  }
  if (pending) {
    return (
      <Section heading="Model use">
        <Reading />
      </Section>
    );
  }
  if (lines.length === 0) {
    return (
      <Section heading="Model use">
        <Words>{`No model use recorded in ${year}.`}</Words>
      </Section>
    );
  }
  const months = monthUse(lines, year);
  const tokens = months.reduce((sum, month) => sum + month.tokens, 0);
  const cost = months.reduce((sum, month) => sum + (month.cost ?? 0), 0);
  const priced = lines.some((line) => line.cost !== null);
  const unpriced = unpricedTokens(lines);
  // The same month marking as Notes per month: this year's current month at full strength.
  const todayIndex = today.startsWith(`${year}-`) ? Number(today.slice(5, 7)) - 1 : undefined;
  return (
    <>
      {/* Two charts side by side from the container's 600 px, one above the other on a phone. */}
      <div className="review-charts">
        <Section heading="Tokens per month">
          <Bars
            label={`tokens per month in ${year}, ${tokenWords(tokens)} in all`}
            points={months.map((month, index) => ({ index, amount: month.tokens }))}
            slots={12}
            todayIndex={todayIndex}
          />
          <Caption>{`tokens per month, ${tokenWords(tokens)} in all`}</Caption>
        </Section>
        <Section heading="Cost per month">
          {/* With no priced line there is no cost to draw, and a $0.00 bar would say there was. */}
          {priced ? (
            <Bars
              label={`cost per month in ${year}, ${costWords(cost)} in all`}
              points={months.map((month, index) => ({ index, amount: month.cost ?? 0 }))}
              slots={12}
              todayIndex={todayIndex}
            />
          ) : null}
          <Caption>
            {priced
              ? `cost per month, ${costWords(cost)} in all`
              : "cost unknown, no price for these models"}
          </Caption>
        </Section>
      </div>
      <Section heading="Model use">
        <ProjectUseTable rows={projectUse(lines)} />
        {unpriced > 0 ? (
          <Words>{`${tokenWords(unpriced)} tokens had no price and are left out of the cost.`}</Words>
        ) : null}
      </Section>
    </>
  );
}

function ProjectUseTable({ rows }: { rows: ProjectUse[] }) {
  return (
    <table className="review-table">
      <thead>
        <tr>
          <th scope="col">Project</th>
          <th scope="col">Tokens</th>
          <th scope="col">Cost</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.project}>
            <th scope="row">{row.project}</th>
            <td>{tokenWords(row.tokens)}</td>
            <td>{row.cost === null ? "unknown" : costWords(row.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Weight({
  year,
  reads,
  from,
  to,
}: {
  year: number;
  reads: YearReads;
  from: string;
  to: string;
}) {
  // The kind is the config's, so a config that failed to read says so, rather than the defaults'
  // lack of a weight kind, and the section waits on the config as well as on the days.
  if (reads.config.error !== undefined) {
    return (
      <Section heading="Weight">
        <Failed message={reads.config.error} />
      </Section>
    );
  }
  if (reads.config.pending || reads.days.pending) {
    return (
      <Section heading="Weight">
        <Reading />
      </Section>
    );
  }
  const kind = reads.config.data.kinds.find((found) => found.last === true);
  if (kind === undefined) {
    return (
      <Section heading="Weight">
        <Words>No weight kind in the log config.</Words>
      </Section>
    );
  }
  if (reads.days.error !== undefined) {
    return (
      <Section heading="Weight">
        <Failed message={reads.days.error} />
      </Section>
    );
  }
  const weight = weightOf(kind, rangeDates(from, daysBetween(from, to)), reads.days.data);
  if (weight.count === 0) {
    return (
      <Section heading="Weight">
        <Words>{`No weigh-ins in ${year}.`}</Words>
      </Section>
    );
  }
  return (
    <Section heading="Weight">
      <WeightLine
        values={weight.values}
        averages={weight.averages}
        label={`weight in ${kind.unit} over ${year}, ${plural(weight.count, "weigh-in")}, with the 7-day average`}
      />
      <Caption>{`weight, ${year}, 7-day average`}</Caption>
    </Section>
  );
}

function Tags({
  year,
  notes,
  from,
  to,
  error,
  pending,
}: {
  year: number;
  notes: WrittenNote[];
  from: string;
  to: string;
  error: string | undefined;
  pending: boolean;
}) {
  if (error !== undefined) {
    return (
      <Section heading="Top tags">
        <Failed message={error} />
      </Section>
    );
  }
  if (pending) {
    return (
      <Section heading="Top tags">
        <Reading />
      </Section>
    );
  }
  const tags = topTags(notes, from, to);
  if (tags.length === 0) {
    return (
      <Section heading="Top tags">
        <Words>{`No tags on the notes written in ${year}.`}</Words>
      </Section>
    );
  }
  return (
    <Section heading="Top tags">
      <ol className="review-tags">
        {tags.map(({ tag, count }) => (
          <li key={tag}>
            <span>{tag.startsWith("#") ? tag : `#${tag}`}</span>{" "}
            <span className="review-count">{grouped(count)}</span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
