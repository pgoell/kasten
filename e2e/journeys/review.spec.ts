import { leader, noteText, openApp, phone, today } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const FRANCE = "What is the capital of France?::Paris";

/**
 * The due day and the last answer of the FSRS comment kasten wrote after the France card's
 * line, or "" while there is none. Good keeps a new card in learning, due today (#1926).
 */
async function scheduleDate(vault: string): Promise<string> {
  const text = await noteText(vault, "03 Flashcards/Capitals.md");
  const line = text.split("\n").find((row) => row.startsWith(FRANCE)) ?? "";
  const found = /<!--SR:!fsrs,(\d{4}-\d{2}-\d{2})T[^>]*,(\d{4}-\d{2}-\d{2})T[^>]*-->/.exec(line);
  return found === null ? "" : `${found[1]} ${found[2]}`;
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
  await expect.poll(() => scheduleDate(stack.vault)).toBe(`${today()} ${today()}`);
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
    await expect.poll(() => scheduleDate(stack.vault)).toBe(`${today()} ${today()}`);
  });
});
