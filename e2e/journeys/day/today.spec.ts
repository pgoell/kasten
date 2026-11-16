import type { Page } from "@playwright/test";
import { gateway, openApp, phone, tapHeight, vaultWith, walkBackoff } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const UNREAD = "Cards could not be counted: the daily limits could not be read";

/** The home screen's columns an empty pane shows, in the order drawn: 0 Today, 1 Recent, 2 Due. */
const column = (page: Page, nth: number) =>
  page.locator("[data-today] [data-today-column]").nth(nth);
const due = (page: Page) => column(page, 2);
const unreadRow = (page: Page) => due(page).getByText(UNREAD);
const tryAgain = (page: Page) => due(page).getByRole("button", { name: "Try again" });

/** Fails every read of the daily limits with a 502 while `down` says so. */
const limitsDown = (page: Page, down: () => boolean) =>
  gateway(page, (url) => url.pathname === "/api/review/limits", down);

/** Opens the app on an installed clock: its empty pane shows the home screen. */
async function openToday(page: Page): Promise<void> {
  await page.clock.install();
  await openApp(page);
  await expect(page.locator("[data-today]")).toBeVisible();
}

test("the Due column says the cards could not be counted once the limits read fails at last, and gives no count", async ({
  page,
}) => {
  const failed = await limitsDown(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));

  await expect(unreadRow(page)).toBeVisible();
  // The e2e vault holds cards, so the count is what a lie would show here; Nothing due. would be one too.
  await expect(due(page)).not.toContainText("cards waiting");
  await expect(due(page)).not.toContainText("Nothing due.");
});

test("Try again on the unread row reads the limits again, and once they answer the row goes and the cards are counted", async ({
  page,
}) => {
  let down = true;
  const failed = await limitsDown(page, () => down);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));
  await expect(tryAgain(page)).toHaveAttribute("data-reread");
  expect(await tapHeight(tryAgain(page))).toBeGreaterThanOrEqual(44);

  down = false;
  await page.clock.resume();
  await tryAgain(page).click();

  await expect(due(page)).toContainText(/\d+ cards? waiting/);
  await expect(unreadRow(page)).toHaveCount(0);
  await expect(tryAgain(page)).toHaveCount(0);
});

