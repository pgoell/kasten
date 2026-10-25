/**
 * The kinds the log config note names, and what a tap on each one writes.
 *
 * The note is `99 Misc/01 Config/log.md`. Each `- ` line at column 0 names a kind
 * by its mark, and says what one tap logs and whether it has a goal. 💧, ☕ and 🍺
 * are the built-in kinds the card has always had; any other mark is a kind of the
 * user's own, counted by `parseKindLine`. The grammar is in
 * `docs/reference/log-format.md`, and `log-config-cases.json` holds its cases.
 */

import { amountLine, type DrinkKind, type DrinkTotals, logLines, tenth } from "@/lib/log-lines";

export interface Goal {
  type: "floor" | "ceiling";
  value: number;
}

export interface LogKind {
  mark: string;
  name: string;
  /** Absent on a last kind, which takes no tap. */
  tap?: number;
  /** `""` for none. */
  unit: string;
  goal?: Goal;
  /** Set on a last kind, whose day value is its last line rather than a sum. */
  last?: true;
  /** Set on the three built-in kinds, whose lines the totals already read. */
  builtin?: DrinkKind;
}

export type FoodField = "kcal" | "protein" | "carbs" | "fat";

export type FoodGoals = Partial<Record<FoodField, Goal>>;

export interface BrokenLine {
  line: number;
  text: string;
}

export interface LogConfig {
  kinds: LogKind[];
  food: FoodGoals;
  broken: BrokenLine[];
}

/** What a missing note gives: the three kinds the card had before the note existed. */
export const DEFAULT_CONFIG: LogConfig = {
  kinds: [
    { mark: "💧", name: "water", tap: 250, unit: "ml", builtin: "water" },
    { mark: "☕", name: "coffee", tap: 1, unit: "", builtin: "coffee" },
    { mark: "🍺", name: "alcohol", tap: 1, unit: "", builtin: "alcohol" },
  ],
  food: {},
  broken: [],
};

/** One to nine digits, then an optional point or comma and one to nine more, as the log format reads a number. */
const NUMBER = "[0-9]{1,9}(?:[.,][0-9]{1,9})?";

/** The marks of the built-in kinds, each with the kind it stands for. */
const BUILTINS = new Map<string, DrinkKind>([
  ["💧", "water"],
  ["☕", "coffee"],
  ["🍺", "alcohol"],
]);

/** The food line's field markers. A kind on one would read as a field inside a food line. */
const FIELD_MARKS = new Set(["🔥", "🥩", "🍞", "🧈"]);

/**
 * A kind line: the mark with its U+FE0F dropped, the name up to the colon, then a tap or
 * `last`, each with an optional unit, then an optional goal. The mark is astral, so the
 * `u` flag. The lookahead keeps the word `last` from reading as a unit.
 */
const KIND_LINE = new RegExp(
  `^- (?<mark>\\p{So})️?[ \\t]+(?<name>[^:]+):[ \\t]*(?:(?<tap>${NUMBER})(?:[ \\t]+(?<unit>[A-Za-z]+))?|(?:(?!last\\b)(?<lastUnit>[A-Za-z]+)[ \\t]*,[ \\t]*)?(?<last>last))(?:[ \\t]*,[ \\t]*(?<sense>min|max)[ \\t]+(?<goal>${NUMBER}))?[ \\t]*$`,
  "iu",
);

/** A food line: its marker, its name up to the colon, then the goals. */
const FOOD_LINE = /^- 🍽️?[ \t]+([^:]+):(.*)$/u;

/** One goal of a food line: a field, `min` or `max`, and its number. */
const FOOD_GOAL = new RegExp(
  `^[ \\t]*(kcal|protein|carbs|fat)[ \\t]+(min|max)[ \\t]+(${NUMBER})[ \\t]*$`,
  "iu",
);

/** A written number as a float, a comma read as the point. */
const amount = (text: string): number => Number(text.replace(",", "."));

/** A product with the float noise cut: 1.1 litres is 1100 millilitres, not 1100.0000000000002. */
const clean = (value: number): number => Number(value.toPrecision(15));

/** A food line's goals, or null where it names no field, repeats one or gives a value no parser reads. */
function parseFoodLine(text: string): FoodGoals | null {
  const head = FOOD_LINE.exec(text);
  if (head === null || (head[1] ?? "").trim() === "") return null;
  const goals: FoodGoals = {};
  for (const piece of (head[2] ?? "").split(",")) {
    const goal = FOOD_GOAL.exec(piece);
    if (goal === null) return null;
    const field = (goal[1] ?? "").toLowerCase() as FoodField;
    const value = amount(goal[3] ?? "");
    if (field in goals || value <= 0) return null;
    goals[field] = {
      type: (goal[2] ?? "").toLowerCase() === "min" ? "floor" : "ceiling",
      value,
    };
  }
  return goals;
}

