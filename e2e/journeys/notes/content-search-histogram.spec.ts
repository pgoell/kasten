import type { Locator, Page } from "@playwright/test";
import { phone } from "../../harness/app.ts";
import { answer, bar, bars, type Hit, hit, openSearch } from "../../harness/search.ts";
import { expect, test } from "../../harness/stack.ts";

// The bars read dates against the browser's now, so each case fixes it: Friday
// 23 October 2026, in week 43, so the bars run from week 30 to week 43. Fixed and not
// installed, so the search's debounce and the rows' entrance timer still run.
const NOW = new Date(2026, 9, 23, 12);

/** A note's lines, `count` of them, each dated `date`. */
const lines = (path: string, count: number, date: string): Hit[] =>
  Array.from({ length: count }, (_, at) => hit(path, at + 1, `postgres line ${at + 1}`, date));

const rows = (page: Page) => page.getByRole("option");
/** The coloured block inside a bar, whose height is the count. */
const fill = (week: Locator) => week.locator('[aria-hidden="true"]');
const colour = (at: Locator) => at.evaluate((el) => getComputedStyle(el).backgroundColor);
const height = (at: Locator) => at.evaluate((el) => el.style.height);
const names = (page: Page) =>
  bars(page).evaluateAll((all) => all.map((at) => at.getAttribute("aria-label")));
const weeks = (count = (_: number) => 0) =>
  Array.from({ length: 14 }, (_, at) => {
    const lines = count(30 + at);
    return `Week ${30 + at}, ${lines} ${lines === 1 ? "line" : "lines"}`;
  });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test("the bars run from week 30 to week 43, scale from the busiest, mark this week in the accent, and show a count under the mouse", async ({
  page,
}) => {
  await answer(page, () => [
    ...lines("a/one.md", 30, "2026-09-16"),
    ...lines("b/two.md", 15, "2026-10-07"),
    ...lines("c/three.md", 1, "2026-10-21"),
  ]);
  await openSearch(page);
  await expect.poll(() => names(page)).toEqual(weeks());
  await expect(bar(page, 30)).toContainText("W30");
  const current = bar(page, 43).locator(".font-bold");
  await expect(current).toHaveText("W43");
  await expect(current).toHaveClass(/text-k-accent/);
  await expect(bar(page, 42).locator(".font-bold")).toHaveCount(0);
  const resting = await colour(fill(bar(page, 40)));
  await page.keyboard.type("postgres");
  // One poll: the names and the heights land on the same render.
  await expect
    .poll(async () => [
      await bar(page, 38).getAttribute("aria-label"),
      await height(fill(bar(page, 38))),
      await height(fill(bar(page, 41))),
      await bar(page, 43).getAttribute("aria-label"),
      await bar(page, 30).getAttribute("aria-label"),
      await height(fill(bar(page, 30))),
    ])
    .toEqual(["Week 38, 30 lines", "100%", "50%", "Week 43, 1 line", "Week 30, 0 lines", "0%"]);
  // An empty week is a 2 px stub in the resting colour.
  expect((await fill(bar(page, 30)).boundingBox())?.height).toBe(2);
  expect(await colour(fill(bar(page, 30)))).toBe(resting);
  const accent = await colour(fill(bar(page, 43)));
  expect(accent).not.toBe(resting);
  await expect(bar(page, 38).getByText("30", { exact: true })).toHaveCount(0);
  await bar(page, 38).hover();
  await expect
    .poll(async () => [
      await bar(page, 38).getByText("30", { exact: true }).count(),
      (await colour(fill(bar(page, 38)))) !== resting,
    ])
    .toEqual([1, true]);
  // The current week keeps the accent under the mouse.
  await bar(page, 43).hover();
  await expect(bar(page, 43).getByText("1", { exact: true })).toHaveCount(1);
  expect(await colour(fill(bar(page, 43)))).toBe(accent);
});

