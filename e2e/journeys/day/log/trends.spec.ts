import type { Locator, Page } from "@playwright/test";
import { barsOf, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { WEIGHED as CONFIG, chart, fed, tile, trends, weeks } from "./log.ts";

const MACROS = "🥩 100 g 🍞 200 g 🧈 60 g";

for (const width of ["desktop", "phone"]) {
  test.describe(width, () => {
    if (width === "phone") test.use(phone);

    test("#1113 A1 A2 #1116 A3 a day of drinks only is no food day in the Within goal and Average tiles, the kcal chart or the macro split", async ({
      page,
      stack,
    }) => {
      const pane = await trends(
        page,
        stack.vault,
        {
          12: [`- 🍽 🔥 1500 kcal ${MACROS}`],
          13: ["- 💧 250 ml"],
          14: [`- 🍽 🔥 2500 kcal ${MACROS}`],
        },
        { narrow: width === "phone" },
      );
      await expect
        .poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 })
        .toEqual(fed(1, 3));
      await expect(tile(pane, "Within goal")).toHaveText(["1 of 2", "days at most 2,000 kcal"]);
      await expect(tile(pane, "Average")).toHaveText(["2,000 kcal", "over 2 food days"]);
      await expect(pane.getByText("macros, share of kcal over 2 food days")).toBeVisible();
    });
  });
}

test("#1113 I1 #1116 I1 a 0 kcal food line makes a food day with a stub bar, beside a day of drinks only with none", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, {
    12: ["- 🍽 🔥 0 kcal"],
    13: ["- 🍽 🔥 1500 kcal"],
    14: ["- 💧 500 ml"],
  });
  await expect
    .poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 })
    .toEqual([...fed(2), { ago: 3, stub: true }]);
  await expect(tile(pane, "Within goal")).toHaveText(["2 of 2", "days at most 2,000 kcal"]);
  await expect(tile(pane, "Average")).toHaveText(["750 kcal", "over 2 food days"]);
});

test("#1113 I2 #1116 I3 #1126 A3 a day of weight only is no food day, and food with no macros says so beside drinks", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, {
    12: ["- 🍽 🔥 1500 kcal"],
    13: ["- ⚖ 70 kg"],
    14: ["- 🍽 🔥 1800 kcal"],
    15: ["- 💧 250 ml"],
  });
  await expect.poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 }).toEqual(fed(1, 3));
  await expect(tile(pane, "Within goal")).toHaveText(["2 of 2", "days at most 2,000 kcal"]);
  await expect(tile(pane, "Average")).toHaveText(["1,650 kcal", "over 2 food days"]);
  expect((await weeks(pane))[1]?.slice(0, 2)).toEqual(["Nov 9", "1,650"]);
  await expect(pane.getByText("macros: no macros logged")).toBeVisible();
  await expect(pane.getByRole("img", { name: "macro split over 7 days" })).toHaveCount(0);
});

test("#1113 I3 #1116 I2 a range of drinks only says no food logged in the tiles, food charts and macro split, and draws the drinks", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, { 12: ["- 💧 250 ml"], 13: ["- 💧 500 ml"] });
  await expect.poll(() => barsOf(chart(pane, "water"), 7), { timeout: 15_000 }).toEqual(fed(2, 3));
  await expect(tile(pane, "Average")).toHaveText(["—", "no food logged"]);
  await expect(tile(pane, "Within goal")).toHaveText(["—", "no food logged"]);
  expect(await barsOf(chart(pane, "kcal"), 7)).toEqual([]);
  for (const name of ["kcal", "protein", "carbs", "fat"]) {
    await expect(
      pane.locator("figcaption", { hasText: new RegExp(`^${name}: no food logged`) }),
    ).toBeVisible();
  }
  await expect(pane.getByText("macros: no food logged")).toBeVisible();
  await expect(pane).not.toContainText(/NaN|Infinity/);
});

