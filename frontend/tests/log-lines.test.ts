import { describe, expect, it } from "vitest";
import cases from "@/lib/log/log-cases.json";
import { amountLine, drinkTotals, foodLine, parseDrink, parseFood } from "@/lib/log/log-lines";

interface Row {
  id: string;
  line: string;
  entry: { kind: string; abv?: number; [field: string]: unknown } | null;
}

const FOOD = "- 🍽";

/** The rows this parser answers: each drink row, and each plain bullet that is no food line. */
const rows = (cases as Row[]).filter(
  (row) =>
    row.entry?.kind === "water" ||
    row.entry?.kind === "coffee" ||
    row.entry?.kind === "alcohol" ||
    !row.line.startsWith(FOOD),
);

/** A row's entry as this parser names it: the table's `abv` is the parser's `strength`. */
function expected(row: Row) {
  if (row.entry === null) return null;
  const { abv, ...rest } = row.entry;
  return abv === undefined ? rest : { ...rest, strength: abv };
}

describe("parseDrink, against the shared cases", () => {
  it.each(rows.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    expect(parseDrink(row.line)).toEqual(expected(row));
  });
});

describe("parseDrink, food", () => {
  it("answers null for a food line", () => {
    expect(parseDrink("- 🍽 Apple")).toBeNull();
  });
});

const foodRows = (cases as Row[]).filter((row) => row.line.startsWith(FOOD));

describe("food lines, against the shared cases", () => {
  it.each(foodRows.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const field = (name: string) => (row.entry?.[name] as number | undefined) ?? 0;
    const totals = {
      kcal: field("kcal"),
      protein: field("protein"),
      carbs: field("carbs"),
      fat: field("fat"),
    };
    expect(drinkTotals(`## Log\n${row.line}`).food).toEqual(totals);
    expect(parseFood(row.line)).toEqual(row.entry);
  });
});

