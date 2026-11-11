/**
 * The writes to a block note: an exercise dropped on a day joins that day's session, and a block
 * that has ended gives the next one, its weights taken from what the block's last weeks logged.
 */

import { shiftDay } from "@/lib/core/clock";
import {
  type Block,
  DAY_NAMES,
  endOf,
  linkOf,
  type Prescription,
  prescriptionOf,
  targetOf,
  weekdayOf,
  weekIndex,
} from "@/lib/log/training/block/block-note";
import type { Exercise, TrainingDay } from "@/lib/log/training/exercises";
import { written } from "@/lib/log/training/session/lines";
import { closing, setField } from "@/lib/notes/text/note-frontmatter";
import type { Edit } from "@/lib/notes/text/note-section";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The one change that turns `before` into `after`, so undo and the cursor stay whole. */
export function editBetween(before: string, after: string): Edit {
  let from = 0;
  while (from < before.length && before[from] === after[from]) from += 1;
  let tail = 0;
  while (
    tail < before.length - from &&
    tail < after.length - from &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { from, to: before.length - tail, insert: after.slice(from, after.length - tail) };
}

/** Where the region under line `at` ends: the next heading of `level` hashes or fewer. */
function regionEnd(lines: string[], at: number, level: number): number {
  let end = at + 1;
  while (end < lines.length) {
    const hashes = /^(#{1,6})\s/u.exec(lines[end] ?? "")?.[1]?.length;
    if (hashes !== undefined && hashes <= level) break;
    end += 1;
  }
  while (end > at + 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  return end;
}

function headingAt(lines: string[], heading: string, from = 0, to = lines.length): number {
  const at = lines.slice(from, to).findIndex((line) => line.trimEnd() === heading);
  return at === -1 ? -1 : at + from;
}

/** Puts `added` at the end of the `##` section `name`, making the section at the foot if needed. */
function addToSection(lines: string[], name: string, added: string[]): string[] {
  const at = headingAt(lines, `## ${name}`);
  if (at === -1) {
    while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") lines.pop();
    return [...lines, "", `## ${name}`, ...added, ""];
  }
  const end = regionEnd(lines, at, 2);
  return [...lines.slice(0, end), ...added, ...lines.slice(end)];
}

/** The line an exercise starts with when it is dropped on a day, by how the exercise counts. */
export function startingLine(exercise: Pick<Exercise, "name" | "counts">): string {
  if (exercise.counts === "time") return `- [[${exercise.name}]] 3x30 s`;
  if (exercise.counts === "reps") return `- [[${exercise.name}]] 3x8, +1 rep, bw`;
  return `- [[${exercise.name}]] 3x8-12, double`;
}

/**
 * The note with `exercise` added to the session on `day` (Monday 0). A day with no session gets
 * the next free letter, its own `###` under `## Sessions` and a line under `## Days`.
 */
export function addToDay(
  text: string,
  block: Block,
  day: number,
  exercise: Pick<Exercise, "name" | "counts">,
): string {
  const line = startingLine(exercise);
  let lines = text.split("\n");
  const held = block.days[day] ?? null;
  const letter = held ?? [...LETTERS].find((free) => !block.sessions.has(free)) ?? "Z";
  const sessions = headingAt(lines, "## Sessions");
  const sessionsEnd = sessions === -1 ? -1 : regionEnd(lines, sessions, 2);
  const own = sessions === -1 ? -1 : headingAt(lines, `### ${letter}`, sessions, sessionsEnd);
  if (own === -1) {
    lines = addToSection(lines, "Sessions", [`### ${letter}`, line]);
  } else {
    const end = regionEnd(lines, own, 3);
    lines = [...lines.slice(0, end), line, ...lines.slice(end)];
  }
  if (held === null) lines = addToSection(lines, "Days", [`- ${DAY_NAMES[day]}: ${letter}`]);
  return lines.join("\n");
}

/** A prescription written back as a line, the weight replaced. */
export function prescriptionLine(p: Prescription, kg: number | null): string {
  const range = p.high > p.low ? `${p.low}-${p.high}` : String(p.low);
  const parts = [`${p.sets}x${range}${p.held ? " s" : ""}${p.rpe === null ? "" : ` @${p.rpe}`}`];
  if (p.rule === "double") parts.push("double");
  if (p.rule === "kg") parts.push(`+${written(p.step)} kg`);
  if (p.rule === "reps") parts.push(`+${p.step} ${p.step === 1 ? "rep" : "reps"}`);
  if (p.bodyweight) parts.push("bw");
  else if (kg !== null) parts.push(`${written(kg)} kg`);
  return `- [[${p.exercise}]] ${parts.join(", ")}`;
}

/** The heaviest set of `exercise` logged in the block's last two build weeks, or null. */
function loggedTop(block: Block, days: TrainingDay[], exercise: string): number | null {
  const builds = block.weeks.flatMap((week, at) => (week.deload ? [] : [at])).slice(-2);
  const weights = days
    .filter((day) => builds.includes(weekIndex(block, day.date) ?? -1))
    .flatMap((day) => day.entries)
    .filter((entry) => entry.kind === "strength" && entry.exercise === exercise)
    .flatMap((entry) => (entry.kg === undefined ? [] : [entry.kg]));
  return weights.length === 0 ? null : Math.max(...weights);
}

function lastBuildWeek(block: Block): number {
  const builds = block.weeks.flatMap((week, at) => (week.deload ? [] : [at]));
  return builds.at(-1) ?? block.weeks.length - 1;
}

/** The first day of the next block: the day after this one ends, or the next Monday if that passed. */
export function nextStart(block: Block, today: string): string {
  const after = shiftDay(endOf(block), 1);
  if (after >= today) return after;
  return shiftDay(today, (7 - weekdayOf(today)) % 7);
}

/**
 * The next block's name: the old one with the month of its start, or the month added. When the
 * month is the same, as when a block ends midmonth, the whole date tells the two apart.
 */
export function nextName(name: string, start: string): string {
  const dated = /\d{4}-\d{2}(?:-\d{2})?/u;
  if (!dated.test(name)) return `${name} ${start.slice(0, 7)}`;
  const monthly = name.replace(dated, start.slice(0, 7));
  return monthly === name ? name.replace(dated, start) : monthly;
}

/**
 * The next block's note: the same note with the new start, and each session line's weight set to
 * the heaviest set logged in the last two build weeks, else what the last build week planned.
 */
export function nextBlockText(
  text: string,
  block: Block,
  days: TrainingDay[],
  today: string,
): string {
  const last = lastBuildWeek(block);
  let section = "";
  const lines = text.split("\n").map((line) => {
    const heading = /^##\s+(.+?)\s*$/u.exec(line);
    if (heading !== null) section = (heading[1] ?? "").toLowerCase();
    const link = section === "sessions" ? linkOf(line) : null;
    if (link === null || link.mark !== "") return line;
    const p = prescriptionOf(link.exercise, link.rest);
    const kg = loggedTop(block, days, p.exercise) ?? targetOf(block, p, last).kg;
    return prescriptionLine(p, kg);
  });
  // The server stamps a new note's own id and dates, so the old block's go.
  const fresh = lines.filter((line, at) => at === 0 || !STAMPS.test(line) || !inHead(lines, at));
  return setField(fresh.join("\n"), "start", nextStart(block, today));
}

const STAMPS = /^(id|created|modified)\s*:/u;

function inHead(lines: string[], at: number): boolean {
  return closing(lines) > at;
}