test("#1113 I4 under a kcal floor a day of drinks only is left out, not counted short of the floor", async ({
  page,
  stack,
}) => {
  const pane = await trends(
    page,
    stack.vault,
    { 12: ["- 🍽 🔥 1900 kcal"], 13: ["- 💧 250 ml"], 14: ["- 🍽 🔥 1000 kcal"] },
    { config: CONFIG.replace("kcal max 2000", "kcal min 1800") },
  );
  await expect.poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 }).toEqual(fed(1, 3));
  await expect(tile(pane, "Within goal")).toHaveText(["1 of 2", "days at least 1,800 kcal"]);
});

test("#1113 A4 the Within goal and Streak tiles and the week review's Days within kcal agree on the same days", async ({
  page,
  stack,
}) => {
  const days: Record<number, string[]> = { 9: ["- 💧 250 ml"] };
  for (let day = 10; day <= 15; day++) days[day] = ["- 🍽 🔥 1500 kcal"];
  const pane = await trends(page, stack.vault, days);
  await expect.poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 }).toHaveLength(6);
  await expect(tile(pane, "Within goal")).toHaveText(["6 of 6", "days at most 2,000 kcal"]);
  await expect(tile(pane, "Streak")).toHaveText(["6 days", "in a row within the kcal goal"]);

  const week = "01 Periodic/01 Weekly/2026-W46.md";
  await vaultWith(stack.vault, { [week]: "# 2026-W46\n" });
  await page.goto(`/?note=${encodeURIComponent(week)}`);
  const kcal = page
    .locator(".review-tile")
    .filter({ has: page.getByText("Days within kcal", { exact: true }) });
  await expect(kcal.locator("p")).toHaveText(
    ["Days within kcal", "6 of 7", "days within the goal"],
    {
      timeout: 15_000,
    },
  );
});

test("#1116 A1 A2 A6 the kcal and macro charts, the Average tile and the By week row average over the food days", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, {
    13: ["- 💧 500 ml"],
    14: ["- 🍽 🔥 1500 kcal 🥩 120 g 🍞 200 g 🧈 60 g"],
  });
  await expect.poll(() => barsOf(chart(pane, "water"), 7), { timeout: 15_000 }).toHaveLength(2);
  for (const name of ["kcal", "protein", "carbs", "fat"]) {
    expect(await barsOf(chart(pane, name), 7), name).toEqual(fed(1));
  }
  for (const words of [
    "kcal: average 1,500 kcal over 1 food day, goal at most 2,000 kcal",
    "protein: average 120 g over 1 food day, goal at least 100 g",
    "carbs: average 200 g over 1 food day",
    "fat: average 60 g over 1 food day",
  ]) {
    await expect(pane.getByText(words, { exact: true })).toBeVisible();
  }
  await expect(tile(pane, "Average")).toHaveText(["1,500 kcal", "over 1 food day"]);
  expect((await weeks(pane))[1]?.slice(0, 2)).toEqual(["Nov 9", "1,500"]);
});

test("#1116 A4 the By week row averages kcal and protein over the week's food days, and a week of drinks only reads —", async ({
  page,
  stack,
}) => {
  const pane = await trends(
    page,
    stack.vault,
    { 3: ["- 💧 800 ml"], 9: ["- 🍽 🔥 2000 kcal 🥩 100 g", "- 💧 500 ml"], 10: ["- 💧 1000 ml"] },
    { span: "30d" },
  );
  await expect.poll(() => barsOf(chart(pane, "kcal"), 30), { timeout: 15_000 }).toEqual(fed(6));
  expect((await weeks(pane)).slice(0, 3)).toEqual([
    ["Week", "kcal", "Protein", "Water", "Weight", "Days"],
    ["Nov 9", "2,000", "100", "750", "—", "2 of 7"],
    ["Nov 2", "—", "—", "800", "—", "1 of 7"],
  ]);
});

const WEIGH = "- ⚖ weight: kg, last";
const today = (page: Page) => page.getByRole("region", { name: "Today" });
/** The Today row whose name is exactly `name`. */
const row = (page: Page, name: string) =>
  today(page)
    .locator(".log-pane-reading")
    .filter({ has: page.locator(".log-pane-name", { hasText: new RegExp(`^${name}$`) }) });
