/**
 * The drink and food lines of a daily note's `## Log`: what a tap writes, and what the lines already there add up to.
 * The open buffer is read, so a tap shows in the totals at once. `log-cases.json` holds it to the backend parser in `log.py`.
 */

import { masked } from "@/lib/tag-rule";

export type DrinkKind = "water" | "coffee" | "alcohol";

/** The heading every entry sits under, made by the first write as `## Done` is. */
export const LOG_HEADING = "## Log";

/** What one tap writes where no other amount was given. */
export const DEFAULT_LINE: Record<DrinkKind, string> = {
  water: "- 💧 250 ml",
  coffee: "- ☕ 1",
  alcohol: "- 🍺 1",
};

/** The emoji each kind is written with. */
const MARKER: Record<DrinkKind, string> = { water: "💧", coffee: "☕", alcohol: "🍺" };

/** The variation selector each marker may carry, as `☕️` does. */
const VS = "️?";

/** One to nine digits, then an optional point or comma and one to nine more. */
const NUMBER = "[0-9]{1,9}(?:[.,][0-9]{1,9})?";

const WATER = new RegExp(`^- 💧${VS}[ \\t]+(${NUMBER})[ \\t]*(ml|l)[ \\t]*$`, "i");
const COFFEE = new RegExp(`^- ☕${VS}[ \\t]+([0-9]{1,9})[ \\t]*$`, "i");
const ALCOHOL = new RegExp(
  `^- 🍺${VS}[ \\t]+([0-9]{1,9})(?:[ \\t]+(${NUMBER})[ \\t]*(ml|l))?(?:[ \\t]+(${NUMBER})[ \\t]*%)?[ \\t]*$`,
  "i",
);

/** A food line's marker that opens a field: the four the format names. */
type FoodMark = "🔥" | "🥩" | "🍞" | "🧈";

/** The entry field a food line's field sets. */
type FoodField = "kcal" | "protein" | "carbs" | "fat";

/** Each marker's field and the unit its value may carry, as `log.py` reads them. */
const FOOD_FIELDS: Record<FoodMark, { name: FoodField; unit: string }> = {
  "🔥": { name: "kcal", unit: "kcal" },
  "🥩": { name: "protein", unit: "g" },
  "🍞": { name: "carbs", unit: "g" },
  "🧈": { name: "fat", unit: "g" },
};

/** A food line's opening: the marker, then an optional meal with its colon. */
const FOOD_HEAD = new RegExp(`^- 🍽${VS}[ \\t]+(?:(breakfast|lunch|dinner|snack):)?`, "i");

/** A field: its marker, its number and the unit it may carry. The markers are astral, so the `u` flag. */
const FIELD = `([🔥🥩🍞🧈])${VS}[ \\t]+(${NUMBER})(?:[ \\t]*(kcal|g))?`;
const FIELD_START = /[🔥🥩🍞🧈]/u;
const FIELD_EACH = new RegExp(FIELD, "giu");
const FIELD_RUN = new RegExp(`^${FIELD}(?:[ \\t]+${FIELD})*[ \\t]*$`, "iu");

/** Grams of ethanol per millilitre, the density the format names. */
const ETHANOL = 0.789;

/**
 * A fence opens or closes a code block, and a heading ends the `## Log` above it.
 * A backtick run opens only when no backtick follows it, as the note-section reader reads it, or the two would disagree.
 */
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)/;
const HEADING = /^#{1,2} /;

/** A written number as a float, a comma read as the point. */
const amount = (text: string): number => Number(text.replace(",", "."));

/** Millilitres in one of `unit`: a litre is a thousand, and anything else is millilitres. */
const factor = (unit: string): number => (unit.toLowerCase() === "l" ? 1000 : 1);

/** A product with the float noise cut: 0.33 times a thousand must read as 330, not 330.00000000000006. */
const clean = (value: number): number => Number(value.toPrecision(15));

/**
 * A number rounded to one decimal the way Python's `round` does. An exact tie
 * goes to the even tenth, where `toFixed` takes it up, so 0.25 is 0.2.
 */
export function tenth(value: number): number {
  // A tie is an odd multiple of a quarter, the only values a tenth falls exactly between.
  if (Number.isInteger(value * 4) && (value * 4) % 2 === 1) {
    const below = Math.floor(value * 10);
    return (below % 2 === 0 ? below : below + 1) / 10;
  }
  return Number(value.toFixed(1));
}

/** A drink line as its kind and fields. Grams are left unrounded, as the day's total sums them. */
export type Drink =
  | { kind: "water"; ml: number }
  | { kind: "coffee"; count: number }
  | { kind: "alcohol"; count: number; ml?: number; strength?: number; grams?: number };

