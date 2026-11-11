/**
 * What the training pane, the overview and the week review read off the training lines: weeks,
 * e1RM per lift, cardio minutes, sessions, 5 km pace and records. Pure, over `GET /api/training`.
 */

import { shiftDay } from "@/lib/core/clock";
import type { TrainingDay } from "@/lib/log/training/exercises";
import type { CardioKind, TrainingEntry } from "@/lib/log/training/training-lines";

/** The weekly cardio aim until a block note sets one (#1719): the WHO's 150 minutes. */
export const CARDIO_TARGET = 150;

/** A week's strength volume under this share of the weeks before reads as a deload. */
const DELOAD_SHARE = 0.6;
const DELOAD_LOOK_BACK = 3;
const MAIN_LIFTS = 4;
const FIVE_K = 5;

/** The Monday of the week `date` falls in, weeks running Monday to Sunday as ISO's do. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDay(date, -((weekday + 6) % 7));
}

/** The Mondays of the `count` weeks up to the one holding `today`, oldest first. */
export function weekStarts(today: string, count: number): string[] {
  const last = mondayOf(today);
  return Array.from({ length: count }, (_, index) => shiftDay(last, (index - count + 1) * 7));
}

/** Which of `starts` a date falls in, or -1 outside them all. */
function weekIndex(starts: string[], date: string): number {
  const monday = mondayOf(date);
  return starts.indexOf(monday);
}

function strengthOf(day: TrainingDay, exercise?: string): TrainingEntry[] {
  return day.entries.filter(
    (e) => e.kind === "strength" && (exercise === undefined || e.exercise === exercise),
  );
}

/** A day counts as a session when it holds a set or a cardio line; a test alone does not. */
export function isSession(day: TrainingDay): boolean {
  return day.entries.some((e) => e.kind !== "test");
}

