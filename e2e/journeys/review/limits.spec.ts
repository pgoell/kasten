import type { Page } from "@playwright/test";
import { leader, openApp, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const DUE = "<!--SR:!2020-01-01,3,250-->";
const TRIVIA = {
  "03 Flashcards/trivia.md":
    "#flashcards/trivia\n\n" +
    `Due one?::a ${DUE}\n\nDue two?::a ${DUE}\n\nDue three?::a ${DUE}\n\n` +
    "New one?::a\n\nNew two?::a\n\nNew three?::a\n",
};
const LIMITS = { "99 Misc/01 Config/decks.md": "trivia: 1 new, 2 reviews\n" };

/** Opens the review pane on its overview, with the focus in it. */
async function openReview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
}

test("a deck under a daily limit asks the due and new cards its row promised, then stops", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { ...TRIVIA, ...LIMITS });
  await openReview(page);
  const row = page.locator('button[data-deck="trivia"]');
  await expect(row).toContainText("2 due");
  await expect(row).toContainText("1 new");
  await row.click();
  await expect(page.getByText(/^\d+ left$/)).toHaveText("3 left");

  const asked: string[] = [];
  for (const question of ["Due one?", "Due two?", "New one?"]) {
    const front = page.getByTestId("review-question");
    await expect(front).toHaveText(question);
    asked.push(await front.innerText());
    await page.keyboard.press("Enter");
    await page.keyboard.press("3");
  }
  expect(asked).toEqual(["Due one?", "Due two?", "New one?"]);
  await expect(page.getByTestId("review-done")).toContainText("3 answered");
});

test("a sitting started after decks.md gained its line asks under that line, not the overview's older read", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, TRIVIA);
  await page.clock.install();
  await openReview(page);
  const row = page.locator('button[data-deck="trivia"]');
  // The overview has read the limits with no line for the deck; the line lands on disk after.
  await expect(row).toContainText("3 due");
  await vaultWith(stack.vault, LIMITS);
  // Past the app's 10 s staleTime, so the read is stale; a younger one is used as it is (#1995).
  await page.clock.fastForward(11_000);
  await row.click();
  await expect(page.getByTestId("review-question")).toHaveText("Due one?");
  await expect(page.getByText(/^\d+ left$/)).toHaveText("3 left");
});
