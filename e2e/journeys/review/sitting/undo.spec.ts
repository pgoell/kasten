import type { Page } from "@playwright/test";
import { bodyOf, hold, noteText, phone, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { countPuts, rate, sitDeck, tapDeck } from "../review.ts";

const TWO_NOTE = "03 Flashcards/two.md";
const TWO = "#flashcards/two\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";
const X = "03 Flashcards/x.md";
const Y = "03 Flashcards/y.md";
const DECKS = "99 Misc/01 Config/decks.md";

const card = (page: Page) => page.getByTestId("review-card");
const back = (page: Page) => page.getByTestId("review-back");
const left = (page: Page) => page.getByText(/^\d+ left$/);
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
// Its name holds the Space hint on a desktop.
const reveal = (page: Page) => page.getByRole("button", { name: "Show the answer" });
const jotLine = (page: Page) => page.getByLabel("a new question");
const disk = async (vault: string, note = TWO_NOTE) => bodyOf(await noteText(vault, note));
/** Holds every request for `note` from here on, until the returned call lets them go. */
const holdNote = (page: Page, note: string) =>
  hold(page, new RegExp(`%2F${note.split("/").pop()?.replace(".", "\\.")}$`));

/** Sits deck two; returns the count of PUTs that write its note. */
async function sitTwo(page: Page, vault: string, notes = {}): Promise<() => number> {
  const puts = countPuts(page, TWO_NOTE);
  await sitDeck(page, vault, { [TWO_NOTE]: TWO, ...notes }, "two");
  return puts;
}

/** Sits deck ab, card A in x.md and card B in y.md, by taps when `tap` is set; rates A Good and waits for B. */
async function sitAB(page: Page, vault: string, tap = false): Promise<() => number> {
  const puts = countPuts(page, X, Y);
  const notes = {
    [X]: "#flashcards/ab\n\nWhat is A?::a\n",
    [Y]: "#flashcards/ab\n\nWhat is B?::b\n",
  };
  await (tap ? tapDeck : sitDeck)(page, vault, notes, "ab");
  await expect(card(page)).toContainText("What is A?");
  if (tap) {
    await reveal(page).tap();
    await button(page, "Good").tap();
    await expect.poll(puts).toBe(1);
  } else await rate(page, X, "Good");
  await expect(card(page)).toContainText("What is B?");
  return puts;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test.describe("an undo meets the sitting's writes (#600, #1135)", () => {
  test("#600 I3 an undo pressed while the rating's write is out waits behind it and lands on its stamped answer", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    const release = await holdNote(page, TWO_NOTE);
    await reveal(page).click();
    await button(page, "Good").click();
    await undo(page).click();
    await expect(undo(page)).toHaveAttribute("aria-disabled", "true");
    expect(puts()).toBe(1);
    await release();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect(back(page)).toContainText("A private cloud");
    await expect.poll(() => disk(stack.vault)).toBe(TWO);
    // The vault stamped the rating's write, so the undo named that answer, not the text it sent.
    expect(await noteText(stack.vault, TWO_NOTE)).toMatch(/^---\nid: /);
    expect(puts()).toBe(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#1135 I2 an undo pressed while the rating's write waits to retry lands after the retry and brings the card back", async ({
    page,
    stack,
  }) => {
    await page.clock.install();
    const puts = await sitTwo(page, stack.vault);
    const sent: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && decodeURIComponent(r.url()).endsWith(TWO_NOTE))
        sent.push(r.postData() ?? "");
    });
    let first = true;
    // The first try is dropped by a restart; the retry finds the note as it was.
    await page.route(/two\.md$/, (route) => {
      if (route.request().method() !== "PUT" || !first) return route.fallback();
      first = false;
      return route.fulfill({ status: 502, body: "{}", contentType: "application/json" });
    });
    const dropped = page.waitForResponse((r) => r.status() === 502);
    await reveal(page).click();
    await button(page, "Good").click();
    await dropped;
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
    await undo(page).click();
    await expect(undo(page)).toHaveAttribute("aria-disabled", "true");
    expect(puts()).toBe(1);
    await page.clock.runFor(1500);
    await page.clock.resume();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect(back(page)).toContainText("A private cloud");
    await expect.poll(() => disk(stack.vault)).toBe(TWO);
    expect(puts()).toBe(3);
    expect(sent[1]).toBe(sent[0]);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#600 B1 nothing rates, parks, turns or jots the next card while an undo is out", async ({
    page,
    stack,
  }) => {
    const puts = await sitAB(page, stack.vault);
    const release = await holdNote(page, X);
    await undo(page).click();
    await expect(undo(page)).toHaveAttribute("aria-disabled", "true");
    await expect(card(page)).toContainText("What is B?");
    for (const greyed of [
      reveal(page),
      button(page, "Park this card"),
      button(page, "Write a new question"),
    ]) {
      await expect(greyed).toHaveAttribute("aria-disabled", "true");
      await greyed.click({ force: true });
    }
    // The pane's keys reach the same callbacks as the buttons.
    for (const key of ["Space", "Enter", "n", "3", "s"]) await page.keyboard.press(key);
    await expect(back(page)).toHaveCount(0);
    await expect(page.getByTestId("review-capture")).toHaveCount(0);
    await expect.poll(puts).toBe(2);
    await release();
    // A back revealed, then B asked once: nothing done while the undo was out came back.
    await expect(card(page)).toContainText("What is A?");
    await expect(back(page)).toHaveText("a");
    await button(page, "Good").click();
    await expect(card(page)).toContainText("What is B?");
    await rate(page, Y, "Good");
    await expect(page.getByTestId("review-done")).toContainText("2 answered");
    expect(puts()).toBe(4);
  });

  test.describe("on a phone", () => {
    test.use(phone);

    test("#600 B1 a tap on a greyed button while an undo is out does nothing", async ({
      page,
      stack,
    }) => {
      const puts = await sitAB(page, stack.vault, true);
      const release = await holdNote(page, X);
      await undo(page).tap();
      await expect(undo(page)).toHaveAttribute("aria-disabled", "true");
      for (const greyed of [
        reveal(page),
        button(page, "Park this card"),
        button(page, "Write a new question"),
      ])
        await greyed.tap({ force: true });
      await expect(back(page)).toHaveCount(0);
      await expect(page.getByTestId("review-capture")).toHaveCount(0);
      await expect.poll(puts).toBe(2);
      await release();
      await expect(back(page)).toHaveText("a");
      await button(page, "Good").tap();
      await expect(card(page)).toContainText("What is B?");
      await expect.poll(puts).toBe(3);
    });
  });

  test("#600 B2 a jot sent while an undo is out stays in its line and goes once the undo lands", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await rate(page, TWO_NOTE, "Good");
    await button(page, "Write a new question").click();
    await jotLine(page).fill("What is a moved block?");
    const release = await holdNote(page, TWO_NOTE);
    await undo(page).click();
    await jotLine(page).press("Enter");
    await expect(undo(page)).toHaveAttribute("aria-disabled", "true");
    await expect.poll(puts).toBe(2);
    await expect(jotLine(page)).toHaveValue("What is a moved block?");
    await release();
    await expect(card(page)).toContainText("What is a VPC?");
    await jotLine(page).press("Enter");
    await expect.poll(() => disk(stack.vault)).toContain("What is a moved block?::");
    expect(await disk(stack.vault)).toContain("What is a VPC?::A private cloud\n");
    expect(puts()).toBe(3);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("#600 B4 a jot held through an undo lands in the note it was opened on", async ({
    page,
    stack,
  }) => {
    const puts = await sitAB(page, stack.vault);
    // Opened on B, which lives in y.md.
    await button(page, "Write a new question").click();
    await jotLine(page).fill("Q?");
    await undo(page).click();
    await expect(card(page)).toContainText("What is A?");
    await jotLine(page).press("Enter");
    await expect.poll(() => disk(stack.vault, Y)).toContain("Q?::");
    expect(await disk(stack.vault, X)).not.toContain("Q?");
    expect(puts()).toBe(3);
  });

  test("#600 B5 Jot it and Check are disabled while an undo is out, their text kept", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await button(page, "Type").click();
    await page.getByLabel("your answer").press("Enter");
    await button(page, "Good").click();
    await expect.poll(puts).toBe(1);
    await expect(card(page)).toContainText("What is S3?");
    await button(page, "Write a new question").click();
    await jotLine(page).fill("Q?");
    await page.getByLabel("your answer").fill("Storage");
    const release = await holdNote(page, TWO_NOTE);
    await undo(page).click();
    await expect(button(page, "Jot it")).toBeDisabled();
    await expect(button(page, "Check")).toBeDisabled();
    await expect(jotLine(page)).toHaveValue("Q?");
    await expect(page.getByLabel("your answer")).toHaveValue("Storage");
    await release();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect(button(page, "Jot it")).toBeEnabled();
  });
});

