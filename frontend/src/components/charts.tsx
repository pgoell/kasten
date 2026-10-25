/**
 * The chart pieces the log pane and the overview share, so they read as one language.
 * Each is an svg at the width it is given, with a fixed viewBox. The caller writes the
 * words that say what it shows, and passes the svg's name for a screen reader as `label`.
 */

import { shiftDay } from "@/lib/clock";
import { overMax, share } from "@/lib/log-day";
import type { Goal } from "@/lib/log-kinds";

const WIDTH = 300;
const HEIGHT = 80;

interface BarsProps {
  label: string;
  /** Only the slots that have a value. */
  points: { index: number; amount: number }[];
  slots: number;
  goal?: Goal;
  /** When given, the bar at this index is full strength and the others step back. */
  todayIndex?: number;
  /**
   * Stretch the chart to the width it is given rather than keep its shape, for a chart wider
   * than a card; its height then comes from the stylesheet.
   */
  stretch?: boolean;
}

/**
 * A bar per slot that has a value, with its goal as a dashed line. The goal counts toward
 * the top, so the line is always on the chart.
 */
export function Bars({ label, points, slots, goal, todayIndex, stretch }: BarsProps) {
  const slot = WIDTH / slots;
  const bar = slot * 0.7;
  const top = Math.max(1, goal?.value ?? 0, ...points.map((point) => point.amount));
  const height = (amount: number) => (amount / top) * HEIGHT;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      preserveAspectRatio={stretch ? "none" : undefined}
      role="img"
      aria-label={label}
    >
      {points.map(({ index, amount }) => {
        // A logged zero gets a stub one unit high, so it is not drawn like a day with no log.
        const barHeight = amount === 0 ? 1 : height(amount);
        const over = goal !== undefined && overMax(amount, goal);
        const base = over
          ? "log-chart-bar log-chart-over"
          : amount === 0
            ? "log-chart-bar log-chart-zero"
            : "log-chart-bar";
        // Today's bar stands out when the range ends on today, so the eye lands on it first.
        // A bar over its ceiling keeps the warning at full strength, since a faded warning
        // blends into the warm accents of the russet and peach palettes.
        const past = todayIndex !== undefined && index !== todayIndex && !over;
        return (
          <rect
            key={index}
            className={past ? `${base} log-chart-past` : base}
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
  );
}

// A circle of circumference 100, so a dash length is a percentage of the ring.
const RING_RADIUS = 100 / (2 * Math.PI);

interface RingProps {
  value: number;
  /** Without a goal there is no share, so the track is drawn alone. */
  goal: Goal | undefined;
  label: string;
}

/** A ring for one macro against today's goal: the track, and the fill as far as the goal is reached. */
export function Ring({ value, goal, label }: RingProps) {
  const percent = goal === undefined ? null : share(value, goal);
  const over = goal !== undefined && overMax(value, goal);

  return (
    <svg
      className="chart-svg chart-ring"
      viewBox="0 0 36 36"
      width="100%"
      role="img"
      aria-label={label}
      data-share={percent ?? undefined}
    >
      <circle className="chart-ring-track" cx={18} cy={18} r={RING_RADIUS} />
      {percent === null ? null : (
        <circle
          className={over ? "chart-ring-fill chart-ring-over" : "chart-ring-fill"}
          cx={18}
          cy={18}
          r={RING_RADIUS}
          strokeDasharray={`${percent} 100`}
          transform="rotate(-90 18 18)"
        />
      )}
    </svg>
  );
}

interface WeightLineProps {
  values: (number | null)[];
  averages: (number | null)[];
  goal?: Goal;
  label: string;
}

/**
 * A dot per value and the average as one line. The y scale runs from the lowest value to
 * the highest, not from zero, so the changes show.
 */
export function WeightLine({ values, averages, goal, label }: WeightLineProps) {
  const slot = WIDTH / values.length;
  const x = (index: number) => index * slot + slot / 2;

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
  // A weigh-in past a max is drawn in the warning colour.
  const passes = (value: number) => goal !== undefined && overMax(value, goal);

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width="100%"
      role="img"
      aria-label={label}
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
        <circle
          key={index}
          className={passes(value) ? "log-weight-dot log-chart-over" : "log-weight-dot"}
          cx={x(index)}
          cy={y(value)}
          r={2.5}
        />
      ))}
    </svg>
  );
}

