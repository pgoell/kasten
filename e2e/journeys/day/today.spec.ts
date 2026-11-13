import type { Page } from "@playwright/test";
import { openApp, tapHeight } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// The waits of frontend/src/lib/core/read-retry.ts, which a 502 is tried again after: 8 tries.
const BACKOFF = [1000, 2000, 4000, 8000, 15000, 15000, 15000];
const UNREAD = "Cards could not be counted: the daily limits could not be read";

/** The Due column of the home screen an empty pane shows: the third of Today, Recent and Due. */
const due = (page: Page) => page.locator("[data-today] [data-today-column]").nth(2);
const unreadRow = (page: Page) => due(page).getByText(UNREAD);
const tryAgain = (page: Page) => due(page).getByRole("button", { name: "Try again" });

/** Answers every read of the daily limits with a 502 while `down` says so, and counts the failed ones. */
async function gateway(page: Page, down: () => boolean): Promise<() => number> {
  let failed = 0;
  await page.route("**/api/review/limits", async (route) => {
    if (!down()) return route.fallback();
    failed += 1;
    await route.fulfill({ status: 502, body: "{}", contentType: "application/json" });
  });
  return () => failed;
}

/** Opens the app on an installed clock: its empty pane shows the home screen. */
async function openToday(page: Page): Promise<void> {
  await page.clock.install();
  await openApp(page);
  await expect(page.locator("[data-today]")).toBeVisible();
}

/**
 * Lets each retry's wait run, one counted try at a time, until all 8 tries after `from` have
 * failed. Before each wait the unread row must not show, since a try is still left.
 */
async function walkBackoff(page: Page, failed: () => number, from = 0): Promise<void> {
  const tried = () => failed() - from;
  await expect.poll(tried).toBeGreaterThan(0);
  if (from === 0) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  for (let tries = tried(); tries <= BACKOFF.length; tries = tried()) {
    await expect(unreadRow(page)).toHaveCount(0);
    await page.clock.runFor(BACKOFF[tries - 1] ?? 0);
    await expect.poll(tried).toBeGreaterThan(tries);
  }
  expect(tried()).toBe(BACKOFF.length + 1);
  // TanStack Query hands its updates to the screen through a setTimeout(0), which the paused clock holds.
  await page.clock.runFor(100);
}

test("the Due column says the cards could not be counted once the limits read fails at last, and gives no count", async ({
  page,
}) => {
  const failed = await gateway(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed);

  await expect(unreadRow(page)).toBeVisible();
  // The e2e vault holds cards, so the count is what a lie would show here; Nothing due. would be one too.
  await expect(due(page)).not.toContainText("cards waiting");
  await expect(due(page)).not.toContainText("Nothing due.");
});

test("Try again on the unread row reads the limits again, and once they answer the row goes and the cards are counted", async ({
  page,
}) => {
  let down = true;
  const failed = await gateway(page, () => down);
  await openToday(page);
  await walkBackoff(page, failed);
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
  const failed = await gateway(page, () => true);
  await openToday(page);
  await walkBackoff(page, failed);
  const before = failed();

  await tryAgain(page).click();
  await expect.poll(failed).toBeGreaterThan(before);
  await page.clock.runFor(100);
  await expect(unreadRow(page)).toHaveCount(0);

  await walkBackoff(page, failed, before);
  await expect(unreadRow(page)).toBeVisible();
  await expect(tryAgain(page)).toBeVisible();
});
