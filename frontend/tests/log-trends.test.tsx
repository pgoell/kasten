import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { shiftDay } from "@/lib/clock";
import { CONFIG_NOTE, logDays, renderPane, TODAY } from "./log-pane-fixture";

const { fetchLog, fetchNote, searchFood, readBarcode } = vi.hoisted(() => ({
  fetchLog: vi.fn(),
  fetchNote: vi.fn(),
  searchFood: vi.fn(),
  readBarcode: vi.fn(),
}));

vi.mock("@/lib/food-api", () => ({ fetchLog, searchFood, readBarcode }));
vi.mock("@/lib/my-foods", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/my-foods")>()),
  fetchMyFoods: async () => ({ foods: [], broken: [] }),
  addMyFood: vi.fn(),
}));
vi.mock("@/lib/api", () => ({
  fetchNote,
  NoteMissing: class NoteMissing extends Error {},
}));

/** The log config with no kcal goal: a floor on water and one on protein. */
const CONFIG_NO_KCAL = `---
title: log
---
- 💧 water: 250 ml, min 2000
- 🍽 food: protein min 100
`;

beforeEach(() => {
  fetchNote.mockResolvedValue(CONFIG_NOTE);
});

/** Presses a key on the pane, as a press reaches it from the focused list. */
function press(key: string) {
  fireEvent.keyDown(screen.getByRole("region", { name: "Log" }), { key });
}

interface Totals {
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  water?: number;
  coffee?: number;
}

/** A day with a `## Log` that adds up to `totals`, as `GET /api/log` answers it. */
function loggedOn(date: string, totals: Totals) {
  // A day with kcal has a food line, since a day with no food line is no day within the kcal goal.
  const kcal = totals.kcal ?? 0;
  return {
    date,
    path: `daily/${date}.md`,
    entries: kcal > 0 ? [{ line: 1, text: `- 🍽 🔥 ${kcal} kcal`, kind: "food", kcal }] : [],
    totals: {
      water: { ml: totals.water ?? 0 },
      coffee: { count: totals.coffee ?? 0 },
      alcohol: { count: 0, ml: 0, grams: 0 },
      food: {
        kcal: totals.kcal ?? 0,
        protein: totals.protein ?? 0,
        carbs: totals.carbs ?? 0,
        fat: totals.fat ?? 0,
      },
      mine: [],
    },
  };
}

/** The day `count` days before today, logged with `totals`. */
function back(count: number, totals: Totals) {
  return loggedOn(shiftDay(TODAY, -count), totals);
}

/** Days with no log, counted back from today, and the days over the 2,000 kcal ceiling. */
const SKIPPED = [5, 15, 20];
const OVER = [3, 9, 12, 17, 23, 28];

/**
 * Thirty days back from today, 27 of them logged. Kcal is 2,500 on the days in OVER and
 * 1,500 on the rest. Water is short of its floor every day, protein short on one day,
 * and coffee passes its ceiling of 3 once.
 */
function thirtyDays(): object[] {
  return Array.from({ length: 30 }, (_, count) => count)
    .filter((count) => !SKIPPED.includes(count))
    .map((count) =>
      back(count, {
        kcal: OVER.includes(count) ? 2500 : 1500,
        protein: count === 4 ? 40 : 120,
        carbs: 200,
        fat: 60,
        water: 1000,
        coffee: count === 9 ? 4 : 2,
      }),
    );
}

/** The text of each cell in a table's rows, header row first. */
function cellTexts(table: HTMLElement): string[][] {
  return within(table)
    .getAllByRole("row")
    .map((row) => Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent ?? ""));
}

