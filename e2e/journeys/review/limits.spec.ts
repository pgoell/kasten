import type { Page, Response } from "@playwright/test";
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

test.describe("the deck counts through a backend that restarts (#1139)", () => {
  const ALPHA = "03 Flashcards/alpha.md";
  const TWO = { [ALPHA]: "#flashcards/alpha\n\na::b\n\nc::d\n" };
  type Fail = number | "network" | "garbled";

  /** Answers alpha's next GETs with `fails` in turn, then lets them through; counts each GET from here. */
  async function armAlpha(page: Page, fails: Fail[]): Promise<() => number> {
    let reads = 0;
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${ALPHA}`,
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const fail = fails[reads++];
        if (fail === undefined) return route.fallback();
        if (fail === "network") return route.abort("failed");
        // A 200 whose body is no JSON: the read throws with no status to retry on.
        const body = fail === "garbled" ? "not json" : "{}";
        await route.fulfill({
          status: fail === "garbled" ? 200 : fail,
          body,
          contentType: "application/json",
        });
      },
    );
    return () => reads;
  }

  /** Rates the card on screen Good, once its question reads `question`. */
  async function rate(page: Page, question: string): Promise<void> {
    await expect(page.getByTestId("review-question")).toHaveText(question);
    await page.keyboard.press("Enter");
    await page.keyboard.press("3");
  }

  const waiting = (page: Page) => page.locator("[data-today] [data-today-column]").nth(2);

  const ONE = { [ALPHA]: "#flashcards/alpha\n\na::b\n" };
  const isAlphaPut = (answer: Response) =>
    answer.request().method() === "PUT" && decodeURIComponent(answer.url()).endsWith(ALPHA);

  /** Sits alpha's one card and rates it; once the write has landed, arms `fails` and goes back to the decks. */
  async function rateThenBack(page: Page, vault: string, fails: Fail[]): Promise<() => number> {
    await vaultWith(vault, ONE);
    await page.clock.install();
    await openReview(page);
    await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
    await page.locator('button[data-deck="alpha"]').click();
    const landed = page.waitForResponse(isAlphaPut);
    await rate(page, "a");
    await landed;
    const reads = await armAlpha(page, fails);
    await page.keyboard.press("h");
    await expect.poll(reads).toBeGreaterThan(0);
    return reads;
  }

  for (const fail of [502, 503, 504, "network"] as const) {
    test(`A1 A2 the overview's count moves after its note's refetch fails with ${fail} and the next try answers`, async ({
      page,
      stack,
    }) => {
      const reads = await rateThenBack(page, stack.vault, [fail]);
      await expect(page.getByText("2 cards to go today in 1 deck.")).toBeVisible();
      expect(reads()).toBe(2);
    });
  }

  for (const fail of [500, 404, "garbled"] as const) {
    test(`I1 a refetch that fails with ${fail} is not tried again and the overview keeps its count`, async ({
      page,
      stack,
    }) => {
      const reads = await rateThenBack(page, stack.vault, [fail]);
      await page.clock.runFor(61_000);
      // Proving a read that does not come: a retry the timer fired is on the wire in a few ms.
      await page.waitForTimeout(500);
      expect(reads()).toBe(1);
      await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
    });
  }

  test("I3 a rating while the deck note's read retries reads it afresh, once, and the count moves", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, TWO);
    await page.clock.install();
    await openApp(page);
    await leader(page, "%");
    await expect(waiting(page)).toContainText("4 cards waiting");
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Escape");
    await leader(page, "gs");
    await page.locator('button[data-deck="alpha"]').click();
    await expect(page.getByTestId("review-question")).toHaveText("a");
    const reads = await armAlpha(page, [502, 502]);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await rate(page, "a");
    await expect.poll(reads).toBe(1);
    await rate(page, "c");
    // The second rating's read goes out at once; the first read's retry, due at 1 s, is dropped.
    await expect.poll(reads).toBe(2);
    await page.clock.runFor(1000);
    await expect.poll(reads).toBe(3);
    await page.clock.runFor(60_000);
    await expect(waiting(page)).toContainText("2 cards waiting");
    expect(reads()).toBe(3);
  });
});
