/**
 * The drink lines of a daily note's `## Log`: what a tap writes, and what the
 * lines already there add up to.
 *
 * The format is `docs/reference/log-format.md`, and the backend's parser in
 * `log.py` is the one `GET /api/log` answers from. This reads the same lines
 * off the open buffer, so a tap shows in the totals at once rather than after
 * the save and the index; `log-cases.json` holds both to the same rows.
 */

export type DrinkKind = "water" | "coffee" | "alcohol";

export const DRINKS: DrinkKind[] = ["water", "coffee", "alcohol"];

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

/** Grams of ethanol per millilitre, the density the format names. */
const ETHANOL = 0.789;

/** A fence opens or closes a code block, and a heading ends the `## Log` above it. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
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
  if (alcohol === null) return null;
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

/** The lines under each `## Log` of `text`, without fenced code or the frontmatter. */
function logLines(text: string): string[] {
  const lines = text.split("\n");
  // The frontmatter runs from a first `---` to the next one, and holds no section.
  const close = lines[0] === "---" ? lines.indexOf("---", 1) : -1;
  const found: string[] = [];
  let fence: string | null = null;
  let inLog = false;
  for (const line of lines.slice(close === -1 ? 0 : close + 1)) {
    const run = FENCE.exec(line)?.[1];
    if (fence !== null) {
      // A fence closes on its own character, at least as long as the one that opened it.
      if (
        run !== undefined &&
        run[0] === fence[0] &&
        run.length >= fence.length &&
        line.trim() === run
      ) {
        fence = null;
      }
      continue;
    }
    if (run !== undefined) {
      fence = run;
      continue;
    }
    if (HEADING.test(line)) {
      inLog = line.trimEnd() === LOG_HEADING;
      continue;
    }
    if (inLog) found.push(line);
  }
  return found;
}

/** What a day's log adds up to. Every kind is present, zero where nothing was logged. */
export interface DrinkTotals {
  water: { ml: number };
  coffee: { count: number };
  alcohol: { count: number; ml: number; grams: number };
}

/**
 * The totals of the drink lines under `## Log` in `text`. Each sum is taken whole
 * and rounded to a tenth once, as `GET /api/log` does.
 */
export function drinkTotals(text: string): DrinkTotals {
  let water = 0;
  let coffee = 0;
  let drinks = 0;
  let alcoholMl = 0;
  let grams = 0;
  for (const line of logLines(text)) {
    const drink = parse(line);
    if (drink === null) continue;
    if (drink.kind === "water") water += drink.ml;
    else if (drink.kind === "coffee") coffee += drink.count;
    else {
      drinks += drink.count;
      alcoholMl += drink.ml ?? 0;
      grams += drink.grams ?? 0;
    }
  }
  return {
    water: { ml: tenth(water) },
    coffee: { count: coffee },
    alcohol: { count: drinks, ml: tenth(alcoholMl), grams: tenth(grams) },
  };
}