it("#804 A7 the range buttons and 7, 3, 9 draw 7, 30 and 90 day slots", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  const month = await screen.findByRole("img", { name: "water over 30 days" });
  await waitFor(() => expect(month.querySelectorAll("rect.log-chart-bar")).toHaveLength(27));
  expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");
  // Each range draws the same eight charts in the grid, one per kind and food field.
  await waitFor(() =>
    expect(document.querySelectorAll(".log-multiples > .log-chart")).toHaveLength(8),
  );

  press("7");
  expect(fetchLog).toHaveBeenLastCalledWith(shiftDay(TODAY, -6), TODAY);
  const week = await screen.findByRole("img", { name: "water over 7 days" });
  // Day 5 back has no log, so six of the seven days draw a bar.
  await waitFor(() => expect(week.querySelectorAll("rect.log-chart-bar")).toHaveLength(6));
  expect(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelectorAll(".log-multiples > .log-chart")).toHaveLength(8);

  press("3");
  expect(fetchLog).toHaveBeenLastCalledWith(shiftDay(TODAY, -29), TODAY);
  expect(screen.getByRole("button", { name: "30d" })).toHaveAttribute("aria-pressed", "true");

  press("9");
  expect(fetchLog).toHaveBeenLastCalledWith(shiftDay(TODAY, -89), TODAY);
  const quarter = await screen.findByRole("img", { name: "water over 90 days" });
  await waitFor(() => expect(quarter.querySelectorAll("rect.log-chart-bar")).toHaveLength(27));
  expect(screen.getByRole("button", { name: "90d" })).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelectorAll(".log-multiples > .log-chart")).toHaveLength(8);
});

it("#804 A8 the summary row reads the average kcal, days within the goal as N of M and the streak", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  expect(await screen.findByText("21 of 27")).toBeInTheDocument();

  // The summary is the first thing in the Trends column, ahead of the charts.
  const summary = document.querySelector(".log-summary");
  expect(summary?.nextElementSibling?.classList.contains("log-multiples")).toBe(true);
  // 46,500 kcal over 27 logged days, rounded.
  expect(screen.getByText("1,722 kcal")).toBeInTheDocument();
  expect(screen.getByText("over 27 logged days")).toBeInTheDocument();
  expect(screen.getByText("days at most 2,000 kcal")).toBeInTheDocument();
  // Today and the two days before it are within the goal; 3 days back is over it.
  expect(screen.getByText("3 days")).toBeInTheDocument();
});

it("#804 A8 the summary's weight is an empty slot", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  // Main draws the water chart too, so the weight assertion is the one that fails there.
  await screen.findByRole("img", { name: "water over 30 days" });

  const weight = document.querySelector<HTMLElement>('.log-summary [data-slot="weight"]');
  expect(weight?.textContent).toBe("Weight—no weigh-ins yet");
});

it("#804 A8 today with no log yet does not end the streak, an earlier day with no log does", async () => {
  // Today has no log, and the day 4 back has none. Days 1, 2, 3, 5 and 6 back are within the goal.
  fetchLog.mockImplementation(logDays([1, 2, 3, 5, 6].map((count) => back(count, { kcal: 1800 }))));
  renderPane();
  press("7");
  const week = await screen.findByRole("img", { name: "water over 7 days" });
  await waitFor(() => expect(week.querySelectorAll("rect.log-chart-bar")).toHaveLength(5));

  expect(document.querySelector(".log-summary")?.textContent).toContain("Streak3 days");
});

it("#804 A9 one chart per kind and macro, all one size, a dashed goal and no bar for a day with no log", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  await waitFor(() =>
    expect(document.querySelectorAll(".log-multiples rect.log-chart-bar")).toHaveLength(8 * 27),
  );
  // Five goals: water, coffee, juice, kcal and protein. They arrive with the config note.
  await waitFor(() =>
    expect(document.querySelectorAll(".log-multiples line.log-chart-goal")).toHaveLength(5),
  );
  const kcal = screen.getByRole("img", { name: /^kcal over 30 days/ });

  // Four kinds of the config and four food fields, each in the same frame.
  const charts = document.querySelectorAll(".log-multiples > .log-chart");
  expect(charts).toHaveLength(8);
  const frames = new Set(
    Array.from(charts, (chart) => `${chart.querySelector("svg")?.getAttribute("viewBox")}`),
  );
  expect([...frames]).toEqual(["0 0 300 80"]);
  // Dashed goals sit on water, coffee, juice, kcal and protein, the five with a goal.
  expect(document.querySelectorAll(".log-multiples line.log-chart-goal")).toHaveLength(5);
  expect(kcal.querySelector('line[data-goal="2000"].log-chart-goal')).not.toBeNull();

  const alcohol = screen.getByRole("img", { name: "alcohol over 30 days" });
  expect(alcohol.querySelectorAll("line")).toHaveLength(0);
  expect(alcohol.querySelectorAll("rect.log-chart-bar")).toHaveLength(27);
});