test("a bar narrows the lines to its week, says what it holds, dims the rest, keeps through a new query, and clears", async ({
  page,
}) => {
  const asked: string[] = [];
  await answer(page, (route) => {
    asked.push(new URL(route.request().url()).searchParams.get("q") ?? "");
    return [
      ...lines("reference/a.md", 8, "2026-09-16"),
      ...lines("reference/b.md", 8, "2026-09-16"),
      ...lines("projects/c.md", 7, "2026-09-17"),
      ...lines("projects/d.md", 7, "2026-09-18"),
      hit("projects/kasten.md", 12, "postgres line this week", "2026-10-20"),
      hit("reference/deploy.md", 88, "postgres line in week 40", "2026-10-01"),
    ];
  });
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(32);
  const resting = await colour(fill(bar(page, 40)));
  const accent = await colour(fill(bar(page, 43)));
  await bar(page, 38).click();
  await expect(
    page.getByText("30 lines in 4 notes written 14 to 20 September 2026."),
  ).toBeVisible();
  // One poll: the press, the rows and the colours land on the same render.
  await expect
    .poll(async () => [
      await bar(page, 38).getAttribute("aria-pressed"),
      await bar(page, 43).getAttribute("aria-pressed"),
      await rows(page).count(),
      (await colour(fill(bar(page, 38)))) === accent,
      (await colour(fill(bar(page, 40)))) !== resting,
      // The current week gives up the accent while another is chosen.
      (await colour(fill(bar(page, 43)))) === (await colour(fill(bar(page, 40)))),
    ])
    .toEqual(["true", "false", 30, true, true, true]);
  const dimmed = await colour(fill(bar(page, 40)));
  await bar(page, 40).hover();
  await expect.poll(() => colour(fill(bar(page, 40)))).not.toBe(dimmed);

  await page.getByRole("combobox", { name: "search notes" }).focus();
  await page.keyboard.type(" line");
  await expect.poll(() => asked.at(-1)).toBe("postgres line");
  await expect(bar(page, 38)).toHaveAttribute("aria-pressed", "true");

  await bar(page, 38).click();
  await expect(bar(page, 38)).toHaveAttribute("aria-pressed", "false");
  await expect(rows(page)).toHaveCount(32);
  await bar(page, 38).click();
  await page.getByRole("button", { name: "All weeks" }).click();
  await expect(bar(page, 38)).toHaveAttribute("aria-pressed", "false");
  await expect(rows(page)).toHaveCount(32);

  await bar(page, 30).click();
  await expect(page.getByText("0 lines in 0 notes written 20 to 26 July 2026.")).toBeVisible();
  await page.getByRole("button", { name: "All weeks" }).click();
  await expect(page.getByRole("button", { name: "All weeks" })).toHaveCount(0);
});

test("a line with no date or from before week 30 lists in no bar, an archived line counts in its week, and a cleared query empties it all", async ({
  page,
}) => {
  await answer(page, (route) => {
    const hits: Hit[] = [
      hit("projects/kasten.md", 12, "Postgres holds a derived index.", "2026-10-20", ["#db"]),
      hit("reference/deploy.md", 88, "postgres runs", "2026-09-16", ["#reading"]),
      { ...hit("undated.md", 1, "postgres undated"), date: null },
      hit("old/june.md", 4, "postgres in june", "2026-06-01"),
    ];
    const archive = new URL(route.request().url()).searchParams.get("archive") === "true";
    return archive ? [...hits, hit("98 Archive/old.md", 3, "postgres old", "2026-10-01")] : hits;
  });
  await openSearch(page);
  await page.keyboard.type("postgres");
  await expect(rows(page)).toHaveCount(4);
  await expect(page.getByRole("group", { name: "undated.md" })).toBeVisible();
  await expect(page.getByRole("group", { name: "old/june.md" })).toBeVisible();
  await expect
    .poll(() => names(page))
    .toEqual(weeks((week) => (week === 38 || week === 43 ? 1 : 0)));

  await page.getByRole("button", { name: /^Include the archive/ }).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(bar(page, 40)).toHaveAccessibleName("Week 40, 1 line");

  await page.getByRole("button", { name: /^Include the archive/ }).click();
  await expect(page.getByRole("button", { name: /^projects/ })).toBeVisible();
  await page.getByRole("combobox", { name: "search notes" }).fill("");
  await expect
    .poll(async () => [await rows(page).count(), await names(page)])
    .toEqual([0, weeks()]);
  await expect(page.getByRole("button", { name: /^projects/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Include the archive/ })).toHaveText(
    "Include the archive",
  );
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a bar's colour fills its whole width under a finger, and a tap shows no count", async ({
    page,
  }) => {
    await answer(page, () => lines("a/one.md", 3, "2026-10-21"));
    // A phone has no leader key, so the page opens on a cold load of a week.
    await page.goto("/?week=2020-W01");
    await page.getByRole("button", { name: "All weeks" }).tap();
    await page.getByRole("combobox", { name: "search notes" }).fill("postgres");
    const week = bars(page).last();
    await expect(week).toHaveAccessibleName(/, 3 lines$/);
    const area = await week.boundingBox();
    const block = await fill(week).boundingBox();
    // The block stands in from the bar by its 2 px margins, no more.
    expect(block?.width).toBeGreaterThanOrEqual((area?.width ?? 0) - 5);
    await week.tap();
    await expect(week).toHaveAttribute("aria-pressed", "true");
    await expect(week.getByText("3", { exact: true })).toHaveCount(0);
  });
});