/** A kind line as its kind, or null where the line is broken. The caller checks the mark is free. */
function parseKindConfig(text: string): LogKind | null {
  const found = KIND_LINE.exec(text)?.groups;
  if (found === undefined) return null;
  const mark = found.mark ?? "";
  const label = (found.name ?? "").trim();
  const unit = found.unit ?? found.lastUnit ?? "";
  const builtin = BUILTINS.get(mark);
  const last = found.last !== undefined;
  // A built-in kind keeps its tap, so `last` is broken on one.
  if (label === "" || FIELD_MARKS.has(mark) || (last && builtin !== undefined)) return null;
  const tapText = found.tap ?? "";
  const tap = amount(tapText);
  if (!last) {
    if (tap <= 0) return null;
    if (builtin === "water" && !/^(ml|l)$/i.test(unit)) return null;
    // Coffee and alcohol are counted, so a tap is a whole number with no unit.
    if (
      (builtin === "coffee" || builtin === "alcohol") &&
      (unit !== "" || !/^[0-9]+$/.test(tapText))
    ) {
      return null;
    }
  }
  const goalValue = amount(found.goal ?? "");
  if (found.sense !== undefined && goalValue <= 0) return null;
  // The day's water is counted in millilitres, so a goal in litres is scaled to match.
  const scale = builtin === "water" && unit.toLowerCase() === "l" ? 1000 : 1;
  const kind: LogKind = { mark, name: label, unit };
  if (last) kind.last = true;
  else kind.tap = tap;
  if (found.sense !== undefined) {
    kind.goal = {
      type: found.sense.toLowerCase() === "min" ? "floor" : "ceiling",
      value: clean(goalValue * scale),
    };
  }
  if (builtin !== undefined) kind.builtin = builtin;
  return kind;
}

/**
 * The config a note gives. A null note (missing or unreadable) gives the defaults;
 * any other note gives exactly the kinds its valid lines name, and lists the rest as broken.
 */
export function parseConfig(note: string | null): LogConfig {
  if (note === null) return DEFAULT_CONFIG;
  const lines = note.split("\n");
  // The frontmatter runs from a first `---` to the next one, as in logLines, and holds no config.
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const kinds: LogKind[] = [];
  const broken: BrokenLine[] = [];
  const marks = new Set<string>();
  let food: FoodGoals | null = null;
  for (const [index, text] of lines.entries()) {
    if (index <= close || !text.startsWith("- ")) continue;
    const line = index + 1;
    // Only the first food line that reads counts, so a second one is broken.
    if (text.startsWith("- 🍽")) {
      const goals = parseFoodLine(text);
      if (goals === null || food !== null) broken.push({ line, text });
      else food = goals;
      continue;
    }
    const kind = parseKindConfig(text);
    // The first line keeps a mark, so a later line with the same mark is broken.
    if (kind === null || marks.has(kind.mark)) {
      broken.push({ line, text });
      continue;
    }
    marks.add(kind.mark);
    kinds.push(kind);
  }
  return { kinds, food: food ?? {}, broken };
}

/** The line one tap writes for `kind` with nothing typed, or null on a last kind, which has no tap. */
export function tapLine(kind: LogKind): string | null {
  if (kind.tap === undefined) return null;
  // A String of a tiny number is an exponent, `1e-7`, which no log parser reads.
  const tap = kind.tap.toFixed(9).replace(/\.?0+$/, "");
  return `- ${kind.mark} ${tap}${kind.unit === "" ? "" : ` ${kind.unit}`}`;
}

/**
 * The line a tap writes for `typed` under `kind`, or why `typed` is no amount of
 * that kind. The empty amount is the default line, or on a last kind a request for
 * the amount; a kind of your own takes a bare number with its unit added, or a number
 * with its own unit.
 */
export function kindLine(kind: LogKind, typed: string): string | { why: string; ask?: true } {
  const text = typed.trim();
  if (text === "") {
    return (
      tapLine(kind) ?? {
        why: `Type the ${kind.name}${kind.unit === "" ? "" : ` in ${kind.unit}`}`,
        ask: true,
      }
    );
  }
  if (kind.builtin !== undefined) return amountLine(kind.builtin, typed);
  const bare = new RegExp(`^${NUMBER}$`).test(text);
  const line = `- ${kind.mark} ${bare && kind.unit !== "" ? `${text} ${kind.unit}` : text}`;
  return parseKindLine(kind, line) === null ? { why: `not a ${kind.name} amount: ${typed}` } : line;
}

/**
 * The amount a log line holds for a kind of your own, or null: `- <mark> <NUMBER>[ <unit>]`
 * as the whole line, with the unit required and matched case-insensitively iff the kind has one.
 */
export function parseKindLine(kind: LogKind, line: string): number | null {
  const found = new RegExp(
    `^- ${kind.mark}️?[ \\t]+(${NUMBER})(?:[ \\t]+([A-Za-z]+))?[ \\t]*$`,
    "u",
  ).exec(line);
  if (found === null) return null;
  const [, count = "", written = ""] = found;
  if (written.toLowerCase() !== kind.unit.toLowerCase()) return null;
  const value = amount(count);
  return value > 0 ? value : null;
}

/**
 * The day's total for `kind`. The built-in kinds read their totals; a last kind takes
 * its last line's amount, or null with none; a kind of your own sums its lines under
 * `## Log`, rounded once as the other totals are.
 */
export function kindTotal(kind: LogKind, text: string, totals: DrinkTotals): number | null {
  if (kind.builtin === "water") return totals.water.ml;
  if (kind.builtin === "coffee") return totals.coffee.count;
  if (kind.builtin === "alcohol") return totals.alcohol.count;
  if (kind.last === true) return lastValue(kind, logLines(text));
  let sum = 0;
  for (const line of logLines(text)) sum += parseKindLine(kind, line) ?? 0;
  return tenth(sum);
}

/** The amount of the last line that parses for `kind`, unrounded, or null when none does. */
export function lastValue(kind: LogKind, lines: string[]): number | null {
  let value: number | null = null;
  for (const line of lines) value = parseKindLine(kind, line) ?? value;
  return value;
}
