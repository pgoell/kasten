import { render, screen, within } from "@testing-library/react";
import { LogTrends } from "@/components/log-trends";
import { shiftDay } from "@/lib/clock";
import type { LogDay } from "@/lib/food-api";
import { parseConfig } from "@/lib/log-kinds";
import { streakOf } from "@/lib/log-streak";
import { weekTiles } from "@/lib/review-week";
import { CONFIG_NOTE, loggedOn } from "./log-pane-fixture";

/** A day of drinks only: one water line and no food line, so no food day. */
function drinksOn(date: string, ml: number) {
  const entry: LogDay["entries"][number] = { line: 1, text: `- 💧 ${ml} ml`, kind: "water", ml };
  return { ...loggedOn(date, { water: ml }), entries: [entry] };
}

/** The text of each cell in a table's rows, header row first. */
function cellTexts(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole("row")
    .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent ?? ""));
}

/** The figure and the words of the summary tile with this label. */
function tileOf(label: string) {
  const tile = Array.from(document.querySelectorAll(".log-summary-tile")).find(
    (node) => node.querySelector("dt")?.textContent === label,
  );
  return {
    figure: tile?.querySelector(".log-summary-figure")?.textContent,
    words: tile?.querySelector(".log-summary-words")?.textContent,
  };
}

it("#1113 A1 the Within goal tile leaves a day of drinks only out of both N and M", () => {
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1500 }),
        drinksOn("2026-10-23", 250),
        loggedOn("2026-10-24", { kcal: 2500 }),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={4}
      today="2026-10-25"
    />,
  );

  // Two food days, one within the 2,000 kcal ceiling. The drinks day is no food day.
  expect(tileOf("Within goal")).toEqual({ figure: "1 of 2", words: "days at most 2,000 kcal" });
});

it("#1113 A2 the Average tile leaves a day of drinks only out of the average kcal and its day count", () => {
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1500 }),
        drinksOn("2026-10-23", 250),
        loggedOn("2026-10-24", { kcal: 2500 }),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={4}
      today="2026-10-25"
    />,
  );

  // (1,500 + 2,500) / 2 food days, not over the three logged days.
  expect(tileOf("Average")).toEqual({ figure: "2,000 kcal", words: "over 2 food days" });
});

it("#1113 I1 a food line of 0 kcal makes a food day, counted in N, M and the average", () => {
  const zeroFood: LogDay["entries"][number] = {
    line: 1,
    text: "- 🍽 🔥 0 kcal",
    kind: "food",
    kcal: 0,
  };
  render(
    <LogTrends
      days={[
        { ...loggedOn("2026-10-22", {}), entries: [zeroFood] },
        loggedOn("2026-10-23", { kcal: 1500 }),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={2}
      today="2026-10-25"
    />,
  );

  expect(tileOf("Within goal")).toEqual({ figure: "2 of 2", words: "days at most 2,000 kcal" });
  expect(tileOf("Average")).toEqual({ figure: "750 kcal", words: "over 2 food days" });
});

it("#1113 I2 a day with only a line of your own, such as weight, is left out of the Within goal and Average tiles", () => {
  const weighed: LogDay["entries"][number] = { line: 1, text: "- ⚖ 70 kg", kind: "mine" };
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1500 }),
        { ...loggedOn("2026-10-23", {}), entries: [weighed] },
        loggedOn("2026-10-24", { kcal: 1800 }),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={3}
      today="2026-10-25"
    />,
  );

  expect(tileOf("Within goal").figure).toBe("2 of 2");
  expect(tileOf("Average")).toEqual({ figure: "1,650 kcal", words: "over 2 food days" });
});

it("#1113 I3 a range of drinks only shows — and no food logged in the Average and Within goal tiles, and the water chart still draws the drinks", () => {
  render(
    <LogTrends
      days={[drinksOn("2026-10-22", 250), drinksOn("2026-10-23", 500)]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={2}
      today="2026-10-25"
    />,
  );

  expect(tileOf("Average")).toEqual({ figure: "—", words: "no food logged" });
  expect(tileOf("Within goal")).toEqual({ figure: "—", words: "no food logged" });
  expect(
    screen.getByRole("img", { name: "water over 2 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(2);
});

it("#1113 I4 under a kcal floor, a day of drinks only is left out of N and M, not counted short of the floor", () => {
  const config = {
    ...parseConfig(CONFIG_NOTE),
    food: { kcal: { type: "floor" as const, value: 1800 } },
  };
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1900 }),
        drinksOn("2026-10-23", 250),
        loggedOn("2026-10-24", { kcal: 1000 }),
      ]}
      config={config}
      from="2026-10-22"
      range={3}
      today="2026-10-25"
    />,
  );

  // Two food days: one at or over the 1,800 kcal floor, one short of it.
  expect(tileOf("Within goal")).toEqual({ figure: "1 of 2", words: "days at least 1,800 kcal" });
});

