/**
 * One `## Training` line read into its fields, or null for a plain bullet.
 * `cases/training-cases.json` holds it to the backend parser in `training/lines.py`.
 */

import { noteBody } from "@/lib/notes/text/note-frontmatter";
import { fencedLines } from "@/lib/notes/text/note-section";

export const TRAINING_HEADING = "## Training";

export type TrainingKind = "strength" | "walk" | "run" | "ride" | "test";

/** One value of a test: a number and its unit, or passed or not. */
export interface Reading {
  amount?: number;
  unit?: string;
  passed?: boolean;
}

/** A test's values under one optional label: one per side, or one for both. */
export interface Group {
  label?: string;
  left?: Reading;
  right?: Reading;
  value?: Reading;
}

/** The fields a line gives and no others, as the case table writes an entry. */
export interface TrainingEntry {
  kind: TrainingKind;
  exercise: string;
  kg?: number;
  bodyweight?: true;
  reps?: number[];
  sets?: number;
  seconds?: number;
  rpe?: number;
  e1rm?: number;
  minutes?: number;
  km?: number;
  heart_rate?: number;
  groups?: Group[];
}

const VS = "\\uFE0F?";
const NUMBER = "[0-9]{1,9}(?:[.,][0-9]{1,9})?";
const RPE = "[0-9]{1,2}(?:[.,][0-9])?";
const UNIT = "cm|°|punkte|punkt|points?";
const VALUE = `-?${NUMBER}[ \\t]*(?:${UNIT})|(?:nicht[ \\t]+)?ok`;
// A word that is not a side or a result, so `L 11 cm` and `nicht ok` never read as a label.
const LABEL = "(?!(?:L|R|ok|nicht)(?![^ \\t]))[^ \\t,0-9-][^ \\t,]*";

const HEAD = new RegExp(
  `^- (🏋|🚶|🏃|🚲|📏)${VS}[ \\t]+\\[\\[([^\\[\\]|]*)(?:\\|[^\\[\\]]*)?\\]\\](.*)$`,
  "u",
);
const WEIGHTED = new RegExp(
  `^[ \\t]+(?:(${NUMBER})[ \\t]*kg|(bw))((?:[ \\t]+[0-9]{1,3})+)(?:[ \\t]+@(${RPE}))?[ \\t]*$`,
  "iu",
);
const TIMED = new RegExp(
  `^[ \\t]+([0-9]{1,3})[ \\t]*x[ \\t]*(${NUMBER})[ \\t]*(s|min)[ \\t]*$`,
  "iu",
);
const CARDIO = new RegExp(
  `^[ \\t]+(${NUMBER})[ \\t]*min(?:[ \\t]+(${NUMBER})[ \\t]*km)?(?:[ \\t]+❤${VS}[ \\t]*([0-9]{1,3}))?[ \\t]*$`,
  "iu",
);
const GROUP = new RegExp(
  `^(?:(${LABEL})[ \\t]+)?(?:L[ \\t]+(${VALUE})[ \\t]+R[ \\t]+(${VALUE})|(${VALUE}))$`,
  "iu",
);
const VALUE_PARTS = new RegExp(`^(?:(-?${NUMBER})[ \\t]*(${UNIT})|(nicht[ \\t]+)?ok)$`, "iu");
const GROUP_SPLIT = /,[ \t]+/;

export type CardioKind = "walk" | "run" | "ride";

/** The mark a cardio line opens with, by kind; the one table both reading and writing use. */
export const CARDIO_MARK: Record<CardioKind, string> = { walk: "🚶", run: "🏃", ride: "🚲" };

const CARDIO_KINDS = new Map<string, TrainingKind>(
  (Object.keys(CARDIO_MARK) as CardioKind[]).map((kind) => [CARDIO_MARK[kind], kind]),
);

/** Epley drifts past ten reps, so a longer set gives no estimate. */
const MAX_E1RM_REPS = 10;

const MAX_RPE = 10;

type Fields = Omit<TrainingEntry, "kind" | "exercise">;

function number(text: string): number {
  return Number(text.replace(",", "."));
}

/** A group that may be absent, as a number, or undefined. */
function optional(text: string | undefined): number | undefined {
  return text ? number(text) : undefined;
}

/** `{ [key]: value }`, or nothing where the value is undefined, so the entry has only the fields it gives. */
function field<K extends keyof Fields>(key: K, value: Fields[K] | undefined): Partial<Fields> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Fields>);
}

/** The best estimated one-rep max over `reps` at `kg`, rounded half up to a tenth, or undefined. */
export function e1rm(kg: number, reps: number[]): number | undefined {
  const estimates = reps
    .filter((count) => count <= MAX_E1RM_REPS)
    .map((count) => (kg * (30 + count)) / 30);
  return estimates.length ? Math.floor(Math.max(...estimates) * 10 + 0.5) / 10 : undefined;
}

