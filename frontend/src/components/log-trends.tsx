/**
 * The log pane's trends for a range ending on the day shown. Plain SVG and HTML at
 * the width given, so it reads the same at 390px.
 */

import { Bars } from "@/components/charts";
import {
  WeightCells,
  WeightCharts,
  WeightHead,
  WeightSlot,
  WeightTiles,
} from "@/components/log-weight";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/log/food-api";
import { overMax } from "@/lib/log/log-day";
import type { FoodField, Goal, LogConfig, LogKind } from "@/lib/log/log-kinds";
import { tenth } from "@/lib/log/log-lines";
import { hasFood, streakOf, within } from "@/lib/log/log-streak";
import { grouped } from "@/lib/log/log-words";

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

/** A count of logged days in words: `1 logged day`, `27 logged days`. */
function loggedDays(count: number): string {
  return `${grouped(count)} logged ${count === 1 ? "day" : "days"}`;
}

/** A count of food days in words: `1 food day`, `27 food days`. */
function foodDays(count: number): string {
  return `${grouped(count)} food ${count === 1 ? "day" : "days"}`;
}

/** A count of days in words: `1 day`, `3 days`. */
function daysOf(count: number): string {
  return `${grouped(count)} ${count === 1 ? "day" : "days"}`;
}

/** A goal's side in words: a floor is `at least`, a ceiling `at most`. */
function bound(goal: Goal): string {
  return goal.type === "floor" ? "at least" : "at most";
}

/** The words under the Average figure, over the food days it is worked out from. */
function averageWords(noneLogged: boolean, noFood: boolean, count: number): string {
  if (noneLogged) return "nothing logged";
  return noFood ? "no food logged" : `over ${foodDays(count)}`;
}

/** The words under the Within goal figure: the goal, or why there is no count to set against it. */
function withinWords(goal: Goal | undefined, noneLogged: boolean, noFood: boolean): string {
  if (goal === undefined) return "no kcal goal";
  if (noneLogged) return "nothing logged";
  return noFood ? "no food logged" : `days ${bound(goal)} ${grouped(goal.value)} kcal`;
}

interface Logged {
  index: number;
  day: Day;
}

interface ChartProps {
  name: string;
  unit: string;
  goal: Goal | undefined;
  /** The days the chart draws, each with its index in the range: every logged day for a kind, the food days for a food chart. */
  logged: Logged[];
  range: number;
  value: (day: Day) => number;
  /** Set on the food charts, whose `logged` is the food days: the words count those, and `noneLogged` tells `no food logged` from `nothing logged`. */
  food?: { noneLogged: boolean };
  todayIndex?: number;
}

/**
 * One kind's bars, a bar per logged day, with its goal as a dashed line. Every chart is
 * the same size, so they can be read against each other by eye. The food charts get the
 * food days only, since a day of drinks is no food day and draws no bar.
 */
function Chart({ name, unit, goal, logged, range, value, food, todayIndex }: ChartProps) {
  const points = logged.map(({ index, day }) => ({ index, amount: value(day) }));
  const sum = points.reduce((total, point) => total + point.amount, 0);
  const suffix = unit === "" ? "" : ` ${unit}`;
  // Drinks alone leave a food chart empty but not with nothing logged, so its words say which.
  const empty = food !== undefined && !food.noneLogged ? "no food logged" : "nothing logged";
  const counted = food === undefined ? loggedDays(points.length) : foodDays(points.length);
  const average =
    points.length === 0
      ? empty
      : `average ${grouped(tenth(sum / points.length))}${suffix} over ${counted}`;
  const aim = goal === undefined ? "" : `, goal ${bound(goal)} ${grouped(goal.value)}${suffix}`;
  // Only a ceiling is passed in a warning. The words count the passes too, so colour is not the only sign.
  const passes = (amount: number) => goal !== undefined && overMax(amount, goal);
  const over = points.filter((point) => passes(point.amount)).length;
  const overWords = over === 0 ? "" : `, ${daysOf(over)} over the goal`;
  const title = name.charAt(0).toUpperCase() + name.slice(1);

  return (
    <figure className="log-chart">
      <h3 className="log-chart-title">{title}</h3>
      <Bars
        label={`${name} over ${range} days${overWords}`}
        points={points}
        slots={range}
        goal={goal}
        todayIndex={todayIndex}
      />
      <figcaption>{`${name}: ${average}${aim}${overWords}`}</figcaption>
    </figure>
  );
}

/** The food fields charted, each with its unit. Kcal, protein, carbs and fat are one chart apiece. */
const FOOD_CHARTS: { field: FoodField; unit: string }[] = [
  { field: "kcal", unit: "kcal" },
  { field: "protein", unit: "g" },
  { field: "carbs", unit: "g" },
  { field: "fat", unit: "g" },
];