describe("drinkTotals", () => {
  const day = (...lines: string[]) => ["# 2026-10-20 Tuesday", "", "## Log", ...lines].join("\n");

  it("sums this note's own water, coffee and alcohol under ## Log", () => {
    const totals = drinkTotals(day("- 💧 500 ml", "- ☕ 2", "- 🍺 1 0.5 l 5%"));
    expect(totals).toEqual({
      water: { ml: 500 },
      coffee: { count: 2 },
      alcohol: { count: 1, ml: 500, grams: 19.7 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it("answers zero for every kind where nothing is logged", () => {
    expect(drinkTotals("# 2026-10-20\n\n## Log\n")).toEqual({
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it("skips a line inside a fenced code block", () => {
    const text = day("```", "- 💧 500 ml", "```", "- ☕ 1");
    expect(drinkTotals(text).water.ml).toBe(0);
    expect(drinkTotals(text).coffee.count).toBe(1);
  });

  it("a line of inline triple-backtick code hides no log line", () => {
    expect(drinkTotals("## Log\n- 💧 250 ml\n```x```\n- 💧 500 ml\n").water.ml).toBe(750);
  });

  it("opens no section at a ## Log inside a fence", () => {
    const text = "# 2026-10-20\n\n```\n## Log\n```\n- 💧 500 ml";
    expect(drinkTotals(text).water.ml).toBe(0);
  });

  it("reads no section in the frontmatter", () => {
    const text = "---\n## Log\n- 💧 500 ml\n---\n# 2026-10-20\n";
    expect(drinkTotals(text).water.ml).toBe(0);
  });

  it("counts no indented line", () => {
    expect(drinkTotals(day("  - 💧 500 ml")).water.ml).toBe(0);
  });

  it("counts no todo box", () => {
    expect(drinkTotals(day("- [ ] 💧 500 ml")).water.ml).toBe(0);
  });

  it("counts no line outside the section", () => {
    const text = "# 2026-10-20\n\n- 💧 500 ml\n\n## Done\n- ☕ 1\n";
    expect(drinkTotals(text)).toEqual({
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
    });
  });

  it("counts a ### inside the section as part of it", () => {
    expect(drinkTotals(day("### Morning", "- 💧 500 ml")).water.ml).toBe(500);
  });

  it("counts every ## Log when there are two", () => {
    const text = `${day("- ☕ 1")}\n\n## Done\n\n## Log\n- ☕ 2\n`;
    expect(drinkTotals(text).coffee.count).toBe(3);
  });

  it("rounds a tie to the even tenth, as Python does", () => {
    expect(drinkTotals(day("- 💧 0.25 ml")).water.ml).toBe(0.2);
    expect(drinkTotals(day("- 💧 0.75 ml")).water.ml).toBe(0.8);
  });

  it("rounds the sum once, not each line", () => {
    expect(drinkTotals(day("- 💧 0.04 ml", "- 💧 0.04 ml", "- 💧 0.04 ml")).water.ml).toBe(0.1);
  });

  it("#621 sums food kcal and macros under ## Log, rounded once", () => {
    const text = day(
      "- 🍽 a 🥩 0.04 g",
      "- 🍽 b 🥩 0.04 g",
      "- 🍽 c 🥩 0.04 g",
      "- 🍽 d 🔥 100",
      "- 🍽 e 🔥 52.5",
      "- 🍽 f 🍞 0.25 g",
    );
    expect(drinkTotals(text).food).toEqual({ kcal: 152.5, protein: 0.1, carbs: 0.2, fat: 0 });
  });
});

describe("amountLine", () => {
  it("writes the default line for an empty amount", () => {
    expect(amountLine("water", "")).toBe("- 💧 250 ml");
    expect(amountLine("coffee", "  ")).toBe("- ☕ 1");
    expect(amountLine("alcohol", "")).toBe("- 🍺 1");
  });

  it("takes a bare number for water as millilitres", () => {
    expect(amountLine("water", "330")).toBe("- 💧 330 ml");
  });

  it("writes a litre amount as typed", () => {
    expect(amountLine("water", "0,5 l")).toBe("- 💧 0,5 l");
    expect(amountLine("alcohol", "2 0.33 l 5%")).toBe("- 🍺 2 0.33 l 5%");
  });

  it("says why an amount of the wrong kind is refused", () => {
    expect(amountLine("water", "500 g")).toEqual({ why: "not a water amount: 500 g" });
  });

  it("refuses a zero amount", () => {
    expect(amountLine("water", "0")).toEqual({ why: "not a water amount: 0" });
  });
});

describe("foodLine", () => {
  it("#621 a food line written by foodLine parses back to the same fields", () => {
    const line = "- 🍽 lunch: Skyr 🔥 93 kcal 🥩 16.5 g 🍞 6 g 🧈 0.2 g";
    expect(drinkTotals(`## Log\n${line}`).food).toEqual({
      kcal: 93,
      protein: 16.5,
      carbs: 6,
      fat: 0.2,
    });
    const written = foodLine({
      meal: "lunch",
      words: "Skyr",
      kcal: 92.6,
      protein: 16.5,
      carbs: 6,
      fat: 0.200000002,
    });
    expect(written).toBe(line);
    expect(parseFood(written)).toEqual({
      kind: "food",
      meal: "lunch",
      words: "Skyr",
      kcal: 93,
      protein: 16.5,
      carbs: 6,
      fat: 0.2,
    });

    const bare = "- 🍽 Apple 🔥 52 kcal";
    expect(foodLine({ words: "Apple", kcal: 52 })).toBe(bare);
    expect(parseFood(bare)).toEqual({ kind: "food", words: "Apple", kcal: 52 });
  });

  it("#621 foodLine cleans words that would break the line", () => {
    const line = "- 🍽 lunch Soup with jam ref and cream 🔥 300 kcal 🥩 12 g";
    expect(drinkTotals(`## Log\n${line}`).food).toEqual({
      kcal: 300,
      protein: 12,
      carbs: 0,
      fat: 0,
    });
    const written = foodLine({
      words: "lunch: Soup 🔥 with `jam` [[ref]]\nand\tcream",
      kcal: 300,
      protein: 12,
    });
    expect(written).toBe(line);
    expect(parseFood(written)).toEqual({
      kind: "food",
      words: "lunch Soup with jam ref and cream",
      kcal: 300,
      protein: 12,
    });
  });

  it("#621 foodLine leaves out a field no parser can read", () => {
    const line = "- 🍽 x 🍞 3.2 g";
    expect(drinkTotals(`## Log\n${line}`).food).toEqual({
      kcal: 0,
      protein: 0,
      carbs: 3.2,
      fat: 0,
    });
    const written = foodLine({ words: "x", kcal: -5, protein: 1e9, carbs: 3.25, fat: 1e21 });
    expect(written).toBe(line);
    expect(parseFood(written)).toEqual({ kind: "food", words: "x", carbs: 3.2 });
  });
});
