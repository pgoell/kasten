/**
 * The log pane's trends: one small bar chart per kind of the config and one for
 * the food's kcal, over the days a range covers, and the food's average macros as
 * one stacked bar. Plain SVG at the width it is given, so it reads the same at 414px.
 *
 * The helpers at the top are the pane's too: they say what a day adds up to and
 * how a total stands against its goal, so the pane and the charts agree.
 */

import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import type { FoodField, Goal, LogConfig, LogKind } from "@/lib/log-kinds";
import { tenth } from "@/lib/log-lines";

/** A day of the log as `GET /api/log` answers it, and one of its lines. */
export type Day = LogDay;
export type Line = LogDay["entries"][number];

/** What a kind adds up to on one day: the built-in kinds read their totals, one of your own its `mine` total. */
export function totalOf(kind: LogKind, day: Day | undefined): number {
  if (day === undefined) return 0;
  switch (kind.builtin) {
    case "water":
      return day.totals.water.ml;
    case "coffee":
      return day.totals.coffee.count;
    case "alcohol":
      return day.totals.alcohol.count;
    default:
      return day.totals.mine?.find((mine) => mine.mark === kind.mark)?.total ?? 0;
  }
}

/** A food field's total on one day, zero where there is no day. */
export function foodTotal(day: Day | undefined, field: FoodField): number {
  return day?.totals.food[field] ?? 0;
}

export type GoalState = "met" | "short" | "over" | "under";

/**
 * A total against its goal, in the words the card writes: `500 / 2000 ml`, a ✓ once
 * a floor is met and a ⚠ once a ceiling is passed, so the colour is not the only sign.
 */
export function goalWords(
  head: string,
  tail: string,
  total: number,
  goal: Goal,
): { text: string; state: GoalState } {
  const words = `${head} / ${goal.value}${tail}`;
  if (goal.type === "floor") {
    const met = total >= goal.value;
    return { text: met ? `${words} ✓` : words, state: met ? "met" : "short" };
  }
  const over = total > goal.value;
  return { text: over ? `${words} ⚠` : words, state: over ? "over" : "under" };
}

/** The share of a floor reached, as the bar is drawn: at most a whole bar. */
export function share(total: number, goal: Goal): number {
  return Math.min(100, Math.round((total / goal.value) * 100));
}

const WIDTH = 300;
const HEIGHT = 100;

interface ChartProps {
  name: string;
  unit: string;
  goal: Goal | undefined;
  /** The days with a `## Log`, each with its index in the range. */
  logged: { index: number; day: Day }[];
  range: number;
  value: (day: Day) => number;
}

/** One kind's bars, a bar per logged day, with its goal as a dashed line. */
function Chart({ name, unit, goal, logged, range, value }: ChartProps) {
  const values = logged.map(({ day }) => value(day));
  // The goal counts toward the top, so the line is always on the chart.
  const top = Math.max(1, goal?.value ?? 0, ...values);
  const slot = WIDTH / range;
  const bar = slot * 0.7;
  const height = (amount: number) => (amount / top) * HEIGHT;
  const sum = values.reduce((total, amount) => total + amount, 0);
  const suffix = unit === "" ? "" : ` ${unit}`;
  const average =
    values.length === 0
      ? "nothing logged"
      : `average ${tenth(sum / values.length)}${suffix} over ${values.length} logged ${values.length === 1 ? "day" : "days"}`;
  const aim =
    goal === undefined
      ? ""
      : `, goal ${goal.type === "floor" ? "at least" : "at most"} ${goal.value}${suffix}`;

  return (
    <figure className="log-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`${name} over ${range} days`}
      >
        {logged.map(({ index }, at) => {
          const barHeight = height(values[at] ?? 0);
          return (
            <rect
              key={index}
              className="log-chart-bar"
              x={index * slot + (slot - bar) / 2}
              y={HEIGHT - barHeight}
              width={bar}
              height={barHeight}
            />
          );
        })}
        {goal === undefined ? null : (
          <line
            data-goal={goal.value}
            className="log-chart-goal"
            x1={0}
            x2={WIDTH}
            y1={HEIGHT - height(goal.value)}
            y2={HEIGHT - height(goal.value)}
          />
        )}
      </svg>
      <figcaption>{`${name}: ${average}${aim}`}</figcaption>
    </figure>
  );
}

/** The food's average protein, carbs and fat over the logged days, as one bar of three parts. */
function Macros({ logged, range }: { logged: { index: number; day: Day }[]; range: number }) {
  const count = logged.length;
  const average = (field: "protein" | "carbs" | "fat") => {
    const sum = logged.reduce((total, { day }) => total + foodTotal(day, field), 0);
    return count === 0 ? 0 : tenth(sum / count);
  };
  const parts = [
    { name: "protein", grams: average("protein"), className: "log-macro-protein" },
    { name: "carbs", grams: average("carbs"), className: "log-macro-carbs" },
    { name: "fat", grams: average("fat"), className: "log-macro-fat" },
  ];
  const whole = parts.reduce((total, part) => total + part.grams, 0);
  let start = 0;
  const drawn = parts.map((part) => {
    const width = whole === 0 ? 0 : (part.grams / whole) * WIDTH;
    const x = start;
    start += width;
    return { ...part, x, width };
  });

  return (
    <figure className="log-chart">
      <svg
        viewBox={`0 0 ${WIDTH} 12`}
        width="100%"
        role="img"
        aria-label={`average macros over ${range} days`}
      >
        {drawn.map((part) => (
          <rect
            key={part.name}
            className={part.className}
            x={part.x}
            y={0}
            width={part.width}
            height={12}
          />
        ))}
      </svg>
      <figcaption>
        {count === 0
          ? "macros: nothing logged"
          : `average protein ${average("protein")} g, carbs ${average("carbs")} g, fat ${average("fat")} g over ${count} logged ${count === 1 ? "day" : "days"}`}
      </figcaption>
    </figure>
  );
}

/** The charts of a range ending on `from`'s last day: one per kind, then the food's kcal and average macros. */
export function LogTrends({
  days,
  config,
  from,
  range,
}: {
  days: Day[];
  config: LogConfig;
  from: string;
  range: number;
}) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  // A day the answer leaves out has no `## Log`, so it draws no bar and is no part of an average.
  const logged = Array.from({ length: range }, (_, index) => index).flatMap((index) => {
    const day = byDate.get(shiftDay(from, index));
    return day === undefined ? [] : [{ index, day }];
  });

  return (
    <div className="log-trends">
      {config.kinds.map((kind) => (
        <Chart
          key={kind.mark}
          name={kind.name}
          unit={kind.builtin === "water" ? "ml" : kind.unit}
          goal={kind.goal}
          logged={logged}
          range={range}
          value={(day) => totalOf(kind, day)}
        />
      ))}
      <Chart
        name="food kcal"
        unit="kcal"
        goal={config.food.kcal}
        logged={logged}
        range={range}
        value={(day) => foodTotal(day, "kcal")}
      />
      <Macros logged={logged} range={range} />
    </div>
  );
}