function parse(line: string): Drink | null {
  const water = WATER.exec(line);
  if (water) {
    const ml = clean(amount(water[1] ?? "") * factor(water[2] ?? ""));
    return ml > 0 ? { kind: "water", ml } : null;
  }
  const coffee = COFFEE.exec(line);
  if (coffee) {
    const count = Number(coffee[1]);
    return count > 0 ? { kind: "coffee", count } : null;
  }
  const alcohol = ALCOHOL.exec(line);
  return alcohol === null ? null : alcoholOf(alcohol);
}

function alcoholOf(alcohol: RegExpExecArray): Drink | null {
  const count = Number(alcohol[1]);
  const ml =
    alcohol[2] === undefined
      ? undefined
      : clean(amount(alcohol[2]) * factor(alcohol[3] ?? "") * count);
  const strength = alcohol[4] === undefined ? undefined : amount(alcohol[4]);
  if (count < 1 || (ml !== undefined && ml <= 0) || (strength !== undefined && strength > 100)) {
    return null;
  }
  // Grams need both a volume and a strength.
  const grams =
    ml !== undefined && strength !== undefined ? ((ml * strength) / 100) * ETHANOL : undefined;
  return { kind: "alcohol", count, ml, strength, grams };
}

/** A food line's words and the fields it gives: each field is set only where the line gives it. */
export interface FoodFields {
  meal?: string;
  words: string;
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export type Food = FoodFields & { kind: "food" };

/**
 * The food a line holds, read as `_food` in `log.py` reads it, or null for a line that holds none.
 * A marker in a code span or link is words, so the search for the first field runs on the masked line.
 */
export function parseFood(line: string): Food | null {
  const head = FOOD_HEAD.exec(line);
  if (head === null) return null;
  const begin = head[0].length;
  const at = masked(line).slice(begin).search(FIELD_START);
  const field = at === -1 ? line.length : begin + at;
  const words = line.slice(begin, field).replace(/^[ \t]+|[ \t]+$/g, "");

  const values = at === -1 ? {} : fieldValues(line.slice(field));
  if (values === null) return null;
  if (words === "" && Object.keys(values).length === 0) return null;
  const meal = head[1]?.toLowerCase();
  return { kind: "food", ...(meal === undefined ? {} : { meal }), words, ...values };
}

function fieldValues(tail: string): Partial<Record<FoodField, number>> | null {
  // Only fields may follow the first one, and each field may come once.
  if (!FIELD_RUN.test(tail)) return null;
  const values: Partial<Record<FoodField, number>> = {};
  for (const [, mark, number, unit] of tail.matchAll(FIELD_EACH)) {
    const { name, unit: expected } = FOOD_FIELDS[mark as FoodMark];
    if (name in values || (unit !== undefined && unit.toLowerCase() !== expected)) return null;
    values[name] = amount(number ?? "");
  }
  return values;
}

/** The drink a log line holds, or null for a line that holds none, food included. */
export function parseDrink(line: string): Drink | null {
  const drink = parse(line);
  if (drink?.kind === "alcohol" && drink.grams !== undefined) {
    return { ...drink, grams: tenth(drink.grams) };
  }
  return drink;
}

/**
 * The line a tap writes for `typed` under `kind`, or why `typed` is no amount of
 * that kind. The empty amount is the default; a bare number is millilitres for water.
 */
export function amountLine(kind: DrinkKind, typed: string): string | { why: string } {
  const text = typed.trim();
  if (text === "") return DEFAULT_LINE[kind];
  const bare = kind === "water" && /^[0-9]+(?:[.,][0-9]+)?$/.test(text);
  const line = `- ${MARKER[kind]} ${bare ? `${text} ml` : text}`;
  return parseDrink(line)?.kind === kind ? line : { why: `not a ${kind} amount: ${typed}` };
}

// A fence closes on its own character, at least as long as the one that opened it.
const closesFence = (fence: string, run: string | undefined, line: string): boolean =>
  run !== undefined && run[0] === fence[0] && run.length >= fence.length && line.trim() === run;

/** The lines under each `## Log` of `text`, without fenced code or the frontmatter. */
export function logLines(text: string): string[] {
  const lines = text.split("\n");
  // The frontmatter runs from a first `---` to the next one, and holds no section.
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const scan: LogScan = { fence: null, inLog: false };
  return lines.slice(close === -1 ? 0 : close + 1).filter((line) => scanLine(scan, line));
}

interface LogScan {
  fence: string | null;
  inLog: boolean;
}

/** Moves the scan past `line`: true when the line is one under `## Log`. */
function scanLine(scan: LogScan, line: string): boolean {
  const match = FENCE.exec(line);
  const run = match?.[1];
  if (scan.fence !== null) {
    if (closesFence(scan.fence, run, line)) scan.fence = null;
    return false;
  }
  if (run !== undefined && (run[0] === "~" || !match?.[2]?.includes("`"))) {
    scan.fence = run;
    return false;
  }
  if (HEADING.test(line)) {
    scan.inLog = line.trimEnd() === LOG_HEADING;
    return false;
  }
  return scan.inLog;
}

/** What a day's log adds up to. Every kind is present, zero where nothing was logged. */
export interface DrinkTotals {
  water: { ml: number };
  coffee: { count: number };
  alcohol: { count: number; ml: number; grams: number };
  food: { kcal: number; protein: number; carbs: number; fat: number };
}

/**
 * The totals of the drink and food lines under `## Log` in `text`. Each sum is
 * taken whole and rounded to a tenth once, as `GET /api/log` does.
 */
export function drinkTotals(text: string): DrinkTotals {
  const sum = { water: 0, coffee: 0, drinks: 0, alcoholMl: 0, grams: 0 };
  const food = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const line of logLines(text)) {
    const eaten = parseFood(line);
    if (eaten !== null) addFood(food, eaten);
    else addDrink(sum, parse(line));
  }
  const { water, coffee, drinks, alcoholMl, grams } = sum;
  const { kcal, protein, carbs, fat } = food;
  return {
    water: { ml: tenth(water) },
    coffee: { count: coffee },
    alcohol: { count: drinks, ml: tenth(alcoholMl), grams: tenth(grams) },
    food: { kcal: tenth(kcal), protein: tenth(protein), carbs: tenth(carbs), fat: tenth(fat) },
  };
}