const CELL = 10;
const GAP = 2;
const DAY_MS = 86_400_000;

/** A date as days since the epoch, counted in UTC so no zone moves a day. */
function dayOf(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

interface ActivityGridProps {
  /** YYYY-MM-DD to the count for that day. */
  counts: Map<string, number>;
  from: string;
  to: string;
  label: string;
}

/**
 * A column per week, Monday first, and a cell per day from `from` to `to`, shaded in five
 * steps: none for no count, then quartiles of the highest count in the range.
 */
export function ActivityGrid({ counts, from, to, label }: ActivityGridProps) {
  // The Monday of `from`'s week, as the first column's start. Monday is 0 in the row.
  const monday = dayOf(from) - ((new Date(`${from}T00:00:00Z`).getUTCDay() + 6) % 7);
  const days = Array.from({ length: dayOf(to) - dayOf(from) + 1 }, (_, offset) =>
    shiftDay(from, offset),
  );
  const top = Math.max(0, ...days.map((date) => counts.get(date) ?? 0));
  const cells = days.map((date) => {
    const at = dayOf(date) - monday;
    const count = counts.get(date) ?? 0;
    const level = count === 0 || top === 0 ? 0 : Math.ceil((count / top) * 4);
    return { date, count, level, column: Math.floor(at / 7), row: at % 7 };
  });
  const columns = cells.reduce((most, cell) => Math.max(most, cell.column + 1), 0);
  const step = CELL + GAP;

  return (
    <svg
      className="chart-svg chart-grid"
      viewBox={`0 0 ${columns * step - GAP} ${7 * step - GAP}`}
      width="100%"
      role="img"
      aria-label={label}
    >
      {cells.map((cell) => (
        <rect
          key={cell.date}
          className={`chart-cell chart-level-${cell.level}`}
          data-date={cell.date}
          data-count={cell.count}
          x={cell.column * step}
          y={cell.row * step}
          width={CELL}
          height={CELL}
        />
      ))}
    </svg>
  );
}

// Twice the other pieces' width: the line fills half a wide pane, and its marks keep their size.
const LINE_WIDTH = 600;
const LINE_HEIGHT = 120;

interface BalanceLineProps {
  /** One balance a slot, oldest first. */
  values: number[];
  label: string;
  /** The slot the reader points at, drawn with a larger dot. */
  hovered?: number;
}

/**
 * A balance over time as a 2px line over a faint area, a dot a slot, and the zero line. The y
 * scale always takes in zero, so the area's height reads as money and a fall below zero shows;
 * a dot below zero takes the danger colour, which the caller names in words too.
 */
export function BalanceLine({ values, label, hovered }: BalanceLineProps) {
  const slot = LINE_WIDTH / Math.max(1, values.length);
  const x = (index: number) => index * slot + slot / 2;
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  // Room above and below, so a dot at the top or bottom is not cut.
  const pad = (high - low || 1) * 0.08;
  const y = (value: number) =>
    LINE_HEIGHT - ((value - (low - pad)) / (high - low + 2 * pad)) * LINE_HEIGHT;
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const area = `${x(0)},${y(0)} ${line} ${x(values.length - 1)},${y(0)}`;

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${LINE_WIDTH} ${LINE_HEIGHT}`}
      width="100%"
      role="img"
      aria-label={label}
    >
      {values.length === 0 ? null : <polygon className="chart-balance-area" points={area} />}
      <line className="chart-balance-zero" x1={0} x2={LINE_WIDTH} y1={y(0)} y2={y(0)} />
      {values.length === 0 ? null : <polyline className="chart-balance-line" points={line} />}
      {values.map((value, index) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: a slot is its place in time.
          key={index}
          className={value < 0 ? "chart-balance-dot chart-balance-below" : "chart-balance-dot"}
          cx={x(index)}
          cy={y(value)}
          r={index === hovered ? 6 : 4}
        />
      ))}
    </svg>
  );
}
