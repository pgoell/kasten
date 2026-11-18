import type { Locator } from "@playwright/test";
import { barsOf, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { chart, fed, CONFIG as LOG, tile, trends, weeks } from "./log.ts";

/** The date `n` days before SUNDAY. */
const ago = (n: number) => new Date(2026, 10, 15 - n, 12).toLocaleDateString("sv");
const SKIPPED = [5, 15, 20];
const OVER = [3, 9, 12, 17, 23, 28];
const LOGGED = [...Array(30).keys()].filter((n) => !SKIPPED.includes(n));
/** 27 of 30 days: kcal 2,500 on OVER and 1,500 else, water short daily, protein short once, coffee over once. */
const THIRTY = Object.fromEntries(
  LOGGED.map((n) => [
    ago(n),
    [
      `- 🍽 🔥 ${OVER.includes(n) ? 2500 : 1500} kcal 🥩 ${n === 4 ? 40 : 120} g 🍞 200 g 🧈 60 g`,
      "- 💧 1000 ml",
      `- ☕ ${n === 9 ? 4 : 2}`,
    ],
  ]),
);

/** Each bar of a chart of `n` slots: its day back, and whether it draws in the warning colour or faded. */
const marks = (chart: Locator, n: number) =>
  chart.evaluate((svg: SVGSVGElement, n) => {
    const probe = document.createElement("i");
    probe.style.color = "var(--k-warn)";
    document.body.append(probe);
    const warn = getComputedStyle(probe).color;
    probe.remove();
    const slot = svg.viewBox.baseVal.width / n;
    return [...svg.querySelectorAll("rect")]
      .map((bar) => ({ bar, style: getComputedStyle(bar) }))
      .map(({ bar, style }) => ({
        ago: n - 1 - Math.floor(bar.getBBox().x / slot),
        warn: style.fill === warn,
        faded: Number(style.opacity) < 1,
      }))
      .sort((a, b) => a.ago - b.ago);
  }, n);
const agos = async (chart: Locator, n: number, is: "warn" | "faded") =>
  (await marks(chart, n)).filter((bar) => bar[is]).map((bar) => bar.ago);

/** The dashed lines a chart draws, each as the value it stands at, read against a bar of `tall`. */
const goals = (chart: Locator, tall: number) =>
  chart.evaluate((svg: SVGSVGElement, tall) => {
    const top = Math.max(...[...svg.querySelectorAll("rect")].map((bar) => bar.getBBox().height));
    const base = svg.viewBox.baseVal.height;
    return [...svg.querySelectorAll("line")]
      .filter((line) => getComputedStyle(line).strokeDasharray !== "none")
      .map((line) => Math.round(((base - line.y1.baseVal.value) / top) * tall));
  }, tall);

const span = (pane: Locator, name: string) =>
  expect(pane.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
const charts = (pane: Locator) => pane.locator(".log-multiples > .log-chart");

test.describe("thirty days, 27 logged", () => {
  test("#804 A7 7, 3 and 9 on the pane draw 7, 30 and 90 day slots, eight charts each", async ({
    page,
    stack,
  }) => {
    const pane = await trends(page, stack.vault, THIRTY, { config: LOG, span: "30d" });
    const month = LOGGED.map((n) => ({ ago: n, stub: false }));
    const water = (days: number) => pane.getByRole("img", { name: `water over ${days} days` });
    await expect.poll(() => barsOf(water(30), 30), { timeout: 15_000 }).toEqual(month);
    await expect(charts(pane)).toHaveCount(8);
    await page.getByRole("region", { name: "Log" }).focus();

    await page.keyboard.press("7");
    await expect.poll(() => barsOf(water(7), 7)).toEqual(fed(0, 1, 2, 3, 4, 6));
    await span(pane, "7d");
    await expect(charts(pane)).toHaveCount(8);

    await page.keyboard.press("3");
    await expect.poll(() => barsOf(water(30), 30)).toEqual(month);
    await span(pane, "30d");

    await page.keyboard.press("9");
    await expect.poll(() => barsOf(water(90), 90)).toEqual(month);
    await span(pane, "90d");
    await expect(charts(pane)).toHaveCount(8);
  });

  for (const width of ["desktop", "phone"]) {
    test.describe(width, () => {
      if (width === "phone") test.use(phone);
      test(`#804 A8 A10 I5 ${width}: the summary comes first with the average, N of M, streak and an empty weight, and words name days over`, async ({
        page,
        stack,
      }) => {
        const narrow = width === "phone";
        const pane = await trends(page, stack.vault, THIRTY, { config: LOG, span: "30d", narrow });
        await expect(tile(pane, "Within goal")).toHaveText(
          ["21 of 27", "days at most 2,000 kcal"],
          {
            timeout: 15_000,
          },
        );
        await expect(tile(pane, "Average")).toHaveText(["1,722 kcal", "over 27 food days"]);
        await expect(tile(pane, "Streak")).toHaveText(["3 days", "in a row within the kcal goal"]);
        await expect(tile(pane, "Weight")).toHaveText(["—", "no weigh-ins yet"]);
        const top = (css: string) =>
          pane.locator(css).evaluate((at) => at.getBoundingClientRect().top);
        expect(await top(".log-summary")).toBeLessThan(await top(".log-multiples"));
        for (const words of [
          "kcal: average 1,722.2 kcal over 27 food days, goal at most 2,000 kcal, 6 days over the goal",
          "coffee: average 2.1 over 27 logged days, goal at most 3, 1 day over the goal",
        ]) {
          await expect(pane.getByText(words, { exact: true })).toBeVisible();
        }
        const weight = pane.locator("figure", { hasText: "No weigh-ins yet" });
        await expect(weight).toHaveText("WeightNo weigh-ins yet");
        await expect(weight.locator("svg")).toHaveCount(0);
        await expect(pane.locator("circle, polyline")).toHaveCount(0);
      });
    });
  }

  test("#804 A9 #806 A2 eight charts of one size, dashed goals, the warning on a ceiling passed, and past bars faded but a warning", async ({
    page,
    stack,
  }) => {
    const pane = await trends(page, stack.vault, THIRTY, { config: LOG, span: "30d" });
    const kcal = pane.getByRole("img", { name: "kcal over 30 days, 6 days over the goal" });
    await expect.poll(() => agos(kcal, 30, "warn"), { timeout: 15_000 }).toEqual(OVER);
    await expect(
      pane.getByRole("img", { name: "coffee over 30 days, 1 day over the goal" }),
    ).toBeVisible();
    expect(await agos(chart(pane, "coffee"), 30, "warn")).toEqual([9]);
    for (const name of ["water", "protein"])
      expect(await agos(chart(pane, name), 30, "warn")).toEqual([]);
    const sizes = await charts(pane).evaluateAll((all) =>
      all
        .map((at) => at.querySelector("svg")?.getBoundingClientRect())
        .map((box) => `${box?.width}x${box?.height}`),
    );
    expect(sizes).toHaveLength(8);
    expect(new Set(sizes).size).toBe(1);
    await expect.poll(() => goals(kcal, 2500)).toEqual([2000]);
    for (const name of ["water", "coffee", "juice", "protein"])
      expect(await goals(chart(pane, name), 1), name).toHaveLength(1);
    const alcohol = chart(pane, "alcohol");
    expect(await goals(alcohol, 1)).toEqual([]);
    expect(await marks(alcohol, 30)).toHaveLength(27);

    expect(await agos(chart(pane, "water"), 30, "faded")).toEqual(LOGGED.slice(1));
    expect(await agos(kcal, 30, "faded")).toEqual(LOGGED.slice(1).filter((n) => !OVER.includes(n)));
  });

  test("#806 A2 h moves the range to end yesterday, and no bar is faded", async ({
    page,
    stack,
  }) => {
    const pane = await trends(page, stack.vault, THIRTY, { config: LOG, span: "30d" });
    const water = chart(pane, "water");
    await expect.poll(() => marks(water, 30), { timeout: 15_000 }).toHaveLength(27);
    await page.getByRole("region", { name: "Log" }).focus();
    await page.keyboard.press("h");
    await expect
      .poll(() => barsOf(water, 30))
      .toEqual(LOGGED.slice(1).map((n) => ({ ago: n - 1, stub: false })));
    expect(await agos(water, 30, "faded")).toEqual([]);
  });

  test("#804 I4 with no kcal goal the Within goal tile says so and kcal draws no dashed line", async ({
    page,
    stack,
  }) => {
    const config = "- 💧 water: 250 ml, min 2000\n- 🍽 food: protein min 100\n";
    const pane = await trends(page, stack.vault, THIRTY, { config, span: "30d" });
    await expect(tile(pane, "Within goal")).toHaveText(["—", "no kcal goal"], { timeout: 15_000 });
    expect(await goals(chart(pane, "water"), 1)).toHaveLength(1);
    expect(await goals(chart(pane, "protein"), 1)).toHaveLength(1);
    expect(await goals(chart(pane, "kcal"), 1)).toEqual([]);
    expect(await marks(chart(pane, "kcal"), 30)).toHaveLength(27);
  });
});

test("#804 A8 today with no log yet does not end the streak, an earlier day with no log does", async ({
  page,
  stack,
}) => {
  const days = Object.fromEntries([1, 2, 3, 5, 6].map((n) => [ago(n), ["- 🍽 🔥 1800 kcal"]]));
  const pane = await trends(page, stack.vault, days, { config: LOG });
  await expect
    .poll(() => barsOf(chart(pane, "kcal"), 7), { timeout: 15_000 })
    .toEqual(fed(1, 2, 3, 5, 6));
  await expect(tile(pane, "Streak")).toHaveText(["3 days", "in a row within the kcal goal"]);
});

test("#804 A9 a logged day with no coffee draws a stub, a day with no log draws none", async ({
  page,
  stack,
}) => {
  const pane = await trends(
    page,
    stack.vault,
    { [ago(0)]: ["- 💧 250 ml"], [ago(2)]: ["- ☕ 2"] },
    { config: LOG },
  );
  await expect
    .poll(() => barsOf(chart(pane, "coffee"), 7), { timeout: 15_000 })
    .toEqual([{ ago: 0, stub: true }, ...fed(2)]);
});

test("#804 A11 the macro split is one stacked bar of three, with shares of kcal adding to 100", async ({
  page,
  stack,
}) => {
  const day = ["- 🍽 🔥 1820 kcal 🥩 120 g 🍞 200 g 🧈 60 g"];
  const pane = await trends(
    page,
    stack.vault,
    Object.fromEntries([...Array(7).keys()].map((n) => [ago(n), day])),
    {
      config: LOG,
    },
  );
  await expect(pane.locator(".log-macro-labels li")).toHaveText(
    ["Protein 26%", "Carbs 44%", "Fat 30%"],
    {
      timeout: 15_000,
    },
  );
  await expect(
    pane.getByRole("img", { name: "macro split over 7 days" }).locator("rect"),
  ).toHaveCount(3);
});

test("#804 A12 the By week table has a row per week the range touches, the oldest cut to its days in range", async ({
  page,
  stack,
}) => {
  const pane = await trends(
    page,
    stack.vault,
    {
      [ago(29)]: ["- 🍽 🔥 1000 kcal 🥩 50 g", "- 💧 500 ml"],
      [ago(28)]: ["- 🍽 🔥 2000 kcal 🥩 100 g", "- 💧 1500 ml"],
      [ago(5)]: ["- 🍽 🔥 1500 kcal 🥩 80 g", "- 💧 1000 ml"],
    },
    { config: LOG, span: "30d" },
  );
  await expect.poll(() => barsOf(chart(pane, "kcal"), 30), { timeout: 15_000 }).toHaveLength(3);
  const none = (week: string) => [week, "—", "—", "—", "—", "0 of 7"];
  expect(await weeks(pane)).toEqual([
    ["Week", "kcal", "Protein", "Water", "Weight", "Days"],
    ["Nov 9", "1,500", "80", "1,000", "—", "1 of 7"],
    none("Nov 2"),
    none("Oct 26"),
    none("Oct 19"),
    ["Oct 12", "1,500", "75", "1,000", "—", "2 of 2"],
  ]);
});

test("#804 I3 a range with nothing logged says nothing logged, draws no bar and shows no NaN", async ({
  page,
  stack,
}) => {
  const pane = await trends(page, stack.vault, {}, { config: LOG, span: "30d" });
  await expect(pane.locator(".log-summary dd")).toHaveText(
    ["—", "nothing logged", "—", "nothing logged", "—", "nothing logged", "—", "no weigh-ins yet"],
    { timeout: 15_000 },
  );
  await expect(pane.getByText("macros: nothing logged")).toBeVisible();
  await expect(pane.getByText("nothing logged", { exact: true }).last()).toBeVisible();
  await expect(pane.locator("rect")).toHaveCount(0);
  await expect(pane).not.toContainText(/NaN|Infinity/);
});