it("#804 A9 a bar over a max goal is marked over, a floor never is", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  // Six kcal days and one coffee day pass their ceilings, and no other bar is marked.
  await waitFor(() => expect(document.querySelectorAll("rect.log-chart-over")).toHaveLength(7));
  const kcal = screen.getByRole("img", { name: "kcal over 30 days, 6 days over the goal" });
  expect(kcal.querySelectorAll("rect.log-chart-over")).toHaveLength(6);

  const coffee = screen.getByRole("img", { name: "coffee over 30 days, 1 day over the goal" });
  expect(coffee.querySelectorAll("rect.log-chart-over")).toHaveLength(1);
  // Water and protein are short of their floors, and a short floor is not a warning.
  const water = screen.getByRole("img", { name: "water over 30 days" });
  expect(water.querySelectorAll("rect.log-chart-over")).toHaveLength(0);
  const protein = screen.getByRole("img", { name: "protein over 30 days" });
  expect(protein.querySelectorAll("rect.log-chart-over")).toHaveLength(0);
});

it("#804 A9 a logged zero draws a stub bar and a day with no log draws none", async () => {
  // Today logs no coffee, the day before has no log, and two days back logs two.
  fetchLog.mockImplementation(logDays([back(0, { coffee: 0 }), back(2, { coffee: 2 })]));
  renderPane();
  const coffee = await screen.findByRole("img", { name: "coffee over 30 days" });
  await waitFor(() => expect(coffee.querySelectorAll("rect.log-chart-bar")).toHaveLength(2));

  expect(coffee.querySelector("rect.log-chart-zero")?.getAttribute("height")).toBe("1");
});

it("#804 A10 the weight chart is an empty slot with no fake points", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  await waitFor(() => expect(fetchLog).toHaveBeenCalledWith(shiftDay(TODAY, -29), TODAY));

  const slot = document.querySelector<HTMLElement>('figure.log-chart-slot[data-slot="weight"]');
  expect(slot?.textContent).toBe("WeightNo weigh-ins yet");
  expect(slot?.querySelector("svg")).toBeNull();
  expect(document.querySelectorAll(".log-trends circle, .log-trends polyline")).toHaveLength(0);
});

it("#804 A11 the macro split is one stacked bar with percentages of kcal adding up to 100", async () => {
  // Each day gives 480 kcal of protein, 800 of carbs and 540 of fat: 26, 44 and 30 per cent.
  fetchLog.mockImplementation(
    logDays(
      Array.from({ length: 7 }, (_, count) =>
        back(count, { kcal: 1820, protein: 120, carbs: 200, fat: 60 }),
      ),
    ),
  );
  renderPane();
  const split = await screen.findByRole("img", { name: "macro split over 30 days" });

  expect(split.querySelectorAll("rect")).toHaveLength(3);
  const labels = Array.from(document.querySelectorAll(".log-macro-labels li"), (item) =>
    item.textContent?.trim(),
  );
  expect(labels).toEqual(["Protein 26%", "Carbs 44%", "Fat 30%"]);
  const percents = labels.map((label) => Number(label?.replace(/\D/g, "")));
  expect(percents.reduce((total, percent) => total + percent, 0)).toBe(100);
});

it("#804 A12 the week table has a row per week with kcal, protein, water, weight and days logged", async () => {
  // Oct 15 (Thu), Oct 16 (Fri) fall in the week of Oct 12; Oct 19 (Mon) starts the next week.
  fetchLog.mockImplementation(
    logDays([
      back(6, { kcal: 1000, protein: 50, water: 500 }),
      back(5, { kcal: 2000, protein: 100, water: 1500 }),
      back(2, { kcal: 1500, protein: 80, water: 1000 }),
    ]),
  );
  renderPane();
  press("7");

  await waitFor(() =>
    expect(cellTexts(screen.getByRole("table", { name: "By week" }))).toEqual([
      ["Week", "kcal", "Protein", "Water", "Weight", "Days"],
      ["Oct 19", "1,500", "80", "1,000", "—", "1 of 3"],
      ["Oct 12", "1,500", "75", "1,000", "—", "2 of 4"],
    ]),
  );
  expect(document.querySelectorAll('.log-weeks td[data-slot="weight"]')).toHaveLength(2);
});