/** The lifts with an e1RM, the most often trained first, at most four. */
export function mainLifts(days: TrainingDay[]): string[] {
  const count = new Map<string, number>();
  for (const day of days) {
    const names = new Set(
      strengthOf(day)
        .filter((e) => e.e1rm !== undefined)
        .map((e) => e.exercise),
    );
    for (const name of names) count.set(name, (count.get(name) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAIN_LIFTS)
    .map(([name]) => name);
}

/** The best e1RM of a lift in each week, null in a week without one. */
export function liftWeeks(
  days: TrainingDay[],
  exercise: string,
  starts: string[],
): (number | null)[] {
  const best: (number | null)[] = starts.map(() => null);
  for (const day of days) {
    const at = weekIndex(starts, day.date);
    if (at === -1) continue;
    for (const entry of strengthOf(day, exercise)) {
      if (entry.e1rm !== undefined) best[at] = Math.max(best[at] ?? 0, entry.e1rm);
    }
  }
  return best;
}

/** The first and last week's value of a series and the change between, null below two. */
export function changeOf(values: (number | null)[]): number | null {
  const found = values.filter((v): v is number => v !== null);
  const first = found[0];
  const last = found.at(-1);
  if (found.length < 2 || first === undefined || last === undefined) return null;
  return Math.round((last - first) * 10) / 10;
}

export type CardioWeek = Record<CardioKind, number>;

/** The minutes of walking, riding and running in each week. */
export function cardioWeeks(days: TrainingDay[], starts: string[]): CardioWeek[] {
  const weeks = starts.map(() => ({ walk: 0, ride: 0, run: 0 }));
  for (const day of days) {
    const week = weeks[weekIndex(starts, day.date)];
    if (week === undefined) continue;
    for (const entry of day.entries) {
      if (entry.kind === "walk" || entry.kind === "run" || entry.kind === "ride") {
        week[entry.kind] += entry.minutes ?? 0;
      }
    }
  }
  return weeks;
}

export function cardioTotal(week: CardioWeek | undefined): number {
  return week === undefined ? 0 : Math.round(week.walk + week.ride + week.run);
}

/** Kilograms lifted over a lift's sets in each week, body weight sets left out. */
export function volumeWeeks(days: TrainingDay[], starts: string[], exercise?: string): number[] {
  const weeks = starts.map(() => 0);
  for (const day of days) {
    const at = weekIndex(starts, day.date);
    if (at === -1) continue;
    weeks[at] = (weeks[at] ?? 0) + volumeOf(strengthOf(day, exercise));
  }
  return weeks;
}

function volumeOf(entries: TrainingEntry[]): number {
  return entries.reduce(
    (sum, e) => sum + (e.kg ?? 0) * (e.reps ?? []).reduce((reps, r) => reps + r, 0),
    0,
  );
}

/**
 * Which weeks read as a deload: volume under 60 % of the mean of the trained weeks before, as a
 * block's deload drops load and sets. A block note will say so itself (#1719).
 */
export function deloadWeeks(volumes: number[]): boolean[] {
  return volumes.map((volume, index) => {
    const before = volumes
      .slice(0, index)
      .filter((v) => v > 0)
      .slice(-DELOAD_LOOK_BACK);
    if (volume === 0 || before.length === 0) return false;
    const mean = before.reduce((sum, v) => sum + v, 0) / before.length;
    return volume < mean * DELOAD_SHARE;
  });
}

/** The sessions from `from` to `to`, both included. */
export function sessionsIn(days: TrainingDay[], from: string, to: string): number {
  return days.filter((day) => day.date >= from && day.date <= to && isSession(day)).length;
}

/** Weeks in a row with a session, ending this week, or last week while this one is still empty. */
export function weekStreak(days: TrainingDay[], today: string): number {
  const trained = new Set(days.filter(isSession).map((day) => mondayOf(day.date)));
  let monday = mondayOf(today);
  if (!trained.has(monday)) monday = shiftDay(monday, -7);
  let streak = 0;
  while (trained.has(monday)) {
    streak += 1;
    monday = shiftDay(monday, -7);
  }
  return streak;
}

/** A run's pace over 5 km, in minutes per km: the best and the latest from runs of 5 km or more. */
export function fiveK(days: TrainingDay[]): { best: number; latest: number; date: string } | null {
  let best: number | null = null;
  let latest: { pace: number; date: string } | null = null;
  for (const day of days) {
    for (const e of day.entries) {
      if (e.kind !== "run" || e.km === undefined || e.km < FIVE_K || e.minutes === undefined) {
        continue;
      }
      const pace = e.minutes / e.km;
      best = best === null ? pace : Math.min(best, pace);
      latest = { pace, date: day.date };
    }
  }
  return best === null || latest === null ? null : { best, latest: latest.pace, date: latest.date };
}

/** A pace in minutes per km as `5:42 /km`. */
export function paceWords(pace: number): string {
  const seconds = Math.round(pace * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km`;
}

export type RecordKind = "heaviest" | "reps" | "volume";

/** A record a day set: the heaviest set, the most reps at one weight, or the most kg in a session. */
export interface TrainingRecord {
  date: string;
  exercise: string;
  kind: RecordKind;
  kg: number;
  /** The reps of a reps record, the volume of a volume record's session in kg. */
  amount: number;
}

interface Bests {
  heaviest: Map<string, number>;
  reps: Map<string, number>;
  volume: Map<string, number>;
}

/** Whether `value` beats the best under `key`, which then takes the larger of the two. */
function beats(map: Map<string, number>, key: string, value: number): boolean {
  const before = map.get(key);
  map.set(key, Math.max(value, before ?? value));
  return before !== undefined && value > before;
}

/** The records one lift sets on one day against the bests before it, which it then raises. */
function dayRecords(date: string, exercise: string, entries: TrainingEntry[], bests: Bests) {
  const found: TrainingRecord[] = [];
  const top = Math.max(...entries.map((e) => e.kg ?? 0));
  if (beats(bests.heaviest, exercise, top)) {
    found.push({ date, exercise, kind: "heaviest", kg: top, amount: 0 });
  }
  // The most reps at each weight that day, so one weight gives at most one record.
  const most = new Map<number, number>();
  for (const e of entries) {
    most.set(e.kg ?? 0, Math.max(most.get(e.kg ?? 0) ?? 0, ...(e.reps ?? [0])));
  }
  for (const [kg, reps] of most) {
    if (beats(bests.reps, `${exercise}\u0000${kg}`, reps)) {
      found.push({ date, exercise, kind: "reps", kg, amount: reps });
    }
  }
  const kg = volumeOf(entries);
  if (beats(bests.volume, exercise, kg)) {
    found.push({ date, exercise, kind: "volume", kg: 0, amount: kg });
  }
  return found;
}

/**
 * Every record in the order the days set them: a day that beats the best before it. The first day
 * of a lift, or of a lift at a weight, sets no record, since there is nothing yet to beat.
 */
export function recordsOf(days: TrainingDay[]): TrainingRecord[] {
  const bests: Bests = { heaviest: new Map(), reps: new Map(), volume: new Map() };
  return days.flatMap((day) =>
    [...new Set(strengthOf(day).map((e) => e.exercise))].flatMap((exercise) => {
      const entries = strengthOf(day, exercise).filter((e) => e.kg !== undefined);
      return entries.length === 0 ? [] : dayRecords(day.date, exercise, entries, bests);
    }),
  );
}

/** A record in words: `Kniebeuge 85 kg`, `Kniebeuge 8 reps at 80 kg`, `Kniebeuge 2,040 kg in a session`. */
export function recordWords(record: TrainingRecord, grouped: (n: number) => string): string {
  if (record.kind === "heaviest") return `${record.exercise} ${grouped(record.kg)} kg`;
  if (record.kind === "reps") {
    return `${record.exercise} ${grouped(record.amount)} reps at ${grouped(record.kg)} kg`;
  }
  return `${record.exercise} ${grouped(Math.round(record.amount))} kg in a session`;
}

/** A lift's bests over every day given, for the detail view. */
export function bestsOf(
  days: TrainingDay[],
  exercise: string,
): { heaviest: number | null; reps: { kg: number; reps: number } | null; volume: number | null } {
  let heaviest: number | null = null;
  let reps: { kg: number; reps: number } | null = null;
  let volume: number | null = null;
  for (const day of days) {
    const entries = strengthOf(day, exercise).filter((e) => e.kg !== undefined);
    if (entries.length === 0) continue;
    for (const e of entries) {
      const kg = e.kg ?? 0;
      heaviest = Math.max(heaviest ?? 0, kg);
      const most = Math.max(...(e.reps ?? [0]));
      if (reps === null || most > reps.reps || (most === reps.reps && kg > reps.kg)) {
        reps = { kg, reps: most };
      }
    }
    volume = Math.max(volume ?? 0, volumeOf(entries));
  }
  return { heaviest, reps, volume };
}

/** The last days a lift was trained, newest first, with its lines that day. */
export function lastSessions(
  days: TrainingDay[],
  exercise: string,
  count: number,
): { date: string; entries: TrainingEntry[] }[] {
  return days
    .map((day) => ({ date: day.date, entries: strengthOf(day, exercise) }))
    .filter((day) => day.entries.length > 0)
    .reverse()
    .slice(0, count);
}

/** One week in short, as the week review and the overview card give it. */
export function weekTally(
  days: TrainingDay[],
  monday: string,
): { sessions: number; sets: number; minutes: number; records: TrainingRecord[] } {
  const sunday = shiftDay(monday, 6);
  const inWeek = days.filter((day) => day.date >= monday && day.date <= sunday);
  return {
    sessions: inWeek.filter(isSession).length,
    sets: inWeek.flatMap((day) => strengthOf(day)).reduce((sum, e) => sum + (e.sets ?? 0), 0),
    minutes: cardioTotal(cardioWeeks(inWeek, [monday])[0]),
    records: recordsOf(days).filter((r) => r.date >= monday && r.date <= sunday),
  };
}
