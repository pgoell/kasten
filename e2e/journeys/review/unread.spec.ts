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
  await walkBackoff(page, failed, unreadLine(page));

  await expect(page.locator('button[data-deck="alpha"]')).toContainText("1 new");
  await expect(unreadLine(page)).toHaveCount(0);
  // Capitals' two and alpha's one, beta's card answered: alpha's earlier read still counts.
  await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
});