/** Each dot of a line chart: its height in the chart and whether it draws in the warning colour. */
const dots = (chart: Locator) =>
  chart.evaluate((svg: SVGSVGElement) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--k-warn)";
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    return [...svg.querySelectorAll("circle")].map((dot) => ({
      cy: dot.cy.baseVal.value,
      warn: getComputedStyle(dot).fill === warn,
    }));
  });
const dashed = (chart: Locator) =>
  chart.locator("line").evaluateAll((all) => all.filter((at) => getComputedStyle(at).strokeDasharray !== "none").length);

test("#805 A7 A8 A9 A10 a month of weigh-ins: the row, the line with its average, the tile and the week column", async ({
  page,
  stack,
}) => {
  const kg = { 15: 82.4, 14: 82.8, 12: 83.1, 11: 82, 10: 82.9, 9: 83.6, 6: 84.2 };
  const days = Object.fromEntries(Object.entries(kg).map(([day, n]) => [day, [`- ⚖ ${n} kg`]]));
  const pane = await trends(page, stack.vault, days, { span: "30d" });
  const line = pane.getByRole("img", { name: "weight over 30 days, 7 weigh-ins, change -1.8 kg" });
  await expect(line).toBeVisible({ timeout: 15_000 });
  await expect(line.locator("xpath=ancestor::figure")).toContainText("weight: 7 weigh-ins, latest 82.4 kg");
  await expect(row(page, "Weight")).toContainText("82.4 kg");
  await expect(row(page, "Weight")).toContainText("7-day average 82.8 kg");
  await expect(line.locator("polyline")).toHaveCount(1);
  const cys = (await dots(line)).map((dot) => dot.cy);
  expect(cys).toHaveLength(7);
  // The lowest weigh-in sits near the foot and the highest near the top, not both near zero.
  expect(Math.max(...cys)).toBeGreaterThan(70);
  expect(Math.min(...cys)).toBeLessThan(10);
  await expect(line.locator("rect")).toHaveCount(0);
  // Water, kcal, protein, carbs and fat from the config, and the weight line among them.
  await expect(pane.locator(".log-multiples > .log-chart")).toHaveCount(6);
  await expect(pane.locator(".log-multiples").getByRole("img", { name: /^weight over/ })).toHaveCount(1);
  await expect(tile(pane, "Weight")).toHaveText(["-1.8 kg", "from 84.2 to 82.4 kg"]);
  const table = await weeks(pane);
  expect(table[0]?.[4]).toBe("Weight");
  expect(table.slice(1, 3).map((week) => [week[0], week[4]])).toEqual([
    ["Nov 9", "82.8"],
    ["Nov 2", "84.2"],
  ]);
});

test("#805 I6 I7 a weight over its max and a waist past its floor each get a row, line, tile and column", async ({
  page,
  stack,
}) => {
  const config = CONFIG.replace(WEIGH, `${WEIGH}, max 85\n- 📏 waist: cm, last, min 70`);
  const days = { 15: ["- ⚖ 86.1 kg", "- 📏 90 cm"], 14: ["- ⚖ 82.4 kg"], 13: ["- ⚖ 84 kg"] };
  const pane = await trends(page, stack.vault, days, { config, span: "30d" });
  await expect(row(page, "Weight")).toContainText("86.1 kg", { timeout: 15_000 });
  await expect(row(page, "Weight")).toContainText("at most 85, over");
  await expect(row(page, "Waist")).toContainText("90 cm");
  await expect(row(page, "Waist")).toContainText("at least 70, met");
  const colours = await Promise.all(
    ["Weight", "Waist", "Water"].map((name) =>
      row(page, name).locator(".log-pane-goal", { hasText: /^at / }).evaluate((goal) => getComputedStyle(goal).color),
    ),
  );
  expect(new Set(colours).size).toBe(3);

  const weight = chart(pane, "weight");
  expect((await dots(weight)).map((dot) => dot.warn)).toEqual([false, false, true]);
  expect(await dashed(weight)).toBe(1);
  await expect(weight.locator("rect")).toHaveCount(0);
  await expect(weight.locator("xpath=ancestor::figure")).toContainText("1 day over the goal");
  expect(await dots(chart(pane, "waist"))).toHaveLength(1);
  await expect(tile(pane, "Waist")).toHaveText(["90 cm", "one weigh-in"]);
  await expect(tile(pane, "Weight")).toHaveText(["+2.1 kg", "from 84 to 86.1 kg"]);
  expect((await weeks(pane))[0]).toEqual(["Week", "kcal", "Protein", "Water", "Weight", "Waist", "Days"]);
});

