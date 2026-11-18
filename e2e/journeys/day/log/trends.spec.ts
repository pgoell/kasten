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