/** The three macros, the kcal each gram gives, and the class that colours their part. */
const MACROS: { name: string; field: FoodField; perGram: number; className: string }[] = [
  { name: "Protein", field: "protein", perGram: 4, className: "log-macro-protein" },
  { name: "Carbs", field: "carbs", perGram: 4, className: "log-macro-carbs" },
  { name: "Fat", field: "fat", perGram: 9, className: "log-macro-fat" },
];

/**
 * Each macro's share of the kcal the macros give, over the food days, as whole
 * percentages that add up to 100: the points the rounding leaves over go to the parts
 * with the largest remainders. Null when no macro is logged, so there is nothing to share.
 */
function macroShares(
  logged: Logged[],
): { name: string; className: string; percent: number }[] | null {
  const kcal = MACROS.map((macro) =>
    logged.reduce((sum, { day }) => sum + foodTotal(day, macro.field) * macro.perGram, 0),
  );
  const whole = kcal.reduce((sum, value) => sum + value, 0);
  if (whole === 0) return null;
  const exact = kcal.map((value) => (value / whole) * 100);
  const spare = 100 - exact.reduce((sum, value) => sum + Math.floor(value), 0);
  const lifted = new Set(
    exact
      .map((value, index) => ({ index, rest: value - Math.floor(value) }))
      .sort((a, b) => b.rest - a.rest)
      .slice(0, spare)
      .map((part) => part.index),
  );
  return MACROS.map((macro, index) => ({
    name: macro.name,
    className: macro.className,
    percent: Math.floor(exact[index] ?? 0) + (lifted.has(index) ? 1 : 0),
  }));
}

/**
 * The food's macro split over the food days: one stacked bar, each part named with its percentage under it.
 * A day of drinks is no food day, so it is left out of the split and the count in its caption.
 */
