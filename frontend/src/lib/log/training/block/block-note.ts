/**
 * A training block note read into weeks, sessions, days and cardio, and the targets it sets for a
 * day. `docs/reference/training/block-note.md` gives the format; this is its only reader.
 */

import { shiftDay } from "@/lib/core/clock";
import { CARDIO_MARK, type CardioKind } from "@/lib/log/training/training-lines";
import { readField } from "@/lib/notes/text/note-frontmatter";

export const BLOCK_TYPE = "Training Block";
const KG_STEP = 2.5;
const DELOAD_LOAD = 0.6;
const LONG_GROWTH = 0.1;

/**
 * A `## ` heading; its text ends only after a non-blank, or is one blank, so a blank run is read once (#1905).
 * The leading run is taken whole, or up to the last blank a `.` reads before an all-blank end (#1908).
 */
export const SECTION_HEADING =
  /^##(?:\s+(?!\s)|\s+(?=[^\S\n\r\u2028\u2029][\n\r\u2028\u2029]*$))((?=\s).|.+?(?<!\s))\s*$/u;

/** Monday first, as the calendar and `## Days` read. */
export const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY_WORDS: Record<string, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
  mo: 0,
  di: 1,
  mi: 2,
  do: 3,
  fr: 4,
  sa: 5,
  so: 6,
};

export type Rule = "double" | "kg" | "reps" | "none";

/** One exercise line of a session: `- [[Kniebeuge]] 3x8-10 @7, double, 80 kg`. */
export interface Prescription {
  exercise: string;
  sets: number;
  low: number;
  high: number;
  /** The reps are seconds held: `3x45 s`. */
  held: boolean;
  rpe: number | null;
  rule: Rule;
  /** How much the rule adds a week: kilograms for `kg`, reps for `reps`. */
  step: number;
  kg: number | null;
  bodyweight: boolean;
}

export interface BlockWeek {
  deload: boolean;
  /** As written, `8-9`, or null. */
  rpe: string | null;
}

export interface CardioTarget {
  kind: CardioKind;
  exercise: string;
  minutes: number;
  /** One session that grows by `grow` a build week, not a weekly total. */
  long: boolean;
  grow: number;
}

export interface Block {
  start: string;
  weeks: BlockWeek[];
  sessions: Map<string, Prescription[]>;
  /** The session letter on each weekday, Monday first. */
  days: (string | null)[];
  cardio: CardioTarget[];
}

/** One exercise as a day of the block plans it. */
export interface Target {
  exercise: string;
  sets: number;
  reps: number;
  held: boolean;
  kg: number | null;
  bodyweight: boolean;
  rpe: number | null;
}

const MARK_KIND = new Map(
  (Object.entries(CARDIO_MARK) as [CardioKind, string][]).map(([kind, mark]) => [mark, kind]),
);
const LINK = /^\s*[-*]\s+(\S+\s+)?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*(.*)$/u;
const SCHEME = /(\d+)\s*[x×]\s*(\d+)(?:\s*[-–]\s*(\d+))?(\s*s\b)?/iu;
const NUMBER = "(\\d+(?:[.,]\\d+)?)";

function amount(text: string): number {
  return Number(text.replace(",", "."));
}