it("#804 I3 a range with nothing logged shows no NaN and says nothing logged", async () => {
  fetchLog.mockImplementation(logDays([]));
  renderPane();
  // The goal arrives with the config note, so wait for it before reading the words it sets.
  await waitFor(() =>
    expect(document.querySelector(".log-summary")?.textContent).toContain(
      "Within goal—nothing logged",
    ),
  );

  expect(document.querySelector(".log-summary")?.textContent).toBe(
    "Average—nothing loggedWithin goal—nothing loggedStreak—nothing loggedWeight—no weigh-ins yet",
  );
  expect(screen.getByText("macros: nothing logged")).toBeInTheDocument();
  expect(document.querySelector(".log-weeks-empty")?.textContent).toBe("nothing logged");
  expect(document.querySelectorAll("rect.log-chart-bar, rect.log-macro-protein")).toHaveLength(0);
  expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
});

it("#804 I4 with no kcal goal the summary says no kcal goal and kcal draws no goal line", async () => {
  fetchNote.mockResolvedValue(CONFIG_NO_KCAL);
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  await screen.findByRole("img", { name: "water over 30 days" });
  // Water and protein have floors, so two goal lines, and none for kcal.
  await waitFor(() =>
    expect(document.querySelectorAll(".log-multiples line.log-chart-goal")).toHaveLength(2),
  );

  expect(document.querySelector(".log-summary")?.textContent).toContain("Within goal—no kcal goal");
  const kcal = screen.getByRole("img", { name: "kcal over 30 days" });
  expect(kcal.querySelectorAll("line")).toHaveLength(0);
  expect(kcal.querySelectorAll("rect.log-chart-bar")).toHaveLength(27);
});

it("#804 I5 a chart with days over its max says how many in words", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();

  expect(
    await screen.findByText(
      "kcal: average 1,722.2 kcal over 27 logged days, goal at most 2,000 kcal, 6 days over the goal",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      "coffee: average 2.1 over 27 logged days, goal at most 3, 1 day over the goal",
    ),
  ).toBeInTheDocument();
});

it("#806 A2 with the range ending today, today's bar is full strength and the other bars are marked past", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  const water = await screen.findByRole("img", { name: "water over 30 days" });
  await waitFor(() => expect(water.querySelectorAll("rect.log-chart-bar")).toHaveLength(27));

  // Today is the last of the 30 slots and has a log, so its bar is the last one drawn.
  const bars = water.querySelectorAll("rect.log-chart-bar");
  expect(bars[bars.length - 1]).not.toHaveClass("log-chart-past");
  expect(water.querySelectorAll("rect.log-chart-past")).toHaveLength(26);
});

it("#806 A2 a range ending before today marks no bar past", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  await screen.findByRole("img", { name: "water over 30 days" });

  // The range now ends yesterday. Its 30 days run from 30 days back, and 26 of them have a log.
  press("h");
  await waitFor(() =>
    expect(fetchLog).toHaveBeenLastCalledWith(shiftDay(TODAY, -30), shiftDay(TODAY, -1)),
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("img", { name: "water over 30 days" })
        .querySelectorAll("rect.log-chart-bar"),
    ).toHaveLength(26),
  );
  expect(document.querySelectorAll("rect.log-chart-past")).toHaveLength(0);
});

it("#806 A2 a past bar over a max goal is not marked past", async () => {
  fetchLog.mockImplementation(logDays(thirtyDays()));
  renderPane();
  const kcal = await screen.findByRole("img", { name: /^kcal over 30 days/ });
  await waitFor(() => expect(kcal.querySelectorAll("rect.log-chart-bar")).toHaveLength(27));

  // Six past days pass the kcal ceiling. Their warning colour stays at full strength.
  expect(kcal.querySelectorAll("rect.log-chart-over")).toHaveLength(6);
  expect(kcal.querySelectorAll("rect.log-chart-over.log-chart-past")).toHaveLength(0);
});
