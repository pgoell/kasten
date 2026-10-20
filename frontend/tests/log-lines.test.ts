import { describe, expect, it } from "vitest";
import cases from "@/lib/log-cases.json";
import { amountLine, drinkTotals, parseDrink } from "@/lib/log-lines";

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

describe("drinkTotals", () => {
  const day = (...lines: string[]) => ["# 2026-10-20 Tuesday", "", "## Log", ...lines].join("\n");

  it("sums this note's own water, coffee and alcohol under ## Log", () => {
    const totals = drinkTotals(day("- 💧 500 ml", "- ☕ 2", "- 🍺 1 0.5 l 5%"));
    expect(totals).toEqual({
      water: { ml: 500 },
      coffee: { count: 2 },
      alcohol: { count: 1, ml: 500, grams: 19.7 },
    });
  });

  it("answers zero for every kind where nothing is logged", () => {
    expect(drinkTotals("# 2026-10-20\n\n## Log\n")).toEqual({
      water: { ml: 0 },
      coffee: { count: 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
    });
  });

  it("skips a line inside a fenced code block", () => {
    const text = day("```", "- 💧 500 ml", "```", "- ☕ 1");
    expect(drinkTotals(text).water.ml).toBe(0);
    expect(drinkTotals(text).coffee.count).toBe(1);
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
