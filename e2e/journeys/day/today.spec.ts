import type { Page } from "@playwright/test";
import { gateway, openApp, tapHeight, walkBackoff } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const UNREAD = "Cards could not be counted: the daily limits could not be read";

/** The Due column of the home screen an empty pane shows: the third of Today, Recent and Due. */
const due = (page: Page) => page.locator("[data-today] [data-today-column]").nth(2);
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