test("Try again while the limits read still fails takes the row away while it retries, then brings it and Try again back", async ({
  page,
}) => {
  const failed = await limitsDown(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed, unreadRow(page));
  const before = failed();

  await tryAgain(page).click();
  await expect.poll(failed).toBeGreaterThan(before);
  await page.clock.runFor(100);
  await expect(unreadRow(page)).toHaveCount(0);

  await walkBackoff(page, failed, unreadRow(page), { from: before });
  await expect(unreadRow(page)).toBeVisible();
  await expect(tryAgain(page)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("#1139 I4 the Due column's count moves after its deck note's refetch gets a 502 and the next try answers", async ({
    page,
    stack,
  }) => {
    const alpha = "03 Flashcards/alpha.md";
    await vaultWith(stack.vault, { [alpha]: "#flashcards/alpha\n\na::b\n" });
    await page.clock.install();
    await page.goto("/");
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    await expect(due(page)).toContainText("3 cards waiting");
    await commands.getByRole("button", { name: "Run a command by name" }).tap();
    await page.getByRole("option", { name: /^Open the review pane/ }).tap();
    await page.locator('button[data-deck="alpha"]').tap();
    await page.getByRole("button", { name: "Show the answer" }).tap();
    const landed = page.waitForResponse((answer) => answer.request().method() === "PUT");
    await page.getByRole("button", { name: "Good" }).tap();
    await landed;
    let down = true;
    const failed = await gateway(
      page,
      (url) => decodeURIComponent(url.pathname) === `/api/files/${alpha}`,
      () => down,
    );
    await page.getByRole("button", { name: "Close Review" }).tap();
    await expect.poll(failed).toBe(1);
    down = false;
    await expect(due(page)).toContainText("2 cards waiting");
    expect(failed()).toBe(1);
  });
});

/** A Thursday, so the dates below read as today, earlier this month and overdue. */
const THURSDAY = new Date(2026, 9, 22, 9);
const DOING_TODAY = "- [/] Draft the report 📅 2026-10-22";
const stamped = (day: string) => `---\nmodified: 2026-10-${day}T09:00:00+00:00\n---\n\nwords\n`;

/** Notes go in before the load, so the first search sees them. */
async function openThursday(page: Page, vault: string, notes: Record<string, string> = {}) {
  await vaultWith(vault, notes);
  await page.clock.setFixedTime(THURSDAY);
  await page.goto("/");
  await expect(page.locator("[data-today]")).toBeVisible({ timeout: 15_000 });
}

test.describe("the home screen's columns", () => {
  test("Today heads the empty pane with the date", async ({ page, stack }) => {
    await openThursday(page, stack.vault);
    await expect(page.locator("[data-today] h1")).toHaveText("Thursday, 22 October 2026");
  });

  test("Today lists today's todos with their state", async ({ page, stack }) => {
    await openThursday(page, stack.vault, { "report.md": `${DOING_TODAY}\n` });
    const row = column(page, 0).getByRole("button", { name: /Draft the report/ });
    await expect(row.getByRole("img", { name: "doing" })).toBeVisible();
  });

  test("Recent lists the notes edited most recently, newest first, with their day", async ({
    page,
    stack,
  }) => {
    await openThursday(page, stack.vault, { "a.md": stamped("20"), "b.md": stamped("21") });
    await expect(column(page, 1).getByRole("button")).toHaveText(["b21 Oct", "a20 Oct"]);
  });

  test("Due lists overdue todos and open loops, and leaves out a todo of today", async ({
    page,
    stack,
  }) => {
    const todos = `- [ ] Pay the bill 📅 2026-10-01\n- [w] Wait for Anna\n${DOING_TODAY}\n`;
    await openThursday(page, stack.vault, { "loops.md": todos });
    const overdue = column(page, 2).getByRole("button", { name: /Pay the bill/ });
    await expect(overdue).toBeVisible();
    await expect(column(page, 2).getByRole("button", { name: /Wait for Anna/ })).toBeVisible();
    await expect(column(page, 2)).toContainText("Overdue");
    await expect(column(page, 2)).toContainText("Open loops");
    await expect(column(page, 2)).not.toContainText("Draft the report");
  });

  test("each column says so plainly when it has nothing", async ({ page, stack }) => {
    // The fixture's undated todos are neither today nor overdue; with its cards gone nothing is due.
    await openThursday(page, stack.vault, {
      "03 Flashcards/Capitals.md": "#flashcards/capitals\n",
    });
    await expect(column(page, 0)).toContainText("Nothing for today.");
    await expect(column(page, 1)).toContainText("Nothing written lately.");
    await expect(column(page, 2)).toContainText("Nothing due.");
  });

  test("a failed todos read leaves Today its plain line and the other columns drawn", async ({
    page,
    stack,
  }) => {
    const failed = await gateway(
      page,
      (url) => url.pathname === "/api/todos",
      () => true,
    );
    await openThursday(page, stack.vault, { "report.md": `${DOING_TODAY}\n` });
    await expect.poll(failed).toBeGreaterThan(0);
    await expect(column(page, 0)).toContainText("Nothing for today.");
    await expect(column(page, 0)).not.toContainText("Draft the report");
    await expect(column(page, 2)).toContainText(/\d+ cards? waiting/);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("the three columns stack, Today over Recent over Due", async ({ page, stack }) => {
      await openThursday(page, stack.vault, {
        "report.md": `${DOING_TODAY}\n`,
        "b.md": stamped("21"),
      });
      await expect(column(page, 0)).toContainText("Draft the report");
      await expect(column(page, 1)).toContainText("b21 Oct");
      const tops = await Promise.all(
        [0, 1, 2].map(async (n) => (await column(page, n).boundingBox())?.y ?? 0),
      );
      expect(tops[0]).toBeLessThan(tops[1] ?? 0);
      expect(tops[1]).toBeLessThan(tops[2] ?? 0);
    });
  });
});
