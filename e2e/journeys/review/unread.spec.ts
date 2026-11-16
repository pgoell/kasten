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
  // The tries stop at eight: a minute more reads the note no more (#1139 I2).
  await page.clock.runFor(60_000);
  expect(failed()).toBe(8);

  await expect(page.locator('button[data-deck="alpha"]')).toContainText("1 new");
  await expect(unreadLine(page)).toHaveCount(0);
  // Capitals' two and alpha's one, beta's card answered: alpha's earlier read still counts.
  await expect(page.getByText("3 cards to go today in 2 decks.")).toBeVisible();
});

/** A read the vault fails: an HTTP status, or the network down. */
type Failure = number | "network";

/** Fails the first `times` GETs of `note` from here on with `failure`, and counts every GET. */
async function failNote(
  page: Page,
  note: string,
  failure: Failure,
  times = Number.POSITIVE_INFINITY,
) {
  let reads = 0;
  await page.route(
    (url) => decodeURIComponent(url.pathname) === `/api/files/${note}`,
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
    const reads = await sitAlpha(page, stack.vault, (page) => failNote(page, ALPHA, failure, 1));
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
  const reads = await failNote(page, ALPHA, 502);
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
  const reads = await sitAlpha(page, stack.vault, (page) => failNote(page, ALPHA, 500));
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
  const reads = await sitAlpha(page, stack.vault, (page) => failNote(page, ALPHA, 502));
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

test.describe("Try again on a sitting whose deck note read failed for good (#1163)", () => {
  const tryAgain = (page: Page) => page.getByRole("button", { name: "Try again" });

  /** Sits alpha with its first read failing with a 500, which is not tried again; returns that read's count. */
  async function failedSitting(page: Page, vault: string) {
    const first = await sitAlpha(page, vault, (page) => failNote(page, ALPHA, 500, 1));
    await expect(readAlert(page)).toBeVisible();
    await expect(tryAgain(page)).toBeVisible();
    return first;
  }

  /** Runs the paused clock until the sitting asks alpha's card. */
  async function asked(page: Page) {
    await expect
      .poll(async () => {
        await page.clock.runFor(100);
        return page.getByTestId("review-question").textContent();
      })
      .toBe("a");
  }

  test("A3 Try again reads the deck note again and asks the card, with no alert and no Try again", async ({
    page,
    stack,
  }) => {
    const reads = await failedSitting(page, stack.vault);
    await tryAgain(page).click();
    await asked(page);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);
    expect(reads()).toBe(2);
  });

  test("I1 after Try again answered, a rating whose write fails shows its alert with no Try again", async ({
    page,
    stack,
  }) => {
    await failedSitting(page, stack.vault);
    await tryAgain(page).click();
    await asked(page);
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${ALPHA}`,
      (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({ status: 500, json: {} })
          : route.fallback(),
    );
    await page.getByRole("button", { name: "Show the answer" }).click();
    await page.getByRole("button", { name: "Good" }).click();
    const unwritten = page.getByRole("alert").filter({ hasText: "The note could not be written" });
    await expect
      .poll(async () => {
        await page.clock.runFor(100);
        return unwritten.count();
      })
      .toBe(1);
    await expect(tryAgain(page)).toHaveCount(0);
  });

  test("I2 a Try again while the backend is still down says Reading the deck, tries eight times, then offers Try again again", async ({
    page,
    stack,
  }) => {
    const first = await failedSitting(page, stack.vault);
    // Playwright asks the newest route first, so every later read gets a 502.
    const again = await failNote(page, ALPHA, 502);
    await tryAgain(page).click();
    await expect(page.getByText("Reading the deck…")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(tryAgain(page)).toHaveCount(0);

    await walkBackoff(page, again, readAlert(page));
    await expect(readAlert(page)).toHaveText(
      `The note could not be read: GET /api/files/${ALPHA} failed with 502`,
    );
    await expect(tryAgain(page)).toBeVisible();
    expect([first(), again()]).toEqual([1, 8]);
  });

  test("I3 a sitting closed while a Try again read is tried again reads it no more", async ({
    page,
    stack,
  }) => {
    await failedSitting(page, stack.vault);
    const again = await failNote(page, ALPHA, 502);
    await tryAgain(page).click();
    await firstRetry(page, again);
    await page.getByRole("button", { name: "Close Review" }).click();
    await page.clock.runFor(500);
    await expect(page.getByText("Reading the deck…")).toHaveCount(0);
    await page.clock.runFor(61_000);
    // Proving a read that does not come: a retry the timer fired is on the wire in a few ms.
    await page.waitForTimeout(500);
    expect(again()).toBe(2);
  });
});

test.describe("the parked list's reads through a backend that restarts (#1150, #1151)", () => {
  const SR = "<!--SR:!2026-08-20,4,270-->";
  const A = "03 Flashcards/aws-a.md";
  const C = "03 Flashcards/aws-c.md";
  const PARKED = {
    [A]: `#flashcards/aws\n\nQ A?::answer A !suspended ${SR}\n`,
    [C]: `#flashcards/aws\n\nQ C?::answer C !suspended ${SR}\n`,
  };
  const isCards = (url: URL) => url.pathname === "/api/cards";
  const isNote = (note: string) => (url: URL) =>
    decodeURIComponent(url.pathname) === `/api/files/${note}`;
  const alert = (page: Page, words: string) => page.getByRole("alert").filter({ hasText: words });
  const putBack = (page: Page, note: string) =>
    page.locator(`button[data-unpark^="${note}:"]`).click();

  /** Opens the parked list on a paused-capable clock; with `settled`, once the overview has read both notes. */
  async function openParked(page: Page, vault: string, settled = true) {
    await vaultWith(vault, PARKED);
    await page.clock.install();
    await openReview(page);
    if (settled) await expect(page.getByRole("button", { name: "2 parked cards" })).toBeVisible();
  }
  const pressP = async (page: Page) => {
    await page.keyboard.press("p");
    await expect(page.getByRole("button", { name: "← Decks" })).toBeVisible();
  };

  test("a scan that is out says Reading the notes and not Nothing parked, then draws the rows once a retry answers", async ({
    page,
    stack,
  }) => {
    let down = true;
    await gateway(page, isCards, () => down);
    await openParked(page, stack.vault, false);
    await pressP(page);
    await expect(page.getByText("Reading the notes…")).toBeVisible();
    await expect(page.getByText(/Nothing parked/)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    down = false;
    await expect
      .poll(async () => {
        await page.clock.runFor(1000);
        return page.getByText("Q A?").count();
      })
      .toBe(1);
    await expect(page.getByText(/Nothing parked/)).toHaveCount(0);
  });

  test("a scan that fails for the whole minute shows its error after eight tries, and not Nothing parked", async ({
    page,
    stack,
  }) => {
    const failed = await gateway(page, isCards, () => true);
    await openParked(page, stack.vault, false);
    await pressP(page);
    const line = alert(page, "The cards could not be read");
    await walkBackoff(page, failed, line);
    await expect(line).toHaveText("The cards could not be read: GET /api/cards failed with 502");
    await expect(page.getByText(/Nothing parked/)).toHaveCount(0);
  });

  test("a scan that answers no lines says Nothing parked", async ({ page, stack }) => {
    await page.route(
      (url) => isCards(url),
      (route) => route.fulfill({ json: [] }),
    );
    await openParked(page, stack.vault, false);
    await pressP(page);
    await expect(page.getByText(/^Nothing parked\./)).toBeVisible();
  });

  for (const failure of [502, "network"] as const) {
    test(`a parked note read that fails once with ${failure} is read again and its rows show, with no alert`, async ({
      page,
      stack,
    }) => {
      await openParked(page, stack.vault);
      const reads = await failNote(page, A, failure, 1);
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
      await pressP(page);
      await firstRetry(page, reads);
      await expect
        .poll(async () => {
          await page.clock.runFor(100);
          return page.getByText("Q A?").count();
        })
        .toBe(1);
      await expect(page.getByRole("alert")).toHaveCount(0);
    });
  }

  test("a parked note read that fails for the whole minute shows the read alert, after eight tries", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    const failed = await gateway(page, isNote(A), () => true);
    await pressP(page);
    const line = alert(page, "The note could not be read");
    await walkBackoff(page, failed, line);
    await expect(line).toHaveText(
      `The note could not be read: GET /api/files/${A} failed with 502`,
    );
    await expect(page.getByText("Q A?")).toHaveCount(0);
  });

  test("a failed read's alert goes once a later read answers", async ({ page, stack }) => {
    await openParked(page, stack.vault);
    await page.clock.resume();
    await pressP(page);
    await expect(page.getByText("Q C?")).toBeVisible();
    await failNote(page, A, 500);
    // C's put-back lands and reads the cards again, which reads A, which fails.
    await putBack(page, C);
    const line = alert(page, "The note could not be read");
    await expect(line).toHaveText(
      `The note could not be read: GET /api/files/${A} failed with 500`,
    );

    await page.unrouteAll({ behavior: "wait" });
    await putBack(page, A);
    await expect(page.getByText(/^Nothing parked\./)).toBeVisible();
    await expect(line).toHaveCount(0);
  });

  test("a put-back whose write failed keeps its alert after a later read answers", async ({
    page,
    stack,
  }) => {
    await openParked(page, stack.vault);
    await page.clock.resume();
    await pressP(page);
    await expect(page.getByText("Q C?")).toBeVisible();
    await page.route(isNote(A), (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({ status: 409, json: {} })
        : route.fallback(),
    );
    await putBack(page, A);
    const line = alert(page, "The note could not be written");
    await expect(line).toBeVisible();
    const said = await line.innerText();

    // C's put-back lands and the list reads A again; C goes from the screen before that read lands.
    const reread = page.waitForResponse(
      (answer) => isNote(A)(new URL(answer.url())) && answer.request().method() === "GET",
    );
    await putBack(page, C);
    await reread;
    await expect(page.getByText("Q C?")).toHaveCount(0);
    // Two frames, for React to draw what the read answered.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await expect(line).toHaveText(said);
    await expect(page.getByText("Q A?")).toBeVisible();
  });
});