test.describe("a rating's refetch of the limits (#612)", () => {
  /** Counts the GETs of `path`, from here on. */
  function countGets(page: Page, path: string): () => number {
    let gets = 0;
    page.on("request", (r) => {
      if (r.method() === "GET" && decodeURIComponent(r.url()).endsWith(path)) gets += 1;
    });
    return () => gets;
  }

  /** Writes each of `lines` into decks.md as the note's PUT of that turn goes out. */
  async function decksOnPut(page: Page, vault: string, lines: string[]) {
    let turn = 0;
    await page.route(/two\.md$/, async (route) => {
      const line = route.request().method() === "PUT" ? lines[turn++] : undefined;
      if (line !== undefined) await vaultWith(vault, { [DECKS]: line });
      await route.fallback();
    });
  }

  /** Waits for a decks.md read after `before`, and for what it set off. */
  async function refetched(page: Page, reads: () => number, before: number) {
    await expect.poll(reads).toBeGreaterThan(before);
    await page.waitForTimeout(500);
  }

  test("#612 A1 a rating's refetch of a changed decks.md does not build the queue again", async ({
    page,
    stack,
  }) => {
    const reads = countGets(page, DECKS);
    const noteReads = countGets(page, TWO_NOTE);
    await sitTwo(page, stack.vault);
    await decksOnPut(page, stack.vault, ["two: 5 new\n"]);
    const [before, read] = [reads(), noteReads()];
    await rate(page, TWO_NOTE, "Good");
    await refetched(page, reads, before);
    await expect(card(page)).toContainText("What is S3?");
    await expect(left(page)).toHaveText("1 left");
    expect(noteReads()).toBe(read);
  });

  test("#612 A2 a card rated Again keeps its second asking across that refetch", async ({
    page,
    stack,
  }) => {
    const reads = countGets(page, DECKS);
    await sitTwo(page, stack.vault);
    await decksOnPut(page, stack.vault, ["two: 5 new\n"]);
    const before = reads();
    await rate(page, TWO_NOTE, "Again");
    await refetched(page, reads, before);
    await rate(page, TWO_NOTE, "Good");
    await expect(left(page)).toHaveText("1 left");
    await expect(card(page)).toContainText("What is a VPC?");
  });

  test("#612 A3 the count left does not jump back when decks.md cuts the limit after a rating", async ({
    page,
    stack,
  }) => {
    const reads = countGets(page, DECKS);
    await sitTwo(page, stack.vault);
    await decksOnPut(page, stack.vault, ["two: 1 new\n"]);
    const before = reads();
    await rate(page, TWO_NOTE, "Good");
    await refetched(page, reads, before);
    await expect(left(page)).toHaveText("1 left");
    await expect(card(page)).toContainText("What is S3?");
  });

  test("#612 A4 an undo puts back the queue behind the card when decks.md changes on every read", async ({
    page,
    stack,
  }) => {
    const reads = countGets(page, DECKS);
    await sitTwo(page, stack.vault);
    await decksOnPut(page, stack.vault, ["two: 2 new\n", "two: 1 new\n"]);
    const rated = reads();
    await rate(page, TWO_NOTE, "Good");
    await refetched(page, reads, rated);
    const undone = reads();
    await undo(page).click();
    await expect(card(page)).toContainText("What is a VPC?");
    await refetched(page, reads, undone);
    await expect(left(page)).toHaveText("2 left");
    await button(page, "Good").click();
    await expect(card(page)).toContainText("What is S3?");
  });

  test("#612 I3 a refetch that changes only the default limits builds nothing again", async ({
    page,
    stack,
  }) => {
    let reads = 0;
    let cut = false;
    await page.route(
      (url) => url.pathname === "/api/review/limits",
      (route) => {
        if (!cut) return route.fallback();
        reads += 1;
        return route.fulfill({ json: { new_per_day: 1, reviews_per_day: null } });
      },
    );
    await sitTwo(page, stack.vault);
    cut = true;
    await rate(page, TWO_NOTE, "Good");
    await expect.poll(() => reads).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    await expect(left(page)).toHaveText("1 left");
    await expect(card(page)).toContainText("What is S3?");
  });
});
