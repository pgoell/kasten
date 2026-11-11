/**
 * The training pane's tiles, in the log pane's chart language: a figure, words under it, a chart
 * and a caption that says in words what the chart shows, so it reads without its colours.
 */

import type { ReactNode } from "react";
import { StackedBars, TrendLine } from "@/components/charts";
import type { LogDay } from "@/lib/log/food-api";
import type { LogKind } from "@/lib/log/log-kinds";
import { rangeDates, weightOf } from "@/lib/log/log-weight";
import { grouped } from "@/lib/log/log-words";
import type { TrainingDay } from "@/lib/log/training/exercises";
import {
  CARDIO_TARGET,
  type CardioWeek,
  cardioTotal,
  changeOf,
  fiveK,
  liftWeeks,
  paceWords,
  recordWords,
  type TrainingRecord,
} from "@/lib/log/training/progress";

/** The three kinds of cardio from the bottom of a bar up, each with its name and colour. */
export const CARDIO_PARTS: { kind: keyof CardioWeek; name: string; className: string }[] = [
  { kind: "walk", name: "Walking", className: "training-walk" },
  { kind: "ride", name: "Cycling", className: "training-ride" },
  { kind: "run", name: "Jogging", className: "training-run" },
];

interface TileProps {
  title: string;
  figure: string;
  words: string;
  chart?: ReactNode;
  caption?: string;
}

export function Tile({ title, figure, words, chart, caption }: TileProps) {
  return (
    <figure className="log-chart training-tile">
      <h3 className="log-chart-title">{title}</h3>
      <p className="log-summary-figure">{figure}</p>
      <p className="log-summary-words">{words}</p>
      {chart}
      {caption === undefined ? null : <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function signed(change: number, unit: string): string {
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${grouped(Math.abs(change))}${unit}`;
}

interface LiftTileProps {
  lift: string;
  days: TrainingDay[];
  starts: string[];
  onOpen: (lift: string) => void;
}

/** A lift's estimated 1RM per week as a sparkline with the change; the tile opens it in depth. */
export function LiftTile({ lift, days, starts, onOpen }: LiftTileProps) {
  const weeks = liftWeeks(days, lift, starts);
  const latest = weeks.filter((value): value is number => value !== null).at(-1);
  const change = changeOf(weeks);
  const words =
    change === null ? "one week so far" : `${signed(change, " kg")} over ${starts.length} weeks`;
  return (
    <button
      type="button"
      className="training-lift"
      aria-label={`${lift}, open in depth`}
      onClick={() => onOpen(lift)}
    >
      <Tile
        title={lift}
        figure={latest === undefined ? "—" : `${grouped(latest)} kg`}
        words={`e1RM, ${words}`}
        chart={
          <TrendLine
            spark
            values={weeks}
            label={`${lift}: best estimated 1RM per week over ${starts.length} weeks`}
          />
        }
      />
    </button>
  );
}

/**
 * Cardio minutes per week stacked by kind, against each week's target: the block's where a block
 * holds the week, else the default.
 */
export function CardioTile({
  weeks,
  targets,
}: {
  weeks: CardioWeek[];
  targets: (number | null)[];
}) {
  const latest = cardioTotal(weeks.at(-1));
  const goal = (at: number) => targets[at] ?? CARDIO_TARGET;
  const met = weeks.filter((week, at) => cardioTotal(week) >= goal(at)).length;
  const now = goal(weeks.length - 1);
  return (
    <Tile
      title="Cardio"
      figure={`${grouped(latest)} min`}
      words={`this week, target ${grouped(now)} min`}
      chart={
        <>
          <StackedBars
            slots={weeks.map((week) =>
              CARDIO_PARTS.map((part) => ({ amount: week[part.kind], className: part.className })),
            )}
            goal={now}
            label={`cardio minutes per week over ${weeks.length} weeks, target met in ${met}`}
          />
          <ul className="log-macro-labels">
            {CARDIO_PARTS.map((part) => (
              <li key={part.kind}>
                <span className={`log-macro-swatch ${part.className}`} aria-hidden="true" />
                {part.name}
              </li>
            ))}
          </ul>
        </>
      }
      caption={`minutes per week, target met in ${grouped(met)} of ${grouped(weeks.length)} weeks`}
    />
  );
}

interface WeightTileProps {
  kind: LogKind | undefined;
  from: string;
  range: number;
  days: LogDay[];
}

/** Body weight as the 7-day average of the weigh-ins, the log pane's numbers. */
export function WeightTile({ kind, from, range, days }: WeightTileProps) {
  const dates = rangeDates(from, range);
  const weight = kind === undefined ? null : weightOf(kind, dates, days);
  const average = weight?.averages.filter((value): value is number => value !== null).at(-1);
  const unit = kind === undefined ? "" : ` ${kind.unit}`;
  return (
    <Tile
      title="Body weight"
      figure={average === undefined ? "—" : `${grouped(average)}${unit}`}
      words={
        weight === null || weight.count === 0
          ? "no weigh-ins yet"
          : weight.change === null
            ? "7-day average"
            : `7-day average, ${signed(weight.change, unit)} since the first`
      }
      chart={
        <TrendLine
          values={weight?.averages ?? dates.map(() => null)}
          label={`body weight, 7-day average over ${range} days`}
        />
      }
    />
  );
}

/** The three small tiles: sessions in the range, 5 km pace and records this week. */
export function FigureTiles({
  sessions,
  weeks,
  days,
  records,
}: {
  sessions: number;
  weeks: number;
  days: TrainingDay[];
  records: TrainingRecord[];
}) {
  const pace = fiveK(days);
  return (
    <>
      <Tile
        title="Sessions"
        figure={grouped(sessions)}
        words={`in ${grouped(weeks)} weeks, ${grouped(Math.round((sessions / weeks) * 10) / 10)} a week`}
      />
      <Tile
        title="5 km pace"
        figure={pace === null ? "—" : paceWords(pace.latest)}
        words={pace === null ? "no run of 5 km yet" : `latest, best ${paceWords(pace.best)}`}
      />
      <Tile
        title="Records this week"
        figure={grouped(records.length)}
        words={
          records.length === 0
            ? "none yet this week"
            : records.map((record) => recordWords(record, grouped)).join(", ")
        }
      />
    </>
  );
}