function addFood(sum: DrinkTotals["food"], food: Food): void {
  sum.kcal += food.kcal ?? 0;
  sum.protein += food.protein ?? 0;
  sum.carbs += food.carbs ?? 0;
  sum.fat += food.fat ?? 0;
}

function addDrink(
  sum: { water: number; coffee: number; drinks: number; alcoholMl: number; grams: number },
  drink: Drink | null,
): void {
  if (drink === null) return;
  if (drink.kind === "water") sum.water += drink.ml;
  else if (drink.kind === "coffee") sum.coffee += drink.count;
  else {
    sum.drinks += drink.count;
    sum.alcoholMl += drink.ml ?? 0;
    sum.grams += drink.grams ?? 0;
  }
}

/** The words cleaned so a line written with them parses back to them, as `foodLine` needs. */
const FIELD_MARK = /[🔥🥩🍞🧈]️?/gu;

/**
 * Words with nothing a food line would read as syntax left in: no field marker, backtick, wikilink bracket or line break.
 * Single spaces too, and no colon after a leading meal word, which would name a meal the words do not.
 */
function cleanWords(words: string): string {
  return words
    .replace(/[\r\n\t]/g, " ")
    .replace(FIELD_MARK, "")
    .replace(/`|\[\[|\]\]/g, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^(breakfast|lunch|dinner|snack):/i, "$1");
}

/**
 * A field's value rounded as the line writes it, or undefined where no parser reads it back.
 * The format takes 0 to nine digits, so a minus sign, 1e9 or more, NaN and infinity are left out.
 */
const writable = (
  value: number | undefined,
  round: (value: number) => number,
): number | undefined => {
  if (value === undefined) return undefined;
  const rounded = round(value);
  return rounded >= 0 && rounded < 1e9 ? rounded : undefined;
};

/**
 * The food line the card's search logs, which `parseFood` reads back to the same fields.
 * Kcal is written whole and the grams to a tenth. A field no parser reads is left out.
 */
export function foodLine(food: FoodFields): string {
  const whole = writable(food.kcal, Math.round);
  const kcal = whole === undefined ? "" : `🔥 ${whole} kcal`;
  const grams = (value: number | undefined, mark: string) => {
    const tenths = writable(value, tenth);
    return tenths === undefined ? "" : `${mark} ${tenths} g`;
  };
  const parts = [
    food.meal ? `${food.meal}:` : "",
    cleanWords(food.words),
    kcal,
    grams(food.protein, "🥩"),
    grams(food.carbs, "🍞"),
    grams(food.fat, "🧈"),
  ];
  return `- 🍽 ${parts.filter((part) => part !== "").join(" ")}`;
}
