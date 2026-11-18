import type { Page } from "@playwright/test";
import { barsOf, bodyOf, noteText, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

// W46 of 2026, Monday the 9th to Sunday the 15th of November, clear of a clock change.
const WEEK = "01 Periodic/01 Weekly/2026-W46.md";
const PAST = "01 Periodic/01 Weekly/2026-W45.md";
const NEXT = "01 Periodic/01 Weekly/2026-W47.md";
const CONFIG = "99 Misc/01 Config/log.md";
const FDE = "02 Projects/FDE/tasks.md";
const INBOX = "00 Inbox/tasks.md";
const at = (day: number, hour = 9, minute = 0) => new Date(2026, 10, day, hour, minute);
const daily = (day: number) => `01 Periodic/00 Daily/2026-11-${String(day).padStart(2, "0")}.md`;
const log = (...lines: string[]) => `# Day\n\n## Log\n${lines.join("\n")}\n`;

/** The week of #807: five logged days, one over the kcal ceiling, weigh-ins, a time session, two todos done, one carried over and a card rated on the 12th. */
const FULL = {
  [CONFIG]: "- 🍽 food: kcal max 2200\n- 💧 water: 250 ml\n- ⚖ weight: kg, last\n",
  [daily(5)]: log("- ⚖ 80.8 kg"),
  [daily(9)]: log("- 🍽 🔥 2100 kcal", "- ⚖ 80.6 kg"),
  [daily(10)]: `${log("- 🍽 🔥 2300 kcal")}\n## Time\n- 09:00-10:30 wire\n`,
  [daily(11)]: log("- 🍽 🔥 1800 kcal"),
  [daily(13)]: log("- 🍽 🔥 2000 kcal"),
  [daily(15)]: log("- 🍽 🔥 2150 kcal", "- ⚖ 80.2 kg"),
  [FDE]: "# tasks\n\n- [x] ship the export ✅ 2026-11-10\n- [ ] next thing\n",
  [INBOX]:
    "# inbox\n\n- [x] reply to Anna ✅ 2026-11-12 ⏱ 10m\n- [ ] send the deck 📅 2026-11-12\n",
  "00 Inbox/cards.md": "#flashcards/aws\nQ :: A <!--SR:!2026-11-13,1,270-->\n",
};

/** Writes `notes` and the three weekly notes, pins the clock at `now`, and opens `path` once its review has read everything. */
async function openWeek(
  page: Page,
  vault: string,
  notes: Record<string, string>,
  now = at(15),
  path = WEEK,
) {
  await vaultWith(vault, {
    ...notes,
    [WEEK]: "# 2026-W46\n\nmy own line\n",
    [PAST]: "# 2026-W45\n",
    [NEXT]: "# 2026-W47\n",
  });
  await page.clock.install({ time: now });
  await page.goto(`/?note=${encodeURIComponent(path)}`);
  const review = page.locator(".cm-review");
  await expect(review).toContainText("in review", { timeout: 15_000 });
  await expect(review).not.toContainText("Reading…");
  return review;
}

const tiles = (page: Page) =>
  page
    .locator(".review-tile")
    .evaluateAll((all) =>
      all.map((tile) => [...tile.querySelectorAll("p")].map((p) => p.textContent)),
    );
const section = (page: Page, heading: string) =>
  page
    .locator(".review-section")
    .filter({ has: page.locator(".review-heading", { hasText: new RegExp(`^${heading}$`) }) });
const rows = (page: Page, heading: string) => section(page, heading).locator(".review-row");
const chart = (page: Page, label: string) =>
  page.getByRole("img", { name: new RegExp(`^${label}`) });
/** The bars of a chart, each as its day of the week from Monday (0) and whether it is a logged zero's stub. */
const days = async (page: Page, label: string) =>
  (await barsOf(chart(page, label), 7))
    .map(({ ago, stub }) => ({ day: 6 - ago, stub }))
    .sort((a, b) => a.day - b.day);
const stubs = (...list: [number, boolean][]) => list.map(([day, stub]) => ({ day, stub }));

test("#807 A5 the tiles, the charts' words and the Done and Carried over rows say what the week holds", async ({
  page,
  stack,
}) => {
  await openWeek(page, stack.vault, FULL);
  expect(await tiles(page)).toEqual([
    ["Todos done", "2", "ticked done this week"],
    ["Time logged", "1h 30m", "in the day notes' sessions"],
    ["Days within kcal", "4 of 7", "days within the goal"],
    ["Weight change", "-0.6 kg", "over the week"],
  ]);
  await expect(chart(page, "kcal per day")).toHaveAttribute(
    "aria-label",
    "kcal per day this week, goal at most 2,200 kcal",
  );
  await expect(section(page, "kcal per day")).toContainText(
    "kcal per day, the dashed line the goal",
  );
  await expect(chart(page, "todos done")).toHaveAttribute(
    "aria-label",
    "todos done per day this week, 2 in all",
  );
  await expect(section(page, "Flashcards")).toContainText(
    "1 card rated this week, last rating only",
  );
  await expect(rows(page, "Done")).toHaveText(["ship the export", "reply to Anna"]);
  await expect(rows(page, "Carried over")).toHaveText(["send the deck"]);
});

test("#807 A7 the week's GitHub count is in words, and the stack's backend with no token says GitHub is off", async ({
  page,
  stack,
}) => {
  const review = await openWeek(page, stack.vault, FULL);
  await expect(review).toContainText("GitHub is off: the backend has no token.");
  await page.route(/\/api\/github\?/, (route) =>
    route.fulfill({ json: { on: true, days: { "2026-11-10": 4, "2026-11-12": 19 } } }),
  );
  await page.reload();
  await expect(review).toContainText("GitHub: 23 contributions this week", { timeout: 15_000 });
});

test("#807 I1 a week with nothing in it says so in words, with no NaN or Infinity, and a past one speaks of no today", async ({
  page,
  stack,
}) => {
  const review = await openWeek(page, stack.vault, { [CONFIG]: FULL[CONFIG] });
  await expect(section(page, "Done")).toContainText("No todo ticked done this week.");
  await expect(rows(page, "Done")).toHaveCount(0);
  await expect(section(page, "Carried over")).toContainText("Nothing carried over into today.");
  expect((await tiles(page))[2]).toEqual(["Days within kcal", "0 of 7", "days within the goal"]);
  await expect(review).not.toContainText(/NaN|Infinity/);

  await page.goto(`/?note=${encodeURIComponent(PAST)}`);
  await expect(section(page, "Carried over")).toContainText(
    "Nothing carried over from this week.",
    { timeout: 15_000 },
  );
  await expect(section(page, "Carried over")).not.toContainText("today");
});

test("#807 I2 a failed todos read shows its message where the lists are and the kcal chart still draws", async ({
  page,
  stack,
}) => {
  await page.route(
    (url) => url.pathname === "/api/todos",
    (route) => route.fulfill({ status: 500 }),
  );
  await openWeek(page, stack.vault, FULL);
  await expect(section(page, "Done")).toContainText("GET /api/todos failed with 500");
  await expect(chart(page, "kcal per day")).toHaveAttribute(
    "aria-label",
    "kcal per day this week, goal at most 2,200 kcal",
  );
});

test("#807 I2 a failed log config read shows its message in the tiles, not as no kcal goal", async ({
  page,
  stack,
}) => {
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${CONFIG}`,
    (route) => route.fulfill({ status: 500 }),
  );
  const review = await openWeek(page, stack.vault, FULL);
  expect((await tiles(page))[2]?.[2]).toMatch(/^GET \/api\/files\/.+ failed with 500$/);
  await expect(review).not.toContainText("no kcal goal");
});

test("#807 I3 a week that has not started says so, and draws nothing else", async ({
  page,
  stack,
}) => {
  const review = await openWeek(page, stack.vault, FULL, at(15), NEXT);
  await expect(review).toContainText("This week has not started.");
  await expect(page.locator(".review-tiles")).toHaveCount(0);
});

/** Tasks as it reads once the `!` typed at the end of the cursor's line lands on the export's embed. */
async function marked(url: string): Promise<string> {
  const rows = (await (
    await fetch(`${url}/api/todos/rows?note=${encodeURIComponent(FDE)}`)
  ).json()) as {
    id: string;
    words: string;
  }[];
  const id = (words: string) => rows.find((row) => row.words === words)?.id;
  return `# tasks\n\n![[${id("ship the export")}]]!\n![[${id("next thing")}]]\n`;
}

for (const vim of ["on", "off"]) {
  test(`#807 I7 with vim ${vim}, a click on a Done row opens its note at the todo's line`, async ({
    page,
    stack,
  }) => {
    await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
    await openWeek(page, stack.vault, FULL);
    await rows(page, "Done").filter({ hasText: "ship the export" }).click();
    await expect(page.getByRole("tab", { name: "tasks", selected: true })).toBeVisible();
    if (vim === "on") await page.keyboard.type("A!");
    else {
      await page.keyboard.press("End");
      await page.keyboard.type("!");
    }
    await page.clock.runFor(10_000);
    await expect
      .poll(async () => bodyOf(await noteText(stack.vault, FDE)))
      .toBe(await marked(stack.url));
  });
}

test.describe("on a phone", () => {
  test.use(phone);

  test("#807 I7 a tap on a Done row opens its note at the todo's line", async ({ page, stack }) => {
    await openWeek(page, stack.vault, FULL);
    await rows(page, "Done").filter({ hasText: "ship the export" }).tap();
    await expect(page.locator(".cm-content")).toContainText("next thing");
    // A tap leaves the keyboard shut; focus brings back the selection the row set.
    await page.locator(".cm-content").focus();
    await page.keyboard.press("End");
    await page.keyboard.type("!");
    await page.clock.runFor(10_000);
    await expect
      .poll(async () => bodyOf(await noteText(stack.vault, FDE)))
      .toBe(await marked(stack.url));
  });
});

test("#1015 A2 A3 on a Wednesday no bar stands for Thursday to Sunday, and the days up to today with nothing done draw the stub", async ({
  page,
  stack,
}) => {
  await openWeek(page, stack.vault, FULL, at(11));
  await expect
    .poll(() => days(page, "todos done"))
    .toEqual(stubs([0, true], [1, false], [2, true]));
  expect(await days(page, "cards rated")).toEqual(stubs([0, true], [1, true], [2, true]));
});

test("#1015 A4 I2 a past week and the current week on its Sunday draw a bar for each of the seven days", async ({
  page,
  stack,
}) => {
  await openWeek(page, stack.vault, FULL);
  const seven = [0, 1, 2, 3, 4, 5, 6];
  for (const label of ["todos done", "cards rated"]) {
    await expect.poll(async () => (await days(page, label)).map(({ day }) => day)).toEqual(seven);
  }
  await page.goto(`/?note=${encodeURIComponent(PAST)}`);
  for (const label of ["todos done", "cards rated"]) {
    await expect.poll(async () => (await days(page, label)).length, { timeout: 15_000 }).toBe(7);
  }
});

test("#1015 I3 at 23:30 on Wednesday Thursday has no bar, and at 00:30 on Thursday it has", async ({
  page,
  stack,
}) => {
  await openWeek(page, stack.vault, FULL, at(11, 23, 30));
  await expect.poll(async () => (await days(page, "todos done")).length).toBe(3);
  await page.clock.setSystemTime(at(12, 0, 30));
  await page.reload();
  await expect
    .poll(async () => (await days(page, "todos done")).map(({ day }) => day), { timeout: 15_000 })
    .toEqual([0, 1, 2, 3]);
});

test("#1015 B1 with the review open past midnight a todo done on the new day draws its bar", async ({
  page,
  stack,
}) => {
  const { [INBOX]: _inbox, ...early } = FULL;
  await openWeek(page, stack.vault, early, at(11, 23, 50));
  await expect.poll(async () => (await days(page, "todos done")).length).toBe(3);
  await page.clock.setSystemTime(at(12, 0, 10));
  await vaultWith(stack.vault, { [INBOX]: "# inbox\n\n- [x] reply to Anna ✅ 2026-11-12\n" });
  await expect
    .poll(() => days(page, "todos done"), { timeout: 15_000 })
    .toEqual(stubs([0, true], [1, false], [2, true], [3, false]));
});
