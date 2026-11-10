// @vitest-environment node
import { describe, expect, it } from "vitest";
import cases from "@/lib/log/cases/log-config-cases.json";
import {
  DEFAULT_CONFIG,
  dayConfig,
  type FoodGoals,
  kindLine,
  kindTotal,
  type LogKind,
  lastValue,
  parseConfig,
  parseKindLine,
  tapLine,
} from "@/lib/log/log-kinds";
import { DEFAULT_LINE, drinkTotals } from "@/lib/log/log-lines";

interface ConfigRow {
  id: string;
  line: string;
  kind: LogKind | null;
  food?: FoodGoals;
  training?: FoodGoals;
}

interface LineRow {
  id: string;
  kind: string;
  line: string;
  amount: number | null;
}

interface DayRow {
  id: string;
  kind: string;
  lines: string[];
  value: number | null;
}

const { config, lines, days } = cases as {
  config: ConfigRow[];
  lines: LineRow[];
  days: DayRow[];
};

describe("parseConfig, against the shared cases", () => {
  it.each(config.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const broken = row.kind === null && row.food === undefined && row.training === undefined;
    expect(parseConfig(row.line)).toEqual({
      kinds: row.kind === null ? [] : [row.kind],
      food: row.food ?? {},
      training: row.training,
      broken: broken ? [{ line: 1, text: row.line }] : [],
    });
  });
});

describe("parseKindLine, against the shared cases", () => {
  it.each(lines.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    // Over the kinds the row names, so a row whose kind is broken fails on its amounts.
    expect(parseConfig(row.kind).kinds.map((kind) => parseKindLine(kind, row.line))).toEqual([
      row.amount,
    ]);
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

  it("#1728 a training food line sits beside the everyday one, and a second of either is broken", () => {
    const note = [
      "- 🍽 food: kcal max 2200, protein min 120",
      "- 🍽 training: protein min 160",
      "- 🍽 Training: kcal max 2800",
    ].join("\n");
    expect(parseConfig(note)).toEqual({
      kinds: [],
      food: { kcal: { type: "ceiling", value: 2200 }, protein: { type: "floor", value: 120 } },
      training: { protein: { type: "floor", value: 160 } },
      broken: [{ line: 3, text: "- 🍽 Training: kcal max 2800" }],
    });
  });

  it("#1728 a day with a training entry takes the training goals over the everyday ones", () => {
    const config = parseConfig(
      "- 🍽 food: kcal max 2200, protein min 120\n- 🍽 training: protein min 160",
    );
    const rest = "# Mo\n\n## Training\n\n- went for a walk\n";
    const trained = "# Mo\n\n## Training\n\n- 🏋 [[Kniebeuge]] 80 kg 5 5 5\n\n## Log\n";
    expect(dayConfig(config, rest).food.protein?.value).toBe(120);
    expect(dayConfig(config, trained).food).toEqual({
      kcal: { type: "ceiling", value: 2200 },
      protein: { type: "floor", value: 160 },
    });
    expect(dayConfig(parseConfig("- 🍽 food: protein min 120"), trained).food.protein?.value).toBe(
      120,
    );
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

describe("#805 last kind, against the shared days", () => {
  it.each(days.map((row) => [row.id, row] as const))("%s", (_id, row) => {
    const text = `## Log\n${row.lines.join("\n")}`;
    expect(
      parseConfig(row.kind).kinds.map((kind) => kindTotal(kind, text, drinkTotals(text))),
    ).toEqual([row.value]);
  });
});

describe("#805 last kind of weight", () => {
  const WEIGHT = "- ⚖ weight: kg, last";

  it("#805 A1 a last kind takes no tap line", () => {
    expect(parseConfig(WEIGHT).kinds.map(tapLine)).toEqual([null]);
  });

  it("#805 A2 a last kind asks for its amount when none is typed", () => {
    expect(parseConfig(WEIGHT).kinds.map((kind) => kindLine(kind, ""))).toEqual([
      { why: "Type the weight in kg", ask: true },
    ]);
  });

  it("#805 A3 a typed amount writes a line like a kind of its own", () => {
    expect(
      parseConfig(WEIGHT).kinds.map((kind) =>
        ["82.4", "82,4", "82.4 kg"].map((typed) => kindLine(kind, typed)),
      ),
    ).toEqual([["- ⚖ 82.4 kg", "- ⚖ 82,4 kg", "- ⚖ 82.4 kg"]]);
  });

  it("#805 A4 a weight in another unit is refused", () => {
    expect(parseConfig(WEIGHT).kinds.map((kind) => kindLine(kind, "82.4 lb"))).toEqual([
      { why: "not a weight amount: 82.4 lb" },
    ]);
  });

  it("#805 A5 the day value is the last line that parses, as written", () => {
    const log = ["- ⚖ 82.45 kg", "- ⚖ 81 lb", "- ⚖ 0 kg"];
    expect(parseConfig(WEIGHT).kinds.map((kind) => lastValue(kind, log))).toEqual([82.45]);
  });

  it("#805 A6 a last kind with no line has no day value", () => {
    expect(parseConfig(WEIGHT).kinds.map((kind) => lastValue(kind, []))).toEqual([null]);
  });

  it("#805 A7 a last kind with no unit asks for a bare amount", () => {
    expect(parseConfig("- ⚖ weight: last").kinds.map((kind) => kindLine(kind, ""))).toEqual([
      { why: "Type the weight", ask: true },
    ]);
  });
});
