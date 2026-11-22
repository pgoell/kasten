import type { Page } from "@playwright/test";
import { holdStream, leader, phone, runCommand } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { card, figure, overview, serve, words } from "./overview.ts";

const NAMES = ["Food", "Today", "Weight", "Water", "Flashcards", "Todos", "Writing", "This year"];
const region = (page: Page) => page.getByRole("region", { name: "Overview" });

for (const width of ["desktop", "phone"]) {
  test.describe(width, () => {
    const touch = width === "phone";
    if (touch) test.use(phone);

    test("#806 A3 the overview shows the cards in order, each with a heading, a figure, words and a chart a screen reader can name", async ({
      page,
    }) => {
      await overview(page, { pin: true, touch });
      const cards = () =>
        region(page).evaluate((pane) =>
          [...pane.querySelectorAll("article")].map((article) => ({
            name: article.querySelector("h2")?.textContent,
            figure: Boolean(article.querySelector(".overview-figure")?.textContent),
            words: Boolean(article.querySelector(".overview-words")?.textContent),
            chart: Boolean(article.querySelector("[role='img']")?.getAttribute("aria-label")),
          })),
        );
      const whole = { figure: true, words: true, chart: true };
      await expect.poll(cards).toEqual([...NAMES, "Training"].map((name) => ({ name, ...whole })));
    });

    test("#806 A4 each card opens its pane: Food, Today, Weight and Water the log, Flashcards the review pane, Todos the todo pane", async ({
      page,
    }) => {
      const panes: [string, string][] = [
        ["Food, open the log", "Log"],
        ["Today, open the log", "Log"],
        ["Weight, open the log", "Log"],
        ["Water, open the log", "Log"],
        ["Flashcards, open the review pane", "review"],
        ["Todos, open the todo pane", "Todos"],
      ];
      await overview(page, { pin: true, touch });
      for (const [name, pane] of panes) {
        const button = page.getByRole("button", { name });
        await (touch ? button.tap() : button.click());
        await expect(page.locator(`[aria-label='${pane}']:visible`), name).toBeVisible();
        await expect(region(page)).toBeHidden();
        if (touch) await runCommand(page, /^Open the overview/);
        else await leader(page, "ga");
        await expect(card(page, "Food")).toBeVisible({ timeout: 15_000 });
      }
    });

    test("#806 A4 Writing opens today's note, This year opens this year's", async ({ page }) => {
      await overview(page, { pin: true, touch });
      const writing = page.getByRole("button", { name: "Writing, open today's note" });
      await (touch ? writing.tap() : writing.click());
      await expect(page.getByRole("tab", { name: "2026-10-20", selected: true })).toBeVisible();
      // Today's note took the overview's pane, so the overview comes back for the next card.
      if (touch) await runCommand(page, /^Open the overview/);
      else await leader(page, "ga");
      const year = page.getByRole("button", { name: "This year, open this year's note" });
      await (touch ? year.tap() : year.click());
      await expect(
        page.getByRole("tab", { name: "2026", exact: true, selected: true }),
      ).toBeVisible();
    });
  });
}

test("#806 A5 the overview reads log, todos, cards and written once each and writes nothing", async ({
  page,
}) => {
  const asked: string[] = [];
  const wrote: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && url.pathname.startsWith("/api/")) wrote.push(url.pathname);
    if (["/api/log", "/api/todos", "/api/cards", "/api/written"].includes(url.pathname)) {
      asked.push(url.pathname + (url.pathname === "/api/log" ? url.search : ""));
    }
  });
  // The event stream's open rereads todos (#2118), which is no read of the overview's.
  await holdStream(page);
  const answered = ["/api/log", "/api/todos", "/api/cards", "/api/written"].map((path) =>
    page.waitForResponse((response) => new URL(response.url()).pathname === path),
  );
  await overview(page, { pin: true });
  await Promise.all(answered);
  await expect(words(page, "Writing")).toHaveText(/today$/);
  expect(asked.sort()).toEqual([
    "/api/cards",
    "/api/log?from=2026-07-23&to=2026-10-20",
    "/api/todos",
    "/api/written",
  ]);
  expect(wrote).toEqual([]);
});

test("#806 I1 with nothing logged, no goals, no weight kind, no cards rated, no todos and no notes, every card says so and no NaN or Infinity shows", async ({
  page,
}) => {
  // The e2e vault holds todos; its notes date by mtime, after the pinned day, so none counts as written.
  await serve(page, "/api/todos", []);
  await overview(page, { pin: true });
  const said = {
    Food: "nothing logged",
    Today: "no kcal goal",
    Weight: "no weigh-ins yet",
    Water: "no water goal",
    Flashcards: "no cards rated",
    Todos: "done today, 0 open, 0 overdue",
    Writing: "notes in 7 days, 0 today",
    "This year": "no notes this year",
  };
  for (const [name, text] of Object.entries(said)) await expect(words(page, name)).toHaveText(text);
  await expect(card(page, "Weight").locator(".overview-caption")).toHaveText(
    "weight, 30 days, no weigh-ins yet",
  );
  await expect(card(page, "Today").locator(".overview-caption")).toHaveText(
    "macros today, no goals",
  );
  await expect(region(page)).not.toHaveText(/NaN|Infinity/);
});

test("#806 I2 a failed log read shows its message on the log cards and the other cards still draw", async ({
  page,
}) => {
  await serve(page, "/api/log", { detail: "down" }, 500);
  await overview(page, { pin: true });
  const message = "GET /api/log failed with 500";
  for (const name of ["Food", "Today", "Weight", "Water"]) {
    await expect(card(page, name).getByRole("alert")).toHaveText(message);
  }
  await expect(region(page).getByRole("alert")).toHaveCount(4);
  await expect(words(page, "Todos")).toHaveText(/^done today, \d+ open, \d+ overdue$/);
  await expect(words(page, "This year")).toHaveText("no notes this year");
});

test.describe("written", () => {
  // A zone east of UTC, so half past midnight local is still the day before in UTC.
  test.use({ timezoneId: "Europe/Berlin" });

  test("#806 I6 a created instant counts on the reader's local day", async ({ page }) => {
    // Half past midnight on the 20th in Berlin, which UTC reads as the 19th.
    await serve(page, "/api/written", ["2026-10-19T22:30:00.000Z"]);
    await overview(page, { pin: true });
    await expect(words(page, "Writing")).toHaveText("notes in 7 days, 1 today");
    await expect(words(page, "This year")).toHaveText("notes on 1 of 293 days");
  });

  test("#806 A6 Writing counts notes in 7 days and today, This year counts notes on days this year", async ({
    page,
  }) => {
    const days = ["2026-10-20", "2026-10-20", "2026-10-14", "2026-03-02", "2025-12-30"];
    await serve(page, "/api/written", days);
    await overview(page, { pin: true });
    await expect(figure(page, "Writing")).toHaveText("3");
    await expect(words(page, "Writing")).toHaveText("notes in 7 days, 2 today");
    await expect(figure(page, "This year")).toHaveText("4");
    await expect(words(page, "This year")).toHaveText("notes on 3 of 293 days");
  });
});
