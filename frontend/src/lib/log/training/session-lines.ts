/**
 * What the session screen writes under `## Training`: a set extends the exercise's last line when
 * the weight matches, else starts a line. `docs/reference/training/training-format.md` has the lines.
 */

import {
  parseTrainingLine,
  TRAINING_HEADING,
  type TrainingEntry,
} from "@/lib/log/training/training-lines";
import { appendUnderEdit, type Edit, sectionOf } from "@/lib/notes/text/note-section";

/** One set as the screen shows it: a weight in kg, or null for body weight. */
export interface DoneSet {
  kg: number | null;
  reps?: number;
  seconds?: number;
  rpe?: number;
}

export interface WeightedSet {
  exercise: string;
  kg: number | null;
  reps: number;
  rpe: number | null;
}

export type CardioKind = "walk" | "run" | "ride";

const CARDIO_MARK: Record<CardioKind, string> = { walk: "🚶", run: "🏃", ride: "🚲" };

/** A training line of the note, with where it sits. */
export interface Placed {
  /** Offset of the line's first character in the note. */
  from: number;
  text: string;
  entry: TrainingEntry;
}

/** A number as a line writes it: a point, and no trailing zeros. */
export function written(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Every line under the note's first `## Training` that parses, in order. */
export function trainingLines(text: string): Placed[] {
  const section = sectionOf(text, "Training");
  if (section === null) return [];
  const lines = text.split("\n");
  let offset = 0;
  for (let index = 0; index < section.line - 1; index += 1) {
    offset += (lines[index] ?? "").length + 1;
  }
  const placed: Placed[] = [];
  for (const line of section.text.split("\n")) {
    const entry = parseTrainingLine(line);
    if (entry !== null) placed.push({ from: offset, text: line, entry });
    offset += line.length + 1;
  }
  return placed;
}

/** The sets the note holds for one exercise today, line by line. */
export function setsOf(text: string, exercise: string): DoneSet[] {
  return trainingLines(text)
    .filter(({ entry }) => entry.kind === "strength" && entry.exercise === exercise)
    .flatMap(({ entry }) => entrySets(entry));
}

/** The sets one strength entry stands for; a line's RPE goes with each of its sets. */
export function entrySets(entry: TrainingEntry): DoneSet[] {
  const kg = entry.kg ?? null;
  const rpe = entry.rpe === undefined ? {} : { rpe: entry.rpe };
  if (entry.seconds !== undefined) {
    return Array.from({ length: entry.sets ?? 0 }, () => ({ kg, seconds: entry.seconds, ...rpe }));
  }
  return (entry.reps ?? []).map((reps) => ({ kg, reps, ...rpe }));
}

function lastLine(text: string, exercise: string): Placed | undefined {
  return trainingLines(text)
    .filter(({ entry }) => entry.kind === "strength" && entry.exercise === exercise)
    .at(-1);
}

function replaceLine(placed: Placed, line: string): Edit {
  return { from: placed.from, to: placed.from + placed.text.length, insert: line };
}

/**
 * The edit for one weighted or body weight set. The line keeps one RPE, so an extended line
 * takes the new set's; a set with no RPE leaves the line's as it was.
 */
export function setEdit(text: string, set: WeightedSet): Edit {
  const last = lastLine(text, set.exercise);
  const sameWeight =
    last !== undefined &&
    last.entry.seconds === undefined &&
    (set.kg === null ? last.entry.bodyweight === true : last.entry.kg === set.kg);
  const rpe = set.rpe === null ? "" : ` @${written(set.rpe)}`;
  if (last !== undefined && sameWeight) {
    const head = last.text.replace(/[ \t]+@[0-9.,]+[ \t]*$|[ \t]+$/u, "");
    const kept = set.rpe === null && last.entry.rpe !== undefined ? ` @${last.entry.rpe}` : rpe;
    return replaceLine(last, `${head} ${set.reps}${kept}`);
  }
  const weight = set.kg === null ? "bw" : `${written(set.kg)} kg`;
  const line = `- 🏋 [[${set.exercise}]] ${weight} ${set.reps}${rpe}`;
  return appendUnderEdit(text, TRAINING_HEADING, line);
}

/** The edit for one held set: `3x 45 s` counts up when the time matches, else a new line. */
export function heldEdit(text: string, exercise: string, seconds: number): Edit {
  const last = lastLine(text, exercise);
  if (last !== undefined && last.entry.seconds === seconds) {
    const line = last.text.replace(/([0-9]{1,3})([ \t]*x)/iu, (_, count: string, x: string) => {
      return `${Number(count) + 1}${x}`;
    });
    return replaceLine(last, line);
  }
  return appendUnderEdit(text, TRAINING_HEADING, `- 🏋 [[${exercise}]] 1x ${written(seconds)} s`);
}

/** The edit for a walk, run or ride typed by hand. */
export function cardioEdit(
  text: string,
  kind: CardioKind,
  exercise: string,
  minutes: number,
  km: number | null,
): Edit {
  const distance = km === null ? "" : ` ${written(km)} km`;
  const line = `- ${CARDIO_MARK[kind]} [[${exercise}]] ${written(minutes)} min${distance}`;
  return appendUnderEdit(text, TRAINING_HEADING, line);
}

/** A set as the screen lists it: `80 kg × 8 @8`, `bw × 6`, `45 s`. */
export function setLabel(set: DoneSet): string {
  const rpe = set.rpe === undefined ? "" : ` @${written(set.rpe)}`;
  if (set.seconds !== undefined) return `${written(set.seconds)} s${rpe}`;
  const weight = set.kg === null ? "bw" : `${written(set.kg)} kg`;
  return `${weight} × ${set.reps ?? 0}${rpe}`;
}

/** A day's sets in short, as "last time" shows them: `80 kg · 8 7 7`, lines joined by `, `. */
export function dayLabel(entries: TrainingEntry[]): string {
  return entries
    .map((entry) => {
      const weight = entry.bodyweight
        ? "bw"
        : entry.kg === undefined
          ? ""
          : `${written(entry.kg)} kg`;
      if (entry.seconds !== undefined) return `${entry.sets ?? 0}× ${written(entry.seconds)} s`;
      return `${weight} · ${(entry.reps ?? []).join(" ")}`;
    })
    .join(", ");
}
