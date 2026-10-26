import { render, screen } from "@testing-library/react";
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