it("#1113 A4 the Trends Within goal tile, the week review's days within kcal and the Food streak agree on the same days", () => {
  // Monday has drinks only. Tuesday to Sunday have a food line within the 2,000 kcal ceiling.
  const days = [
    drinksOn("2026-10-19", 250),
    ...Array.from({ length: 6 }, (_, index) =>
      loggedOn(shiftDay("2026-10-19", index + 1), { kcal: 1500 }),
    ),
  ];
  const config = parseConfig(CONFIG_NOTE);
  render(<LogTrends days={days} config={config} from="2026-10-19" range={7} today="2026-10-25" />);
  const week = weekTiles({
    todos: [],
    days,
    config,
    notes: Array.from({ length: 7 }, () => ""),
    from: "2026-10-19",
    to: "2026-10-25",
  });
  const dates = Array.from({ length: 7 }, (_, index) => shiftDay("2026-10-19", index));
  const streak = streakOf(
    dates,
    new Map(days.map((day) => [day.date, day])),
    "2026-10-25",
    config.food.kcal,
  );

  expect({ trends: tileOf("Within goal").figure, week: week.withinKcal, streak }).toEqual({
    trends: "6 of 6",
    week: 6,
    streak: 6,
  });
});

it("#1116 A1 the kcal chart draws no bar for a day of drinks only and its caption averages over the food days", () => {
  render(
    <LogTrends
      days={[loggedOn("2026-10-24", { kcal: 1500 }), drinksOn("2026-10-23", 250)]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-19"
      range={7}
      today="2026-10-25"
    />,
  );

  expect(
    screen.getByRole("img", { name: "water over 7 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(2);
  const kcal = screen.getByRole("img", { name: /^kcal over 7 days/ });
  expect(kcal.querySelectorAll("rect.log-chart-bar")).toHaveLength(1);
  expect(
    screen.getByText("kcal: average 1,500 kcal over 1 food day, goal at most 2,000 kcal"),
  ).toBeInTheDocument();
});

it("#1116 A2 the protein, carbs and fat charts draw no bar for a day of drinks only and average over the food days", () => {
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-24", { kcal: 1500, protein: 120, carbs: 200, fat: 60 }),
        drinksOn("2026-10-23", 250),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-19"
      range={7}
      today="2026-10-25"
    />,
  );

  expect(
    screen.getByRole("img", { name: "protein over 7 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(1);
  expect(
    screen.getByRole("img", { name: "carbs over 7 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(1);
  expect(
    screen.getByRole("img", { name: "fat over 7 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(1);
  // The protein goal is the floor in CONFIG_NOTE; carbs and fat have none.
  expect(
    screen.getByText("protein: average 120 g over 1 food day, goal at least 100 g"),
  ).toBeInTheDocument();
  expect(screen.getByText("carbs: average 200 g over 1 food day")).toBeInTheDocument();
  expect(screen.getByText("fat: average 60 g over 1 food day")).toBeInTheDocument();
});

it("#1116 A3 the macro split caption counts the food days, not a day of drinks only", () => {
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1500, protein: 100, carbs: 200, fat: 60 }),
        loggedOn("2026-10-23", { kcal: 1500, protein: 100, carbs: 200, fat: 60 }),
        drinksOn("2026-10-24", 250),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={3}
      today="2026-10-25"
    />,
  );

  expect(screen.getByText("macros, share of kcal over 2 food days")).toBeInTheDocument();
});

it("#1126 A3 the macro split on food days with kcal but no protein, carbs or fat says no macros logged, beside a day of drinks only", () => {
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-22", { kcal: 1500 }),
        loggedOn("2026-10-23", { kcal: 1500 }),
        drinksOn("2026-10-24", 250),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={3}
      today="2026-10-25"
    />,
  );

  expect(screen.getByText("macros: no macros logged")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "macro split over 3 days" })).not.toBeInTheDocument();
});

it("#1116 A4 the By week row averages kcal and protein over the week's food days, and a week with no food day reads —", () => {
  // The week of Oct 12 has drinks only on Oct 13. The week of Oct 19 has food on Oct 19 and drinks on Oct 20.
  render(
    <LogTrends
      days={[
        loggedOn("2026-10-19", { kcal: 2000, protein: 100, water: 500 }),
        drinksOn("2026-10-20", 1000),
        drinksOn("2026-10-13", 800),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-12"
      range={14}
      today="2026-10-25"
    />,
  );

  expect(cellTexts(screen.getByRole("table", { name: "By week" }))).toEqual([
    ["Week", "kcal", "Protein", "Water", "Weight", "Days"],
    ["Oct 19", "2,000", "100", "750", "—", "2 of 7"],
    ["Oct 12", "—", "—", "800", "—", "1 of 7"],
  ]);
});

it("#1116 A6 on the issue's steps the kcal chart caption, the By week row and the Average tile read the same kcal", () => {
  // The tile rounds to a whole kcal and the caption to a tenth. On these steps they agree.
  render(
    <LogTrends
      days={[loggedOn("2026-10-24", { kcal: 1500 }), drinksOn("2026-10-23", 500)]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-19"
      range={7}
      today="2026-10-25"
    />,
  );

  expect(tileOf("Average")).toEqual({ figure: "1,500 kcal", words: "over 1 food day" });
  expect(
    screen.getByText("kcal: average 1,500 kcal over 1 food day, goal at most 2,000 kcal"),
  ).toBeInTheDocument();
  expect(cellTexts(screen.getByRole("table", { name: "By week" }))[1]?.[1]).toBe("1,500");
});

it("#1116 I1 a food line of 0 kcal draws a stub in the kcal chart beside a day of drinks only that draws none", () => {
  const zeroFood: LogDay["entries"][number] = {
    line: 1,
    text: "- 🍽 🔥 0 kcal",
    kind: "food",
    kcal: 0,
  };
  render(
    <LogTrends
      days={[{ ...loggedOn("2026-10-22", {}), entries: [zeroFood] }, drinksOn("2026-10-23", 500)]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={2}
      today="2026-10-25"
    />,
  );

  const bars = screen
    .getByRole("img", { name: /^kcal over 2 days/ })
    .querySelectorAll("rect.log-chart-bar");
  expect(bars).toHaveLength(1);
  expect(bars[0]).toHaveClass("log-chart-zero");
});

it("#1116 I2 a range of drinks only says no food logged in the food charts and the macro split, with no bar and no NaN", () => {
  render(
    <LogTrends
      days={[drinksOn("2026-10-22", 250), drinksOn("2026-10-23", 500)]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={2}
      today="2026-10-25"
    />,
  );

  expect(
    screen.getByRole("img", { name: "water over 2 days" }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(2);
  expect(
    screen.getByRole("img", { name: /^kcal over 2 days/ }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(0);
  expect(screen.getByText(/^kcal: no food logged/)).toBeInTheDocument();
  expect(screen.getByText(/^protein: no food logged/)).toBeInTheDocument();
  expect(screen.getByText(/^carbs: no food logged/)).toBeInTheDocument();
  expect(screen.getByText(/^fat: no food logged/)).toBeInTheDocument();
  expect(screen.getByText("macros: no food logged")).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("#1116 I3 a day with only a line of your own, such as weight, draws no kcal bar and is left out of the By week kcal", () => {
  const weighed: LogDay["entries"][number] = { line: 1, text: "- ⚖ 70 kg", kind: "mine" };
  render(
    <LogTrends
      days={[
        { ...loggedOn("2026-10-22", {}), entries: [weighed] },
        loggedOn("2026-10-23", { kcal: 1800 }),
      ]}
      config={parseConfig(CONFIG_NOTE)}
      from="2026-10-22"
      range={2}
      today="2026-10-25"
    />,
  );

  expect(
    screen.getByRole("img", { name: /^kcal over 2 days/ }).querySelectorAll("rect.log-chart-bar"),
  ).toHaveLength(1);
  expect(cellTexts(screen.getByRole("table", { name: "By week" }))[1]?.[1]).toBe("1,800");
});