function weighted([, weight, bw, sets = "", effort]: RegExpExecArray): Fields | null {
  const reps = sets
    .trim()
    .split(/[ \t]+/)
    .map(Number);
  const kg = optional(weight);
  const rpe = optional(effort);
  const badWeight = kg !== undefined && kg <= 0;
  const badRpe = rpe !== undefined && (rpe < 1 || rpe > MAX_RPE);
  if (Math.min(...reps) < 1 || badWeight || badRpe) return null;
  return {
    ...field("kg", kg),
    ...field("bodyweight", bw ? true : undefined),
    reps,
    sets: reps.length,
    ...field("rpe", rpe),
    ...field("e1rm", kg === undefined ? undefined : e1rm(kg, reps)),
  };
}

function timed([, count = "", time = "", unit = ""]: RegExpExecArray): Fields | null {
  const sets = Number(count);
  const seconds = number(time) * (unit.toLowerCase() === "min" ? 60 : 1);
  return sets > 0 && seconds > 0 ? { sets, seconds } : null;
}

function strength(rest: string): Fields | null {
  const byWeight = WEIGHTED.exec(rest);
  if (byWeight) return weighted(byWeight);
  const byTime = TIMED.exec(rest);
  return byTime ? timed(byTime) : null;
}

function cardio(rest: string): Fields | null {
  const found = CARDIO.exec(rest);
  if (!found) return null;
  const minutes = number(found[1] ?? "");
  const km = optional(found[2]);
  const heart = optional(found[3]);
  if (minutes <= 0 || (km !== undefined && km <= 0) || heart === 0) return null;
  return { minutes, ...field("km", km), ...field("heart_rate", heart) };
}

function reading(text: string | undefined): Reading | undefined {
  const found = text === undefined ? null : VALUE_PARTS.exec(text);
  if (!found) return undefined;
  if (found[1]) return { amount: number(found[1]), unit: found[2] ?? "" };
  return { passed: found[3] === undefined };
}

function group([, label, left, right, value]: RegExpExecArray): Group {
  const parts: [keyof Group, Reading | string | undefined][] = [
    ["label", label],
    ["left", reading(left)],
    ["right", reading(right)],
    ["value", reading(value)],
  ];
  return Object.fromEntries(parts.filter(([, part]) => part !== undefined));
}

function test(rest: string): Fields | null {
  if (!/^[ \t]/.test(rest)) return null;
  const groups: Group[] = [];
  for (const part of rest.replace(/^[ \t]+|[ \t]+$/g, "").split(GROUP_SPLIT)) {
    const found = GROUP.exec(part);
    if (!found) return null;
    groups.push(group(found));
  }
  return { groups };
}

function fieldsOf(mark: string, rest: string): [TrainingKind, Fields | null] {
  if (mark === "🏋") return ["strength", strength(rest)];
  if (mark === "📏") return ["test", test(rest)];
  return [CARDIO_KINDS.get(mark) ?? "walk", cardio(rest)];
}

/** The entry a training line holds, or null for a line that is a plain bullet. */
export function parseTrainingLine(text: string): TrainingEntry | null {
  const [, mark = "", target = "", rest = ""] = HEAD.exec(text) ?? [];
  if (!target.trim()) return null;
  const [kind, fields] = fieldsOf(mark, rest);
  return fields && { kind, exercise: target.trim(), ...fields };
}

/** A training line of the note, with where it sits. */
export interface Placed {
  /** Offset of the line's first character in the note. */
  from: number;
  text: string;
  entry: TrainingEntry;
}

const SECTION_END = /^#{1,2}[ \t]/;

/**
 * Every line that parses under each exact `## Training`, the heading `appendUnderEdit` writes
 * under; a `### training` elsewhere is not the log. Fenced and frontmatter lines never count.
 */
export function trainingLines(text: string): Placed[] {
  const lines = text.split("\n");
  const above = lines.length - noteBody(text).split("\n").length;
  const { coded } = fencedLines(lines.slice(above));
  const placed: Placed[] = [];
  let inside = false;
  let offset = 0;
  for (const [index, line] of lines.entries()) {
    const counts = index >= above && !coded.has(index - above);
    if (counts && line.trimEnd() === TRAINING_HEADING) inside = true;
    else if (counts && SECTION_END.test(line)) inside = false;
    else if (counts && inside) {
      const entry = parseTrainingLine(line);
      if (entry !== null) placed.push({ from: offset, text: line, entry });
    }
    offset += line.length + 1;
  }
  return placed;
}

/** Whether a note's `## Training` holds an entry, which makes its day a training day. */
export function hasTraining(text: string): boolean {
  return trainingLines(text).length > 0;
}
