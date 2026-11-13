import { leader, noteText, openApp, phone, today } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const FRANCE = "What is the capital of France?::Paris";

/**
 * The due day and the last answer of the FSRS comment kasten wrote after the France card's
 * line, or "" while there is none. A first Good is days out, answered today (#1926).
 */
async function scheduleDate(vault: string): Promise<string> {
  const text = await noteText(vault, "03 Flashcards/Capitals.md");
  const line = text.split("\n").find((row) => row.startsWith(FRANCE)) ?? "";
  const found = /<!--SR:!fsrs,(\d{4}-\d{2}-\d{2})T[^>]*,(\d{4}-\d{2}-\d{2})T[^>]*-->/.exec(line);
  return found === null ? "" : `${found[1]} ${found[2]}`;
}

/** Whether the France card's FSRS comment is due after today and was answered today. */
async function answered(vault: string): Promise<boolean> {
  const [due = "", last = ""] = (await scheduleDate(vault)).split(" ");
  return due > today() && last === today();
}

test("a sitting on the desktop writes the FSRS comment after a good rating", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gs");
  // A click focuses the pane; `j` then reaches the deck row and `l` sits it.
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  await expect(page.getByText("What is the capital of France?")).toBeVisible();
  // Enter shows the answer.
  await page.keyboard.press("Enter");
  await expect(page.getByText("Paris", { exact: true })).toBeVisible();
  // 3 rates the card Good.
  await page.keyboard.press("3");
  await expect.poll(() => answered(stack.vault)).toBe(true);
});

test("in a split, the keys grade the card of the focused review pane and leave the pane beside it alone", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await leader(page, "%");
  await leader(page, "gs");
  const reviews = page.getByLabel("review", { exact: true });
  await expect(reviews).toHaveCount(2);
  const [one, two] = [reviews.nth(0), reviews.nth(1)];
  // Each pane sits the deck in turn, so the focus ends on the first.
  for (const pane of [two, one]) {
    await pane.getByRole("heading", { name: "Review" }).click();
    await page.keyboard.press("j");
    await page.keyboard.press("l");
    await expect(pane.getByTestId("review-card")).toContainText("France");
  }
  await page.keyboard.press("Enter");
  await expect(one.getByTestId("review-back")).toHaveText("Paris");
  await page.keyboard.press("3");
  await expect.poll(() => answered(stack.vault)).toBe(true);
  await expect(one.getByTestId("review-card")).toContainText("Japan");
  await expect(two.getByTestId("review-card")).toContainText("France");
  await expect(two.getByTestId("review-back")).toHaveCount(0);
  // One grade on disk: the France card's, none on Japan's.
  const text = await noteText(stack.vault, "03 Flashcards/Capitals.md");
  expect(text.match(/<!--SR:/g)).toHaveLength(1);
});

test("? in the review pane lists each review key beside its label, under In review", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("?");
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  // s, h, n and u answer in other groups too, so each row is read inside this one.
  const review = help
    .getByRole("heading", { name: "In review", exact: true })
    .locator("xpath=ancestor::section[1]");
  const rows: [string, string][] = [
    ["s", "Park the card"],
    ["n", "Write a new question"],
    ["Space or Enter", "Show the answer, then grade Good"],
    ["1 … 4", "Rate the card: again, hard, good, easy"],
    ["u", "Undo the last answer, or put a parked card back"],
    ["h", "Back to the decks"],
  ];
  for (const [key, label] of rows) {
    const term = review.locator("dt").getByText(key, { exact: true });
    await expect(term.locator("xpath=following-sibling::dd[1]")).toHaveText(label);
  }
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap-through sitting on a phone writes the FSRS comment after a good rating", async ({
    page,
    stack,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "2 cards waiting" }).tap();
    await page.getByRole("button", { name: "Start with capitals" }).tap();
    await page.getByRole("button", { name: "Show the answer" }).tap();
    await expect(page.getByText("Paris", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Good", exact: true }).tap();
    await expect.poll(() => answered(stack.vault)).toBe(true);
  });
});