function Macros({ fed, noneLogged, range }: { fed: Logged[]; noneLogged: boolean; range: number }) {
  const shares = macroShares(fed);
  let start = 0;
  const drawn = (shares ?? []).map((part) => {
    const width = (part.percent / 100) * WIDTH;
    const x = start;
    start += width;
    return { ...part, x, width };
  });

  return (
    <figure className="log-macros">
      <figcaption>
        {/* Food with kcal but no protein, carbs or fat is logged, so it is not "nothing logged". */}
        {shares === null
          ? `macros: ${noneLogged ? "nothing logged" : fed.length > 0 ? "no macros logged" : "no food logged"}`
          : `macros, share of kcal over ${foodDays(fed.length)}`}
      </figcaption>
      {shares === null ? null : (
        <>
          <svg
            viewBox={`0 0 ${WIDTH} 12`}
            width="100%"
            role="img"
            aria-label={`macro split over ${range} days`}
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
          <ul className="log-macro-labels">
            {shares.map((part) => (
              <li key={part.name}>
                <span className={`log-macro-swatch ${part.className}`} aria-hidden="true" />
                {`${part.name} ${grouped(part.percent)}%`}
              </li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}

/** One figure of the summary row: its label, the figure and what it means in words. */
function Tile({ label, figure, words }: { label: string; figure: string; words: string }) {
  return (
    <div className="log-summary-tile">
      <dt>{label}</dt>
      <dd className="log-summary-figure">{figure}</dd>
      <dd className="log-summary-words">{words}</dd>
    </div>
  );
}

interface Week {
  monday: string;
  inRange: number;
  logged: Day[];
}

/** The Monday of the week `date` falls in. Counted in UTC, as the range's days are, so no zone moves a day. */
function mondayOf(date: string): string {
  const back = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftDay(date, -back);
}

/** The weeks the range's days touch, newest first, with the logged days in each. */
function weeksOf(dates: string[], byDate: Map<string, Day>): Week[] {
  const weeks = new Map<string, Week>();
  for (const date of dates) {
    const monday = mondayOf(date);
    const week = weeks.get(monday) ?? { monday, inRange: 0, logged: [] };
    week.inRange += 1;
    const day = byDate.get(date);
    if (day !== undefined) week.logged.push(day);
    weeks.set(monday, week);
  }
  // The dates run oldest first, so the weeks do too.
  return [...weeks.values()].reverse();
}

/** A week's Monday as its label, `Oct 19`. */
function weekLabel(monday: string): string {
  return new Date(`${monday}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A row per week, with the averages of its days, `—` where a week has none to average. Kcal
 * and protein average the food days only, so a day of drinks does not pull them down to 0.
 * Water and the day count take every logged day.
 */
function WeekTable({
  weeks,
  anyLogged,
  kinds,
}: {
  weeks: Week[];
  anyLogged: boolean;
  kinds: LogKind[];
}) {
  return (
    <>
      <table className="log-weeks">
        <caption>By week</caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">kcal</th>
            <th scope="col">Protein</th>
            <th scope="col">Water</th>
            <WeightHead kinds={kinds} />
            <th scope="col">Days</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => {
            const count = week.logged.length;
            const fed = week.logged.filter(hasFood);
            const mean = (days: Day[], value: (day: Day) => number) =>
              days.length === 0
                ? null
                : days.reduce((sum, day) => sum + value(day), 0) / days.length;
            const kcal = mean(fed, (day) => foodTotal(day, "kcal"));
            const protein = mean(fed, (day) => foodTotal(day, "protein"));
            const water = mean(week.logged, (day) => day.totals.water.ml);
            return (
              <tr key={week.monday}>
                <th scope="row">{weekLabel(week.monday)}</th>
                <td>{kcal === null ? "—" : grouped(Math.round(kcal))}</td>
                <td>{protein === null ? "—" : grouped(tenth(protein))}</td>
                <td>{water === null ? "—" : grouped(Math.round(water))}</td>
                <WeightCells kinds={kinds} logged={week.logged} />
                <td>{`${count} of ${week.inRange}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {anyLogged ? null : <p className="log-weeks-empty">nothing logged</p>}
    </>
  );
}

/** The trends of a range ending on the day shown: the summary, the charts, the weight slot, the macro split and the week table. */
export function LogTrends({
  days,
  config,
  from,
  range,
  today,
}: {
  days: Day[];
  config: LogConfig;
  from: string;
  range: number;
  today: string;
}) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const dates = Array.from({ length: range }, (_, index) => shiftDay(from, index));
  // A day the answer leaves out has no `## Log`, so it draws no bar and is no part of an average.
  const logged: Logged[] = dates.flatMap((date, index) => {
    const day = byDate.get(date);
    return day === undefined ? [] : [{ index, day }];
  });

  const weightKinds = config.kinds.filter((kind) => kind.last === true);
  const chartKinds = config.kinds.filter((kind) => kind.last !== true);
  const goal = config.food.kcal;
  const noneLogged = logged.length === 0;
  // A day with no food line is no food day, as the streak reads it, so drinks alone are left out of the kcal tiles and food charts.
  const fed = logged.filter(({ day }) => hasFood(day));
  const noFood = fed.length === 0;
  const kcal = fed.map(({ day }) => foodTotal(day, "kcal"));
  const average = noFood
    ? null
    : Math.round(kcal.reduce((sum, value) => sum + value, 0) / fed.length);
  const withinGoal = goal === undefined ? 0 : kcal.filter((value) => within(value, goal)).length;
  const streak = streakOf(dates, byDate, today, goal);
  // Only a range that ends on today marks its bars: a past range draws every bar full strength.
  const todayIndex = dates[range - 1] === today ? range - 1 : undefined;

  return (
    <div className="log-trends">
      <dl className="log-summary">
        <Tile
          label="Average"
          figure={average === null ? "—" : `${grouped(average)} kcal`}
          words={averageWords(noneLogged, noFood, fed.length)}
        />
        <Tile
          label="Within goal"
          figure={goal === undefined || noFood ? "—" : `${withinGoal} of ${fed.length}`}
          words={withinWords(goal, noneLogged, noFood)}
        />
        <Tile
          label="Streak"
          figure={noneLogged ? "—" : daysOf(streak)}
          words={
            noneLogged
              ? "nothing logged"
              : goal === undefined
                ? "logged days in a row"
                : "in a row within the kcal goal"
          }
        />
        <WeightTiles kinds={weightKinds} dates={dates} days={days} />
      </dl>

      <div className="log-multiples">
        {chartKinds.map((kind) => (
          <Chart
            key={kind.mark}
            name={kind.name}
            unit={kind.builtin === "water" ? "ml" : kind.unit}
            goal={kind.goal}
            logged={logged}
            range={range}
            value={(day) => totalOf(kind, day)}
            todayIndex={todayIndex}
          />
        ))}
        {FOOD_CHARTS.map(({ field, unit }) => (
          <Chart
            key={field}
            name={field}
            unit={unit}
            goal={config.food[field]}
            logged={fed}
            range={range}
            value={(day) => foodTotal(day, field)}
            food={{ noneLogged }}
            todayIndex={todayIndex}
          />
        ))}
        <WeightCharts kinds={weightKinds} dates={dates} days={days} />
      </div>

      <WeightSlot kinds={weightKinds} />

      <Macros fed={fed} noneLogged={noneLogged} range={range} />

      <WeekTable weeks={weeksOf(dates, byDate)} anyLogged={!noneLogged} kinds={weightKinds} />
    </div>
  );
}
