/**
 * The weight a last kind keeps, as the log pane shows it: its row in Today, its line
 * in the trends, its tile in the summary and its column in the week table. With no
 * last kind each one is the empty slot #804 drew, so a vault with no weight reads as
 * it did before.
 */

import type { LogDay } from "@/lib/food-api";
import { overMax } from "@/lib/log-day";
import type { LogKind } from "@/lib/log-kinds";
import { latestOn, meanOf, valueOn, type Weight, weightOf } from "@/lib/log-weight";
import { goalPhrase, grouped } from "@/lib/log-words";

const WIDTH = 300;
const HEIGHT = 80;

interface WeightProps {
  kinds: LogKind[];
  /** The range's dates, oldest first, ending on the day shown. */
  dates: string[];
  days: LogDay[];
}

/** A kind's name with its first letter capitalised, as the pane writes its names. */
function title(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The unit with its space, or nothing for a kind with none. */
function suffix(kind: LogKind): string {
  return kind.unit === "" ? "" : ` ${kind.unit}`;
}

/** A date as its short month and day, `Oct 22`. */
export function monthDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** A change with its sign: `+0.4 kg`, `-1.2 kg`, and `0 kg` with none. */
function changeWords(change: number, tail: string): string {
  if (change === 0) return `0${tail}`;
  return `${change > 0 ? "+" : ""}${grouped(change)}${tail}`;
}

/** The weigh-in count in words: `no weigh-ins`, `one weigh-in`, `12 weigh-ins`. */
function countWords(count: number): string {
  if (count === 0) return "no weigh-ins";
  return count === 1 ? "one weigh-in" : `${grouped(count)} weigh-ins`;
}

/** The amount field's placeholder for a kind that asks for its number, as `weight in kg`. */
export function hintOf(kind: LogKind): string {
  return kind.unit === "" ? kind.name : `${kind.name} in ${kind.unit}`;
}

/**
 * A last kind's button as the card draws it: the day's own weigh-in as the total, or with none
 * the latest before the day in the range, in words and with no meter.
 */
export function weightButton(
  kind: LogKind,
  dates: string[],
  days: LogDay[],
  own: LogDay | undefined,
  tail: string,
): { total: number | null; words?: string } {
  const value = valueOn(kind, own);
  if (value !== null) return { total: value };
  const day = dates[dates.length - 1] ?? "";
  const latest = latestOn(weightOf(kind, dates, days).values, dates, day);
  if (latest === null) return { total: null };
  return {
    total: null,
    words: `${String(latest.value)}${tail}, ${monthDay(latest.date)}`,
  };
}

/** A goal's side in words: a floor is `at least`, a ceiling `at most`. */
function bound(goal: { type: "floor" | "ceiling" }): string {
  return goal.type === "floor" ? "at least" : "at most";
}

/** One kind's row in Today: its value on the day, or the latest before it with its date, and its goal. */
function WeightRow({ kind, dates, days }: { kind: LogKind; dates: string[]; days: LogDay[] }) {
  const weight = weightOf(kind, dates, days);
  const day = dates[dates.length - 1] ?? "";
  const latest = latestOn(weight.values, dates, day);
  const average = weight.averages[dates.length - 1] ?? null;
  const goal = kind.goal;
  const tail = suffix(kind);
  const over = latest !== null && goal !== undefined && overMax(latest.value, goal);
  const met = latest !== null && goal?.type === "floor" && latest.value >= goal.value;
  const state = over ? " log-pane-over" : met ? " log-pane-met" : "";
  const figure =
    latest === null
      ? "—"
      : `${String(latest.value)}${tail}${latest.date === day ? "" : `, ${monthDay(latest.date)}`}`;

  return (
    <li className={`log-pane-reading log-pane-weight${state}`} data-kind={kind.name}>
      <span className="log-pane-name">{title(kind.name)}</span>
      <span className="log-pane-total">{figure}</span>
      {latest === null ? <span className="log-pane-goal">no weigh-ins yet</span> : null}
      {average === null ? null : (
        <span className="log-pane-goal">{`7-day average ${grouped(average)}${tail}`}</span>
      )}
      {latest === null || goal === undefined ? null : (
        <span className="log-pane-goal">{goalPhrase(latest.value, goal)}</span>
      )}
    </li>
  );
}

/** The weight rows of Today, one per last kind, or the empty slot with none. */
export function WeightRows({ kinds, dates, days }: WeightProps) {
  if (kinds.length === 0) {
    return (
      <li className="log-pane-reading log-pane-slot" data-slot="weight">
        <span className="log-pane-name">Weight</span>
        <span className="log-pane-total">—</span>
        <span className="log-pane-goal">no weigh-ins yet</span>
      </li>
    );
  }
  return (
    <>
      {kinds.map((kind) => (
        <WeightRow key={kind.mark} kind={kind} dates={dates} days={days} />
      ))}
    </>
  );
}

/**
 * One kind's line: a dot per weigh-in at its date, the 7-day average as one line, and a
 * dashed goal. The y scale runs from the lowest value to the highest, not from zero, so
 * the changes show.
 */
function WeightChart({ kind, dates, days }: { kind: LogKind; dates: string[]; days: LogDay[] }) {
  const weight = weightOf(kind, dates, days);
  const { values, averages, count, change, last } = weight;
  const slot = WIDTH / dates.length;
  const x = (index: number) => index * slot + slot / 2;
  const goal = kind.goal;
  const tail = suffix(kind);

  // The goal counts toward the scale, so its line is always on the chart.
  const shown = [...values, goal?.value ?? null].filter((value): value is number => value !== null);
  const low = shown.length === 0 ? 0 : Math.min(...shown);
  const high = shown.length === 0 ? 0 : Math.max(...shown);
  // A single value has no spread, so it gets a unit either side rather than a divide by zero.
  const pad = high - low === 0 ? 1 : (high - low) * 0.1;
  const floor = low - pad;
  const ceiling = high + pad;
  const y = (value: number) => HEIGHT - ((value - floor) / (ceiling - floor)) * HEIGHT;

  const points = values.flatMap((value, index) => (value === null ? [] : [{ index, value }]));
  const line = averages.flatMap((average, index) =>
    average === null ? [] : [`${x(index)},${y(average)}`],
  );
  const changed = change === null ? "" : `, change ${changeWords(change, tail)}`;
  const aim = goal === undefined ? "" : `, goal ${bound(goal)} ${grouped(goal.value)}${tail}`;
  const passed =
    last !== null && goal !== undefined && overMax(last, goal) ? ", over the goal" : "";
  const latest = last === null ? "" : `, latest ${String(last)}${tail}`;

  return (
    <figure className="log-chart">
      <h3 className="log-chart-title">{title(kind.name)}</h3>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`${kind.name} over ${dates.length} days, ${countWords(count)}${changed}`}
      >
        {line.length === 0 ? null : <polyline className="log-weight-avg" points={line.join(" ")} />}
        {goal === undefined ? null : (
          <line
            data-goal={goal.value}
            className="log-chart-goal"
            x1={0}
            x2={WIDTH}
            y1={y(goal.value)}
            y2={y(goal.value)}
          />
        )}
        {points.map(({ index, value }) => (
          <circle key={index} className="log-weight-dot" cx={x(index)} cy={y(value)} r={2.5} />
        ))}
      </svg>
      <figcaption>{`${kind.name}: ${countWords(count)}${latest}${aim}${passed}`}</figcaption>
    </figure>
  );
}

