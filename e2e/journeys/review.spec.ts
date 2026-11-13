import type { Page } from "@playwright/test";
import {
  leader,
  noteText,
  openApp,
  phone,
  tapHeight,
  today,
  vaultWith,
} from "../harness/app.ts";
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
  // A mouse's screen keeps the Space hint and the 44 px grades a phone does without (#793).
  const reveal = page.getByRole("button", { name: "Show the answer" });
  await expect(reveal.getByText("Space", { exact: true })).toBeVisible();
  // Enter shows the answer.
  await page.keyboard.press("Enter");
  await expect(page.getByText("Paris", { exact: true })).toBeVisible();
  expect(await tapHeight(page.locator("button[data-rating]").first())).toBe(44);
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

  test("a phone's four grades stand 64 px in one row with their labels alone, and Show the answer has no Space hint", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "2 cards waiting" }).tap();
    await page.getByRole("button", { name: "Start with capitals" }).tap();
    const reveal = page.getByRole("button", { name: "Show the answer" });
    await expect(reveal).toBeVisible();
    // A finger has no Space bar (#793).
    await expect(reveal.getByText("Space", { exact: true })).toBeHidden();
    await reveal.tap();
    const grades = page.locator("button[data-rating]");
    await expect(grades).toHaveText(["Again", "Hard", "Good", "Easy"]);
    const tops = new Set<number>();
    for (const grade of await grades.all()) {
      expect(await tapHeight(grade)).toBe(64);
      tops.add(Math.round((await grade.boundingBox())?.y ?? -1));
    }
    expect([...tops]).toHaveLength(1);
  });
});

const SR = "<!--SR:!2026-08-20,4,270-->";
const PARKED_A = "03 Flashcards/parked-a.md";
const PARKED_B = "03 Flashcards/parked-b.md";

/** Two notes of one parked card each, which the overview counts as "2 parked cards". */
async function twoParked(vault: string): Promise<void> {
  await vaultWith(vault, {
    [PARKED_A]: `#flashcards/aws\n\nQ A?::answer A !suspended ${SR}\n`,
    [PARKED_B]: `#flashcards/aws\n\nQ B?::answer B !suspended ${SR}\n`,
  });
}

/** Opens the review pane on its overview, with the focus in it. */
async function openReview(page: Page): Promise<void> {
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
}

/**
 * Answers every GET of `path`'s note with `status` from here on, and counts them.
 * Installed once the overview has read the notes, so only the screen under test fails.
 */
async function failReads(page: Page, path: string, status: number): Promise<() => number> {
  let reads = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${path}`,
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      reads += 1;
      await route.fulfill({ status, body: "{}", contentType: "application/json" });
    },
  );
  return () => reads;
}

/** Stops the page's clock, so a retry's wait runs only when the test lets it. */
async function pauseClock(page: Page): Promise<void> {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
}

/** Runs the clock past the whole backoff (about a minute), then gives a retry time to go out. */
async function pastBackoff(page: Page): Promise<void> {
  await page.clock.runFor(61_000);
  // Proving a read that does not come: a retry the timer fired is on the wire in a few ms.
  await page.waitForTimeout(500);
}

test("a put-back the vault refuses says the note could not be written, and a later failed read shows beside it", async ({
  page,
  stack,
}) => {
  await twoParked(stack.vault);
  await openReview(page);
  await page.getByRole("button", { name: "2 parked cards" }).click();
  await expect(page.locator(`button[data-unpark="${PARKED_A}:0"]`)).toBeVisible();
  // The note moves on disk after the list read it, so the put-back's base is stale (#1159).
  const moved = `${await noteText(stack.vault, PARKED_A)}An outside line.\n`;
  await vaultWith(stack.vault, { [PARKED_A]: moved });
  await page.locator(`button[data-unpark="${PARKED_A}:0"]`).click();
  await expect(page.getByRole("alert")).toHaveText("The note could not be written: Changed on disk");
  expect(await noteText(stack.vault, PARKED_A)).toBe(moved);
  // B's put-back lands, which reads the cards again and so the parked notes, and A's read fails.
  await failReads(page, PARKED_A, 500);
  await page.locator(`button[data-unpark="${PARKED_B}:0"]`).click();
  await expect(page.getByRole("alert")).toHaveText([
    `The note could not be read: GET /api/files/${PARKED_A} failed with 500`,
    "The note could not be written: Changed on disk",
  ]);
  expect(await noteText(stack.vault, PARKED_B)).not.toContain("!suspended");
});

test("a parked list whose one note fails for good reads its other note no more", async ({
  page,
  stack,
}) => {
  await twoParked(stack.vault);
  await page.clock.install();
  await openReview(page);
  const parked = page.getByRole("button", { name: "2 parked cards" });
  await expect(parked).toBeVisible();
  await failReads(page, PARKED_A, 500);
  const readsOfB = await failReads(page, PARKED_B, 502);
  await pauseClock(page);
  await parked.click();
  await expect(page.getByRole("alert")).toContainText(`${PARKED_A} failed with 500`);
  await expect.poll(readsOfB).toBe(1);
  // A 502 alone is tried again for a minute (#1162).
  await pastBackoff(page);
  expect(readsOfB()).toBe(1);
});

test("a sitting whose one deck note fails for good reads its other deck note no more", async ({
  page,
  stack,
}) => {
  const [one, two] = ["03 Flashcards/two-one.md", "03 Flashcards/two-two.md"];
  await vaultWith(stack.vault, {
    [one]: "#flashcards/two\n\nQ one?::answer one\n",
    [two]: "#flashcards/two\n\nQ two?::answer two\n",
  });
  await page.clock.install();
  await openReview(page);
  const deck = page.locator('button[data-deck="two"]');
  await expect(deck).toBeEnabled();
  await failReads(page, one, 500);
  const readsOfTwo = await failReads(page, two, 502);
  await pauseClock(page);
  await deck.click();
  await expect(page.getByRole("alert")).toContainText(`${one} failed with 500`);
  await expect.poll(readsOfTwo).toBe(1);
  await pastBackoff(page);
  expect(readsOfTwo()).toBe(1);
});
