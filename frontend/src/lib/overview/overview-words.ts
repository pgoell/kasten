/**
 * The words the overview's cards say and the labels its charts carry, as plain strings of the
 * numbers they are given. Pure, so the pane's cards read the same wording the tests check, and
 * the pane itself stays the place that wires the reads to the cards.
 */

import { overMax } from "@/lib/log/log-day";
import type { Goal } from "@/lib/log/log-kinds";
import type { Weight } from "@/lib/log/log-weight";
import { grouped } from "@/lib/log/log-words";

/** A count with its noun: `1 day`, `5 days`. */
export function plural(count: number, noun: string): string {
  return `${grouped(count)} ${count === 1 ? noun : `${noun}s`}`;
}

/** A goal in the chart's words: `goal at most 2,200 kcal`. */
export function goalWords(goal: Goal, unit: string): string {
  return `goal ${goal.type === "floor" ? "at least" : "at most"} ${grouped(goal.value)}${unit}`;
}

/** A weight card's words: how many weigh-ins there are, and the change across the thirty days. */
export function weightWords(count: number, change: number | null, unit: string): string {
  if (count === 0) return "no weigh-ins yet";
  if (count === 1) return "one weigh-in";
  if (change === null) return "";
  // `+ 0` turns a minus zero into a zero, which the words would otherwise read as `-0`.
  return `${change > 0 ? "+" : ""}${grouped(change + 0)} ${unit} in 30 days`;
}

/** Today's kcal in words, against the kcal goal when there is one. */
export function todayWords(kcal: number, goal: Goal | undefined): string {
  if (goal === undefined) return "no kcal goal";
  if (goal.type === "floor") {
    return `of at least ${grouped(goal.value)} kcal, ${kcal >= goal.value ? "met" : `${grouped(goal.value - kcal)} to go`}`;
  }
  const left = overMax(kcal, goal)
    ? `${grouped(kcal - goal.value)} over`
    : `${grouped(goal.value - kcal)} left`;
  return `of at most ${grouped(goal.value)} kcal, ${left}`;
}

/**
 * A fortnight's bars in words: the goal, and the days over a ceiling counted, so the colour of
 * a day over is never the only sign of it.
 */
export function fortnightLabel(
  name: string,
  unit: string,
  goal: Goal | undefined,
  over: number,
): string {
  if (goal === undefined) return `${name} per day over 14 days, no ${name} goal`;
  const tail = goal.type === "ceiling" ? `, ${plural(over, "day")} over the goal` : "";
  return `${name} per day over 14 days, ${goalWords(goal, unit)}${tail}`;
}

/** A fortnight's caption, with the days over a ceiling goal counted in it when there are any. */
export function fortnightCaption(base: string, goal: Goal | undefined, over: number): string {
  if (goal?.type !== "ceiling" || over === 0) return base;
  return `${base}, ${plural(over, "day")} over the goal`;
}

/** A macro's visible words under its ring: its name, what it has reached, and its goal. */
export function ringWords(field: string, value: number, goal: Goal | undefined): string {
  const name = `${field.charAt(0).toUpperCase()}${field.slice(1)}`;
  if (goal === undefined) return `${name} ${grouped(value)} g`;
  return `${name} ${grouped(value)} of ${grouped(goal.value)} g`;
}

/** One macro's ring label: what it has reached against its goal, or that it has none. */
export function ringLabel(field: string, value: number, goal: Goal | undefined): string {
  if (goal === undefined) return `${field}, ${grouped(value)} g, no goal`;
  return `${field}, ${grouped(value)} of ${grouped(goal.value)} g`;
}

export function weightLabel(weight: Weight | undefined, unit: string): string {
  if (weight === undefined || weight.count === 0) return "weight over 30 days, nothing logged";
  return `weight in ${unit} over 30 days, ${plural(weight.count, "weigh-in")}, with the 7-day average`;
}
