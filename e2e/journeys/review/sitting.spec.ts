import type { Page } from "@playwright/test";
import {
  leader,
  localDate,
  noteText,
  openApp,
  phone,
  tapHeight,
  today,
  vaultWith,
} from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

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

/**
 * Where the card and its words sit in the scroll column that holds them (#600): the words'
 * middle against the card's, the card's middle and top against the column's.
 */
function placed(page: Page) {
  return page.getByTestId("review-card").evaluate((card) => {
    const words = document.createRange();
    words.selectNodeContents(card.querySelector(".cm-line") as Element);
    const text = words.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const swipe = card.closest('[data-testid="review-swipe"]') as HTMLElement;
    const column = swipe.parentElement as HTMLElement;
    const pane = column.getBoundingClientRect();
    return {
      across: Math.abs((text.left + text.right) / 2 - (box.left + box.right) / 2),
      indent: text.left - box.left,
      down: Math.abs((box.top + box.bottom) / 2 - (pane.top + pane.bottom) / 2),
      top: box.top - pane.top,
      room: pane.height - box.height,
      scroll: column.scrollTop,
    };
  });
}

test("Center centres the card both ways, off puts it back, a reload keeps it, and a tall card keeps its top", async ({
  page,
  stack,
}) => {
  // Japan's question wraps past the pane's height, for the tall card at the end.
  const long = "Which city, of all the cities of the islands, is the capital of Japan? ".repeat(60);
  await vaultWith(stack.vault, {
    "03 Flashcards/Capitals.md": `#flashcards/capitals\n\n${FRANCE}\n\n${long}::Tokyo\n`,
  });
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.keyboard.press("j");
  await page.keyboard.press("l");
  const france = page.getByText("What is the capital of France?");
  await expect(france).toBeVisible();
  const center = page.getByRole("button", { name: "Center" });
  await expect(center).toHaveAttribute("aria-pressed", "false");
  const off = await placed(page);
  expect(off.indent, "words at the card's left").toBeLessThan(20);
  expect(off.top, "card at the column's top").toBeLessThan(40);

  await center.click();
  await expect(center).toHaveAttribute("aria-pressed", "true");
  const on = await placed(page);
  expect(on.room, "the column is taller than the card").toBeGreaterThan(100);
  expect(on.across, "across").toBeLessThan(8);
  expect(on.indent, "words off the card's left").toBeGreaterThan(20);
  expect(on.down, "down").toBeLessThan(8);

  await center.click();
  await expect(center).toHaveAttribute("aria-pressed", "false");
  expect((await placed(page)).indent).toBeLessThan(20);
  await center.click();

  // The reload comes back on the review overview, the pane the workspace kept.
  await page.reload();
  await page.getByRole("button", { name: "Start with capitals" }).click({ timeout: 15_000 });
  await expect(france).toBeVisible();
  await expect(center).toHaveAttribute("aria-pressed", "true");
  const kept = await placed(page);
  expect([kept.across < 8, kept.down < 8]).toEqual([true, true]);

  // A card taller than the column, centred, keeps its first line at the top, not above it.
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  await expect(page.getByTestId("review-card")).toContainText("capital of Japan");
  const tall = await placed(page);
  expect(tall.room, "the card is taller than the column").toBeLessThan(0);
  expect([tall.scroll, tall.top >= 0]).toEqual([0, true]);
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

  test("a phone sets the question at 28 px and the scroller around it at the body size", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "2 cards waiting" }).tap();
    await page.getByRole("button", { name: "Start with capitals" }).tap();
    const question = page.getByTestId("review-question");
    await expect(question).toBeVisible();
    // The size sits on the question's own wrapper, not on what holds the answer and the lines around it.
    const sizes = await question.evaluate((front) => {
      const own = getComputedStyle(front);
      return [
        own.fontSize,
        own.lineHeight,
        getComputedStyle(front.parentElement as HTMLElement).fontSize,
      ];
    });
    expect(sizes.slice(0, 2)).toEqual(["28px", "32.2px"]);
    expect(sizes[2]).not.toBe("28px");
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

  test("the header's Type button stands a thumb wide and tall", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "2 cards waiting" }).tap();
    await page.getByRole("button", { name: "Start with capitals" }).tap();
    const type = page.getByRole("button", { name: "Type", exact: true });
    // To the layout unit, as tapHeight reads a height (#1852).
    const width = Math.round(((await type.boundingBox())?.width ?? 0) * 64) / 64;
    expect(width).toBeGreaterThanOrEqual(44);
    expect(await tapHeight(type)).toBeGreaterThanOrEqual(44);
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
  await expect(page.getByRole("alert")).toHaveText(
    "The note could not be written: Changed on disk",
  );
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

/** The local date `days` from today, as an SM-2 comment names a due day. */
const daysOn = (days: number): string => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return localDate(at);
};

/** Opens the review pane and sits the deck named `name`. */
async function sit(page: Page, name: string): Promise<void> {
  await openReview(page);
  await page.locator(`button[data-deck="${name}"]`).click();
}

test("the done screen counts the cards answered today, the ones another sitting answered too", async ({
  page,
  stack,
}) => {
  // Two cards another sitting answered today (due in four days, four days' interval), and a new one.
  const sm2 = `<!--SR:!${daysOn(4)},4,250-->`;
  await vaultWith(stack.vault, {
    "03 Flashcards/aws.md": `#flashcards/aws\n\nQ1::A ${sm2}\n\nQ2::B ${sm2}\n\nWhat does S3 stand for?::Simple Storage Service\n`,
  });
  await sit(page, "aws");
  await expect(page.getByText("What does S3 stand for?")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  await expect(page.getByTestId("review-done")).toContainText("3 answered today in aws.");
});

test("the done screen says how many new cards wait, when the deck's limit holds them back", async ({
  page,
  stack,
}) => {
  // A card due today and a new card, under a limit of no new cards a day.
  await vaultWith(stack.vault, {
    "03 Flashcards/aws.md": `#flashcards/aws\n\nQ1::A <!--SR:!${today()},4,250-->\n\nWhat does S3 stand for?::Simple Storage Service\n`,
    "99 Misc/01 Config/decks.md": "aws: 0 new\n",
  });
  await sit(page, "aws");
  await expect(page.getByText("Q1")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.press("3");
  const done = page.getByTestId("review-done");
  await expect(done).toContainText("1 answered today in aws.");
  await expect(done).toContainText("1 new card waits.");
});

test("a whole note whose schedule reads backwards says where it is from and no last seen", async ({
  page,
  stack,
}) => {
  // A negative interval puts the last answer in the future, which no answer could have written.
  await vaultWith(stack.vault, {
    "03 Flashcards/TLS.md": `---\nsr-due: ${today()}\nsr-interval: -3\nsr-ease: 250\n---\n#review\n\n# TLS\n\nthe handshake\n`,
  });
  await sit(page, "TLS");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^From /)).toHaveText("From TLS");
});
