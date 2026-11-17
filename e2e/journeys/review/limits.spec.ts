import type { Locator, Page, Response } from "@playwright/test";
import {
  bodyOf,
  gateway,
  leader,
  localDate,
  noteText,
  openApp,
  vaultWith,
  walkBackoff,
} from "../../harness/app.ts";
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
    // The query's answer is handed on by a timer, which the paused clock runs only once the answer is in (#2114).
    const third = page.waitForResponse((r) => r.request().method() === "GET" && r.ok() && decodeURIComponent(r.url()).endsWith(ALPHA));
    await page.clock.runFor(1000);
    await expect.poll(reads).toBe(3);
    await third;
    await page.clock.runFor(60_000);
    await expect(waiting(page)).toContainText("2 cards waiting");
    expect(reads()).toBe(3);
  });
});

test.describe("a new card rated again (#816)", () => {
  // Pinned, as a rating stamps the day it reads at the press (#1315).
  const NOW = new Date(2026, 7, 10, 12);
  const day = (days: number) => localDate(new Date(2026, 7, 10 + days, 12));
  const fsrs = (due: number, fields: string) =>
    `<!--SR:!fsrs,${day(due)}T00:00:00.000Z,${fields},${day(0)}T00:00:00.000Z-->`;
  const AWS = "03 Flashcards/aws.md";
  const VPC = "What is a VPC?::A private cloud";
  const SM2 = `#flashcards/aws\n\n${VPC} ${DUE}\n`;
  const card = async (vault: string) =>
    (await noteText(vault, AWS)).split("\n").find((line) => line.startsWith(VPC));
  const aws = (page: Page) => page.locator('button[data-deck="aws"]');

  /** The aws deck under `limit` new a day, opened on its sitting. */
  async function sit(page: Page, vault: string, text: string, limit = "aws: 1 new\n") {
    await vaultWith(vault, { [AWS]: text, "99 Misc/01 Config/decks.md": limit });
    await page.clock.setFixedTime(NOW);
    await openReview(page);
    await aws(page).click();
  }

  /** Each rating in turn, turning the card first. */
  async function rate(page: Page, ...names: string[]) {
    for (const name of names) {
      await page.getByRole("button", { name: "Show the answer" }).click();
      await page.getByRole("button", { name, exact: true }).click();
    }
    await expect(page.getByTestId("review-done")).toBeVisible();
  }

  for (const [ratings, due, fields] of [
    [["Again", "Good"], 3, "3,2.31,2.12,2,1,0,0"],
    [["Again", "Easy"], 8, "8,8.30,1.00,2,1,0,0"],
    [["Again", "Again", "Good"], 3, "3,2.31,2.12,2,1,0,0"],
  ] as const)
    test(`${ratings.join(" then ")} writes a first answer and spends one new card of the limit`, async ({
      page,
      stack,
    }) => {
      const three = `#flashcards/aws\n\n${VPC}\n\nWhat is S3?::Storage\n\nWhat is EC2?::A server\n`;
      await sit(page, stack.vault, three);
      await rate(page, ...ratings);
      await expect.poll(() => card(stack.vault)).toBe(`${VPC} ${fsrs(due, fields)}`);
      // Back on the overview the one new card a day is spent: read as a review, the row would offer S3.
      await page.getByRole("button", { name: "← Decks" }).click();
      await expect(aws(page)).toBeDisabled();
      await expect(aws(page)).not.toContainText("new");
    });

  test("a review card rated again then good turns into FSRS from its SM-2 schedule", async ({
    page,
    stack,
  }) => {
    await sit(page, stack.vault, SM2, "");
    await rate(page, "Again", "Good");
    await expect.poll(() => card(stack.vault)).toBe(`${VPC} ${fsrs(3, "3,1.69,8.50,2,4,1,0")}`);
  });

  test("#1926 undo of the rating that turned an SM-2 card into FSRS puts its SM-2 comment back as it was", async ({
    page,
    stack,
  }) => {
    await sit(page, stack.vault, SM2, "");
    await rate(page, "Good");
    await expect.poll(() => card(stack.vault)).toContain("<!--SR:!fsrs,");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => bodyOf(await noteText(stack.vault, AWS))).toBe(SM2);
  });

  test("undo of the second rating, then again, still writes a first answer", async ({ page, stack }) => {
    await sit(page, stack.vault, `#flashcards/aws\n\n${VPC}\n`);
    await rate(page, "Again", "Good");
    await page.getByRole("button", { name: "Undo" }).click();
    // Back on the card, its answer still shown.
    await expect(page.getByTestId("review-question")).toHaveText("What is a VPC?");
    await page.getByRole("button", { name: "Again", exact: true }).click();
    await expect.poll(() => card(stack.vault)).toBe(`${VPC} ${fsrs(1, "1,0.21,6.41,2,1,0,0")}`);
  });

  test("a whole note marked #review rated again then good writes a first answer's schedule", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { "notes/tls.md": "# TLS #review\n\nthe handshake\n" });
    await page.clock.setFixedTime(NOW);
    await openReview(page);
    await page.locator('button[data-deck="tls"]').click();
    // A whole note is shown from the start, so the ratings are the only buttons.
    await page.getByRole("button", { name: "Again", exact: true }).click();
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await expect(page.getByTestId("review-done")).toBeVisible();
    const fields = async () =>
      (await noteText(stack.vault, "notes/tls.md")).split("\n").filter((line) => line.startsWith("sr-"));
    await expect.poll(fields).toEqual([`sr-due: ${day(1)}`, "sr-interval: 1", "sr-ease: 250"]);
  });
});