/** A frontmatter field without its quotes, as `frontmatter.field` reads it on the backend. */
function field(text: string, name: string): string {
  return (readField(text, name) ?? "").replace(/^["']+|["']+$/g, "");
}

export function isBlock(text: string): boolean {
  return field(text, "type").toLowerCase() === BLOCK_TYPE.toLowerCase();
}

/** The exercise a line names and what follows the link, or null for any other line. */
export function linkOf(line: string): { mark: string; exercise: string; rest: string } | null {
  const match = LINK.exec(line);
  if (match === null) return null;
  return { mark: (match[1] ?? "").trim(), exercise: (match[2] ?? "").trim(), rest: match[3] ?? "" };
}

function ruleOf(rest: string, kgStep: boolean, repStep: boolean): Rule {
  if (/double/iu.test(rest)) return "double";
  if (kgStep) return "kg";
  return repStep ? "reps" : "none";
}

export function prescriptionOf(exercise: string, rest: string): Prescription {
  const scheme = SCHEME.exec(rest);
  const low = scheme === null ? 8 : Number(scheme[2]);
  const rpe = new RegExp(`@\\s*${NUMBER}`, "u").exec(rest);
  const kgStep = new RegExp(`\\+\\s*${NUMBER}\\s*kg`, "iu").exec(rest);
  const repStep = /\+\s*(\d+)\s*reps?\b/iu.exec(rest);
  const rule = ruleOf(rest, kgStep !== null, repStep !== null);
  const weight = new RegExp(`(?<![+\\d.,])${NUMBER}\\s*kg`, "iu").exec(
    rest.replace(kgStep?.[0] ?? "\u0000", ""),
  );
  return {
    exercise,
    sets: scheme === null ? 3 : Number(scheme[1]),
    low,
    high: scheme?.[3] === undefined ? low : Math.max(low, Number(scheme[3])),
    held: scheme?.[4] !== undefined,
    rpe: rpe === null ? null : amount(rpe[1] ?? ""),
    rule,
    step: rule === "kg" ? amount(kgStep?.[1] ?? "") : rule === "reps" ? Number(repStep?.[1]) : 0,
    kg: weight === null ? null : amount(weight[1] ?? ""),
    bodyweight: /\bbw\b/iu.test(rest),
  };
}

function weekLine(line: string): { at: number; week: BlockWeek } | null {
  const match = /^\s*[-*]\s+(?:week\s+)?(\d+)\s*:\s*(.*)$/iu.exec(line);
  if (match === null) return null;
  const words = match[2] ?? "";
  const rpe = /rpe\s*([\d.,]+(?:\s*[-–]\s*[\d.,]+)?)/iu.exec(words);
  return {
    at: Number(match[1]) - 1,
    week: { deload: /deload/iu.test(words), rpe: rpe?.[1]?.replace(/\s+/g, "") ?? null },
  };
}

function dayLine(line: string): { day: number; letter: string } | null {
  const match = /^\s*[-*]\s+([A-Za-z]{2,3})\w*\s*:\s*([A-Z])\b/u.exec(line);
  const day = DAY_WORDS[(match?.[1] ?? "").toLowerCase()];
  return match === null || day === undefined ? null : { day, letter: match[2] ?? "" };
}

function cardioLine(line: string): CardioTarget | null {
  const link = linkOf(line);
  const kind = MARK_KIND.get(link?.mark ?? "");
  const minutes = /(\d+(?:[.,]\d+)?)\s*min/iu.exec(link?.rest ?? "");
  if (link === null || kind === undefined || minutes === null) return null;
  const grow = /\+\s*(\d+(?:[.,]\d+)?)\s*%/u.exec(link.rest);
  return {
    kind,
    exercise: link.exercise,
    minutes: amount(minutes[1] ?? ""),
    long: /\blong\b/iu.test(link.rest),
    grow: grow === null ? LONG_GROWTH : amount(grow[1] ?? "") / 100,
  };
}

interface Reading {
  written: BlockWeek[];
  sessions: Map<string, Prescription[]>;
  days: (string | null)[];
  cardio: CardioTarget[];
  letter: string | null;
}

/** What a line adds in each `##` section, the session letter being the reading's own. */
const SECTIONS: Record<string, (line: string, read: Reading) => void> = {
  weeks(line, read) {
    const week = weekLine(line);
    if (week !== null && week.at >= 0 && week.at < 52) read.written[week.at] = week.week;
  },
  sessions(line, read) {
    const sub = /^###\s+([A-Z])\b/u.exec(line);
    if (sub !== null) {
      read.letter = sub[1] ?? null;
      if (read.letter !== null && !read.sessions.has(read.letter))
        read.sessions.set(read.letter, []);
      return;
    }
    const link = linkOf(line);
    if (link === null || read.letter === null) return;
    read.sessions.get(read.letter)?.push(prescriptionOf(link.exercise, link.rest));
  },
  days(line, read) {
    const day = dayLine(line);
    if (day !== null) read.days[day.day] = day.letter;
  },
  cardio(line, read) {
    const target = cardioLine(line);
    if (target !== null) read.cardio.push(target);
  },
};

/** The block a note holds, or null when its frontmatter names no training block. */
export function parseBlock(text: string): Block | null {
  if (!isBlock(text)) return null;
  const start = field(text, "start");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(start)) return null;
  const read: Reading = {
    written: [],
    sessions: new Map(),
    days: DAY_NAMES.map(() => null),
    cardio: [],
    letter: null,
  };
  let section: ((line: string, read: Reading) => void) | undefined;
  for (const line of text.split("\n")) {
    const heading = SECTION_HEADING.exec(line);
    if (heading !== null) {
      section = SECTIONS[(heading[1] ?? "").toLowerCase()];
      read.letter = null;
    } else {
      section?.(line, read);
    }
  }
  const count = Number(field(text, "weeks")) || Math.max(read.written.length, 4);
  const weeks = Array.from(
    { length: count },
    (_, at) => read.written[at] ?? { deload: false, rpe: null },
  );
  return { start, weeks, sessions: read.sessions, days: read.days, cardio: read.cardio };
}

/** The block's last day. */
export function endOf(block: Block): string {
  return shiftDay(block.start, block.weeks.length * 7 - 1);
}

/** Which week of the block holds `date`, from 0, or null outside it. */
export function weekIndex(block: Block, date: string): number | null {
  if (date < block.start || date > endOf(block)) return null;
  const days = Math.round((Date.parse(date) - Date.parse(block.start)) / 86_400_000);
  return Math.floor(days / 7);
}

/** Monday 0 to Sunday 6. */
export function weekdayOf(date: string): number {
  return (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
}

function buildsBefore(block: Block, week: number): number {
  return block.weeks.slice(0, week).filter((w) => !w.deload).length;
}

function roundKg(kg: number): number {
  return Math.round(kg / KG_STEP) * KG_STEP;
}

function built(p: Prescription, builds: number): { reps: number; kg: number | null } {
  const kg = p.bodyweight ? null : p.kg;
  if (p.rule === "kg") return { reps: p.low, kg: kg === null ? null : kg + p.step * builds };
  if (p.rule === "reps") return { reps: p.low + p.step * builds, kg };
  if (p.rule !== "double") return { reps: p.low, kg };
  const range = p.high - p.low + 1;
  const bumps = Math.floor(builds / range);
  return {
    reps: p.low + (builds % range),
    kg: kg === null ? null : kg + KG_STEP * bumps,
  };
}

function weekRpe(week: BlockWeek | undefined): number | null {
  const first = /[\d.,]+/u.exec(week?.rpe ?? "")?.[0];
  return first === undefined ? null : amount(first);
}

/** What one exercise line asks for in a week of the block, from 0. A deload eases the week before. */
export function targetOf(block: Block, p: Prescription, week: number): Target {
  const deload = block.weeks[week]?.deload === true;
  const builds = buildsBefore(block, week);
  const base = built(p, deload ? Math.max(0, builds - 1) : builds);
  return {
    exercise: p.exercise,
    sets: deload ? Math.max(1, Math.round((p.sets * 2) / 3)) : p.sets,
    reps: deload ? p.low : base.reps,
    held: p.held,
    kg: deload && base.kg !== null ? roundKg(base.kg * DELOAD_LOAD) : base.kg,
    bodyweight: p.bodyweight,
    rpe: weekRpe(block.weeks[week]) ?? (deload ? null : p.rpe),
  };
}

/** A cardio line's minutes in a week: a long session grows each build week and holds in a deload. */
export function cardioMinutes(block: Block, target: CardioTarget, week: number): number {
  if (!target.long) return target.minutes;
  const deload = block.weeks[week]?.deload === true;
  const builds = Math.max(0, buildsBefore(block, week) - (deload ? 1 : 0));
  return Math.round(target.minutes * (1 + target.grow) ** builds);
}

/** The weekly cardio minutes the block asks for, or null when it names none. */
export function weeklyCardio(block: Block): number | null {
  const weekly = block.cardio.filter((target) => !target.long);
  return weekly.length === 0 ? null : weekly.reduce((sum, target) => sum + target.minutes, 0);
}

export interface DayPlan {
  week: number;
  deload: boolean;
  letter: string | null;
  targets: Target[];
}

/** What the block plans on `date`, or null outside it. */
export function planOn(block: Block, date: string): DayPlan | null {
  const week = weekIndex(block, date);
  if (week === null) return null;
  const letter = block.days[weekdayOf(date)] ?? null;
  const lines = letter === null ? [] : (block.sessions.get(letter) ?? []);
  return {
    week,
    deload: block.weeks[week]?.deload === true,
    letter,
    targets: lines.map((p) => targetOf(block, p, week)),
  };
}

/** A target in short: `3 × 9 · 82.5 kg @8`, `3 × 45 s`, `2 × 8 · bw`. */
export function targetLabel(target: Target): string {
  const amountWords = target.held ? `${target.reps} s` : String(target.reps);
  const kg = target.kg === null ? (target.bodyweight ? "bw" : null) : `${target.kg} kg`;
  const weight = target.held || kg === null ? "" : ` · ${kg}`;
  const rpe = target.rpe === null ? "" : ` @${target.rpe}`;
  return `${target.sets} × ${amountWords}${weight}${rpe}`;
}
