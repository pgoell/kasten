import { describe, expect, it } from "vitest";
import cases from "@/lib/log-config-cases.json";
import {
  DEFAULT_CONFIG,
  type FoodGoals,
  kindLine,
  kindTotal,
  type LogKind,
  parseConfig,
  parseKindLine,
  tapLine,
} from "@/lib/log-kinds";
import { DEFAULT_LINE, drinkTotals } from "@/lib/log-lines";

interface ConfigRow {
  id: string;
  line: string;
  kind: LogKind | null;
  food?: FoodGoals;
}

interface LineRow {
  id: string;
  kind: string;
  line: string;
  amount: number | null;
}

const { config, lines } = cases as { config: ConfigRow[]; lines: LineRow[] };

describe("parseConfig, against the shared cases", () => {
  it.each(config.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const broken = row.kind === null && row.food === undefined;
    expect(parseConfig(row.line)).toEqual({
      kinds: row.kind === null ? [] : [row.kind],
      food: row.food ?? {},
      broken: broken ? [{ line: 1, text: row.line }] : [],
    });
  });
});

describe("parseKindLine, against the shared cases", () => {
  it.each(lines.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const kind = parseConfig(row.kind).kinds[0] as LogKind;
    expect(parseKindLine(kind, row.line)).toBe(row.amount);
  });
});

describe("config note", () => {
  it("#623 a missing note gives the three default kinds", () => {
    expect(parseConfig(null)).toEqual(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG.kinds.map(tapLine)).toEqual([
      DEFAULT_LINE.water,
      DEFAULT_LINE.coffee,
      DEFAULT_LINE.alcohol,
    ]);
  });

  it("#623 a repeated mark is broken and the first line keeps it", () => {
    expect(parseConfig("- 🍵 tea: 1 cup\n- 🍵 cha: 2 cup")).toEqual({
      kinds: [{ mark: "🍵", name: "tea", tap: 1, unit: "cup" }],
      food: {},
      broken: [{ line: 2, text: "- 🍵 cha: 2 cup" }],
    });
  });

  it("#623 a second food line is broken", () => {
    expect(parseConfig("- 🍽 lunch: kcal min 500\n- 🍽 dinner: protein min 100")).toEqual({
      kinds: [],
      food: { kcal: { type: "floor", value: 500 } },
      broken: [{ line: 2, text: "- 🍽 dinner: protein min 100" }],
    });
  });

  it("#623 frontmatter, prose and headings are not broken and line numbers count the whole note", () => {
    const note = [
      "---",
      "title: Log",
      "tags:",
      "- vault",
      "- 🍵 hidden: 1 cup",
      "---",
      "# Log config",
      "",
      "Some prose.",
      "- 🍵 tea: 1 cup",
      "- plain bullet",
    ].join("\n");
    expect(parseConfig(note)).toEqual({
      kinds: [{ mark: "🍵", name: "tea", tap: 1, unit: "cup" }],
      food: {},
      broken: [{ line: 11, text: "- plain bullet" }],
    });
  });

  it("#623 a note without a coffee line has no coffee kind", () => {
    const kinds = parseConfig("- 💧 water: 250 ml\n- 🍺 alcohol: 1").kinds;
    expect(kinds.map((kind) => kind.name)).toEqual(["water", "alcohol"]);
  });
});

describe("kind of your own", () => {
  const tea: LogKind = { mark: "🍵", name: "tea", tap: 1, unit: "cup" };

  it("#623 kindLine writes a bare number with the unit and refuses words", () => {
    expect(kindLine(tea, "")).toBe("- 🍵 1 cup");
    expect(kindLine(tea, "2")).toBe("- 🍵 2 cup");
    expect(kindLine(tea, "2 cup")).toBe("- 🍵 2 cup");
    expect(kindLine(tea, "2 cup green")).toEqual({ why: "not a tea amount: 2 cup green" });
  });

  it("#623 kindTotal sums a kind of your own under ## Log only", () => {
    const text = [
      "# 2026-10-21",
      "",
      "- 🍵 5 cup",
      "",
      "## Log",
      "- 🍵 2 cup",
      "- 🍵 0,5 cup",
      "- 🍵 1 ml",
      "- 🍵 1",
    ].join("\n");
    expect(kindTotal(tea, text, drinkTotals(text))).toBe(2.5);
  });
});