/** The weight lines under the small multiples, one per last kind, or the empty slot with none. */
export function WeightCharts({ kinds, dates, days }: WeightProps) {
  if (kinds.length === 0) {
    return (
      <figure className="log-chart log-chart-slot" data-slot="weight">
        <figcaption>Weight</figcaption>
        <p className="log-chart-empty">No weigh-ins yet</p>
      </figure>
    );
  }
  return (
    <>
      {kinds.map((kind) => (
        <WeightChart key={kind.mark} kind={kind} dates={dates} days={days} />
      ))}
    </>
  );
}

/** The words of a tile for a kind: the change from the first weigh-in to the last, or the one value. */
function tileOf(weight: Weight, tail: string): { figure: string; words: string } {
  const { count, first, last, change } = weight;
  if (first === null || last === null || change === null) {
    return count === 1 && last !== null
      ? { figure: `${String(last)}${tail}`, words: countWords(count) }
      : { figure: "—", words: countWords(count) };
  }
  return {
    figure: changeWords(change, tail),
    words: `from ${String(first)} to ${String(last)}${tail}`,
  };
}

/** The summary tiles, one per last kind, or the empty tile with none. */
export function WeightTiles({ kinds, dates, days }: WeightProps) {
  if (kinds.length === 0) {
    return (
      <div className="log-summary-tile" data-slot="weight">
        <dt>Weight</dt>
        <dd className="log-summary-figure">—</dd>
        <dd className="log-summary-words">no weigh-ins yet</dd>
      </div>
    );
  }
  return (
    <>
      {kinds.map((kind) => {
        const { figure, words } = tileOf(weightOf(kind, dates, days), suffix(kind));
        return (
          <div key={kind.mark} className="log-summary-tile" data-kind={kind.name}>
            <dt>{title(kind.name)}</dt>
            <dd className="log-summary-figure">{figure}</dd>
            <dd className="log-summary-words">{words}</dd>
          </div>
        );
      })}
    </>
  );
}

/** The week table's header for the weight: one column per last kind, or the one `Weight` column. */
export function WeightHead({ kinds }: { kinds: LogKind[] }) {
  if (kinds.length === 0) return <th scope="col">Weight</th>;
  return (
    <>
      {kinds.map((kind) => (
        <th key={kind.mark} scope="col">
          {title(kind.name)}
        </th>
      ))}
    </>
  );
}

/** The week table's cells for the weight: each last kind's mean over the week's logged days, `—` for none. */
export function WeightCells({ kinds, logged }: { kinds: LogKind[]; logged: LogDay[] }) {
  if (kinds.length === 0) return <td data-slot="weight">—</td>;
  return (
    <>
      {kinds.map((kind) => {
        const mean = meanOf(logged.map((day) => valueOn(kind, day)));
        return <td key={kind.mark}>{mean === null ? "—" : grouped(mean)}</td>;
      })}
    </>
  );
}
