import type { Page } from "@playwright/test";
import { gateway, leader, openApp, vaultWith, walkBackoff } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const ALPHA = "03 Flashcards/alpha.md";
const DECKS = {
  [ALPHA]: "#flashcards/alpha\n\na::b\n",
  "03 Flashcards/beta.md": "#flashcards/beta\n\nc::d\n",
};
const LINE = `These notes could not be read, so their cards are not counted: ${ALPHA}`;

/** Opens the review pane on its overview, with the focus in it. */
async function openReview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
}

/** The line naming the notes that could not be read. */
const unreadLine = (page: Page) => page.getByRole("alert").filter({ hasText: "could not be read" });
/** Fails every read of alpha's note with a 502 while `down` says so. */
const alphaDown = (page: Page, down: () => boolean) =>
  gateway(page, (url) => decodeURIComponent(url.pathname) === `/api/files/${ALPHA}`, down);

/** Sits the beta deck and rates its one card, which reads every deck note again, then goes back. */
async function rateBeta(page: Page): Promise<void> {
  await page.locator('button[data-deck="beta"]').click();
  await expect(page.getByTestId("review-question")).toHaveText("c");
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  await expect(page.getByTestId("review-done")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.locator('button[data-deck="beta"]')).toBeVisible();
}

test("a deck note whose read fails at last is named under the decks, and the other decks still show and count", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, DECKS);
  const failed = await alphaDown(page, () => true);
  await page.clock.install();
  await openReview(page);
  await walkBackoff(page, failed, unreadLine(page));

  await expect(unreadLine(page)).toHaveText(LINE);
  await expect(page.locator('button[data-deck="beta"]')).toContainText("1 new");
  await expect(page.locator('button[data-deck="alpha"]')).toHaveCount(0);
  // The e2e vault's Capitals deck holds two of the three, beta the third; alpha's card is not among them.
  await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
});

test("a deck note is named only once its last try fails, and the line goes when a later read of it answers", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, DECKS);
  let down = true;
  const failed = await alphaDown(page, () => down);
  await page.clock.install();
  await openReview(page);
  await walkBackoff(page, failed, unreadLine(page));
  await expect(unreadLine(page)).toHaveText(LINE);

  down = false;
  await page.clock.resume();
  await rateBeta(page);

  await expect(page.locator('button[data-deck="alpha"]')).toBeVisible();
  await expect(unreadLine(page)).toHaveCount(0);
});

test("a deck note whose read fails after an earlier read answered keeps its deck and is not named", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, DECKS);
  let down = false;
  const failed = await alphaDown(page, () => down);
  await page.clock.install();
  await openReview(page);
  await expect(page.locator('button[data-deck="alpha"]')).toContainText("1 new");

  down = true;
  await rateBeta(page);
  await walkBackoff(page, failed, unreadLine(page), { shows: false });

  await expect(page.locator('button[data-deck="alpha"]')).toContainText("1 new");
  await expect(unreadLine(page)).toHaveCount(0);
  // Capitals' two and alpha's one, beta's card answered: alpha's earlier read still counts.
  await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
});

/** A read the vault fails: an HTTP status, or the network down. */
type Failure = number | "network";

/** Fails the first `times` GETs of alpha's note from here on with `failure`, and counts every GET. */
async function failAlpha(page: Page, failure: Failure, times = Number.POSITIVE_INFINITY) {
  let reads = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${ALPHA}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      reads += 1;
      if (reads > times) return route.fallback();
      if (failure === "network") return route.abort("failed");
      await route.fulfill({ status: failure, body: "{}", contentType: "application/json" });
    },
  );
  return () => reads;
}

/**
 * Sits alpha with its note's reads failing as `fail` says, on a paused clock, once the
 * overview has read the note, so only the sitting's reads fail.
 */
async function sitAlpha(page: Page, vault: string, fail: (page: Page) => Promise<() => number>) {
  await vaultWith(vault, DECKS);
  await page.clock.install();
  await openReview(page);
  const deck = page.locator('button[data-deck="alpha"]');
  await expect(deck).toContainText("1 new");
  const reads = await fail(page);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await deck.click();
  await expect.poll(reads).toBe(1);
  return reads;
}

/** Runs the paused clock through the first retry's wait (1 s) until the second read goes out (#2013). */
async function firstRetry(page: Page, reads: () => number): Promise<void> {
  await expect
    .poll(async () => {
      if (reads() === 1) await page.clock.runFor(1000);
      return reads();
    })
    .toBe(2);
}

/** The sitting's word for a note it could not read. */
const readAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "could not be read" });

for (const failure of [502, 503, 504, "network"] as const) {
  test(`a sitting whose deck note read fails once with ${failure} says Reading the deck, reads it again and asks the card, with no alert`, async ({
    page,
    stack,
  }) => {
    const reads = await sitAlpha(page, stack.vault, (page) => failAlpha(page, failure, 1));
    await expect(page.getByText("Reading the deck…")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await firstRetry(page, reads);
    await expect
      .poll(async () => {
        await page.clock.runFor(100);
        return page.getByTestId("review-question").textContent();
      })
      .toBe("a");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(reads()).toBe(2);
  });
}

test("a sitting whose deck note read fails for the whole minute says the note could not be read, after eight tries", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, DECKS);
  await page.clock.install();
  await openReview(page);
  const deck = page.locator('button[data-deck="alpha"]');
  await expect(deck).toContainText("1 new");
  const reads = await failAlpha(page, 502);
  await deck.click();
  await walkBackoff(page, reads, readAlert(page));
  await expect(readAlert(page)).toHaveText(
    `The note could not be read: GET /api/files/${ALPHA} failed with 502`,
  );
  await expect(readAlert(page)).not.toContainText("written");
  // walkBackoff counts 8 before the alert; a ninth try would land before it shows.
  expect(reads()).toBe(8);
});

test("a 500 on a sitting's deck note read is not tried again and says the note could not be read at once", async ({
  page,
  stack,
}) => {
  const reads = await sitAlpha(page, stack.vault, (page) => failAlpha(page, 500));
  await expect(readAlert(page)).toHaveText(
    `The note could not be read: GET /api/files/${ALPHA} failed with 500`,
  );
  await page.clock.runFor(61_000);
  // Proving a read that does not come: a retry the timer fired is on the wire in a few ms.
  await page.waitForTimeout(500);
  expect(reads()).toBe(1);
});

test("a sitting closed while its deck note read is tried again reads it no more", async ({
  page,
  stack,
}) => {
  const reads = await sitAlpha(page, stack.vault, (page) => failAlpha(page, 502));
  await firstRetry(page, reads);
  // Closing the tab, not ← Decks, whose overview would read the note itself.
  await page.getByRole("button", { name: "Close Review" }).click();
  // Less than the second retry's 2 s wait, for the closing pane to leave the page.
  await page.clock.runFor(500);
  await expect(page.getByText("Reading the deck…")).toHaveCount(0);
  await page.clock.runFor(61_000);
  await page.waitForTimeout(500);
  expect(reads()).toBe(2);
});