test("#805 A7 A9 A11 with no weigh-in today the row and the Log weight button give the latest with its date, and no change reads 0.0 kg", async ({
  page,
  stack,
}) => {
  const config = CONFIG.replace(WEIGH, `${WEIGH}, max 85`);
  const days = { 15: ["- 💧 250 ml"], 14: ["- ⚖ 82.4 kg"], 9: ["- ⚖ 82.4 kg"] };
  const pane = await trends(page, stack.vault, days, { config, span: "30d" });
  await expect(row(page, "Weight")).toContainText("82.4 kg, Nov 14", { timeout: 15_000 });
  const button = page.getByRole("button", { name: "Log weight" });
  await expect(button).toContainText("82.4 kg, Nov 14");
  await expect(button.getByRole("meter")).toHaveCount(0);
  await expect(tile(pane, "Weight")).toHaveText(["0.0 kg", "from 82.4 to 82.4 kg"]);
});

test("#805 A11 the button never shows the day's own weigh-in from the range read as an earlier one", async ({
  page,
  stack,
}) => {
  // The day's own read answers before today's weigh-in landed, while the range read has it.
  await page.route("**/api/log?*", async (route) => {
    const asked = new URL(route.request().url()).searchParams;
    if (asked.get("from") !== asked.get("to")) return route.fallback();
    const days = await (await route.fetch()).json();
    for (const day of days) for (const mine of day.totals.mine) mine.total = null;
    return route.fulfill({ json: days });
  });
  await trends(page, stack.vault, { 15: ["- ⚖ 82.4 kg"], 14: ["- ⚖ 81 kg"] });
  const button = page.getByRole("button", { name: "Log weight" });
  await expect(button).toContainText("81 kg, Nov 14", { timeout: 15_000 });
  await expect(button).not.toContainText("Nov 15");
});

test("#805 A2 A9 I5 one weigh-in of 82.45 kg reads 82.45 kg in the row and the tile and draws one dot", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, { 15: ["- ⚖ 82.45 kg"] }, { span: "30d" });
  await expect(row(page, "Weight")).toContainText("82.45 kg", { timeout: 15_000 });
  await expect(tile(pane, "Weight")).toHaveText(["82.45 kg", "one weigh-in"]);
  const line = pane.getByRole("img", { name: "weight over 30 days, one weigh-in" });
  const [dot, ...more] = await dots(line);
  expect(more).toEqual([]);
  expect(Number.isFinite(dot?.cy)).toBe(true);
  await expect(page.getByRole("region", { name: "Log" })).not.toContainText(/NaN|Infinity/);
});

test("#805 A7 A9 I5 a weight kind with no weigh-in in range is a row, a dash tile and a line of no dots", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, { 15: ["- 💧 250 ml"] }, { span: "30d" });
  await expect(row(page, "Weight")).toContainText("no weigh-ins yet", { timeout: 15_000 });
  await expect(row(page, "Weight").getByRole("meter")).toHaveCount(0);
  await expect(today(page).locator("[data-slot='weight']")).toHaveCount(0);
  await expect(tile(pane, "Weight")).toHaveText(["—", "no weigh-ins"]);
  const line = pane.getByRole("img", { name: "weight over 30 days, no weigh-ins" });
  await expect(line.locator("circle")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Log" })).not.toContainText(/NaN|Infinity/);
});