test.describe("Try again on daily limits whose read failed for good (#1167, #1170, #1171)", () => {
  const LIMITS_API = (url: URL) => url.pathname === "/api/review/limits";
  const ALERT = "The daily limits could not be read: GET /api/review/limits failed with 502";
  const limitsAlert = (page: Page) => page.getByRole("alert").filter({ hasText: "daily limits" });
  const tryAgain = (page: Page) => page.getByRole("button", { name: "Try again" });
  const left = (page: Page) => page.getByText(/^\d+ left$/);
  const trivia = (page: Page) => page.locator('button[data-deck="trivia"]');

  /** Runs the paused clock until `target` shows: the query's answers reach the screen through a timer. */
  const shown = (page: Page, target: Locator) =>
    expect
      .poll(async () => {
        await page.clock.runFor(100);
        return target.count();
      })
      .toBeGreaterThan(0);

  /**
   * Sits trivia once the overview has read the limits and that read is stale, so the sitting reads
   * them itself; every later limits read fails while `backend.down`, and `later` lands on disk first.
   */
  async function failedSitting(page: Page, vault: string, later = LIMITS) {
    await vaultWith(vault, TRIVIA);
    await page.clock.install();
    await openReview(page);
    await expect(trivia(page)).toContainText("3 due");
    await vaultWith(vault, later);
    // Past the app's 10 s staleTime; a younger answer is used as it is.
    await page.clock.fastForward(11_000);
    const backend = { down: true };
    const failed = await gateway(page, LIMITS_API, () => backend.down);
    await trivia(page).click();
    await walkBackoff(page, failed, limitsAlert(page));
    await expect(limitsAlert(page)).toHaveText(ALERT);
    return { backend, failed };
  }

  test("#1171 A4 I2 #1167 A1 I3 a sitting whose limits refetch fails asks no card; Enter on Try again once the backend is back asks under decks.md as it reads now", async ({
    page,
    stack,
  }) => {
    // The overview read the limits before decks.md gained trivia's line, so its answer would say 6 left.
    const { backend, failed } = await failedSitting(page, stack.vault);
    await expect(page.getByTestId("review-card")).toHaveCount(0);
    await expect(tryAgain(page)).toBeVisible();
    backend.down = false;
    await tryAgain(page).focus();
    await page.keyboard.press("Enter");
    await shown(page, page.getByTestId("review-question"));
    await expect(page.getByTestId("review-question")).toHaveText("Due one?");
    await expect(left(page)).toHaveText("3 left");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);
    expect(failed()).toBe(8);
  });

  test("#1167 I1 a limits Try again while the backend is still down says Reading the deck, tries eight times, then offers Try again again", async ({
    page,
    stack,
  }) => {
    const { failed } = await failedSitting(page, stack.vault);
    await tryAgain(page).click();
    await expect(page.getByText("Reading the deck…")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);
    await walkBackoff(page, failed, limitsAlert(page), { from: 8 });
    await expect(limitsAlert(page)).toHaveText(ALERT);
    await expect(tryAgain(page)).toBeVisible();
  });

  test("#1167 I2 after a limits Try again answered, a rating whose write fails shows its alert with no Try again", async ({
    page,
    stack,
  }) => {
    const { backend } = await failedSitting(page, stack.vault);
    backend.down = false;
    await tryAgain(page).click();
    await shown(page, page.getByTestId("review-question"));
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${Object.keys(TRIVIA)[0]}`,
      (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({ status: 500, json: {} })
          : route.fallback(),
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("3");
    await shown(page, page.getByRole("alert").filter({ hasText: "The note could not be written" }));
    await expect(tryAgain(page)).toHaveCount(0);
  });

  test("#1171 I3 a sitting that has its limits keeps asking with no alert when a rating's limits refetch fails for good", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, { ...TRIVIA, ...LIMITS });
    await page.clock.install();
    await openReview(page);
    await trivia(page).click();
    await expect(left(page)).toHaveText("3 left");
    const failed = await gateway(page, LIMITS_API, () => true);
    await page.keyboard.press("Enter");
    await page.keyboard.press("3");
    // The rating's write refetches the limits; all eight tries fail and no alert may show.
    await walkBackoff(page, failed, limitsAlert(page), { shows: false });
    await expect(page.getByTestId("review-question")).toHaveText("Due two?");
    await expect(left(page)).toHaveText("2 left");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#1170 I4 Enter on the overview's limits Try again shows the decks, with the focus left in the pane", async ({
    page,
    stack,
  }) => {
    await vaultWith(stack.vault, TRIVIA);
    const backend = { down: true };
    const failed = await gateway(page, LIMITS_API, () => backend.down);
    await page.clock.install();
    await openReview(page);
    await walkBackoff(page, failed, limitsAlert(page));
    await expect(limitsAlert(page)).toHaveText(ALERT);
    await expect(trivia(page)).toHaveCount(0);
    backend.down = false;
    await tryAgain(page).focus();
    await page.keyboard.press("Enter");
    await shown(page, trivia(page));
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator('[aria-label="review"]')).toBeFocused();
  });
});
