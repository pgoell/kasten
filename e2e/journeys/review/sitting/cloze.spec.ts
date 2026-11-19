import type { Page } from "@playwright/test";
import { bodyOf, leader, noteText, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { sitDeck } from "../review.ts";

const NOTE = "03 Flashcards/cloze.md";
const LINE = "The capital of {{c1::France}} is {{c2::Paris::a city}}.";

/** A cloze note of two numbers, the review pane open on it and its first card shown. */
async function sitCloze(page: Page, vault: string): Promise<void> {
  await sitDeck(page, vault, { [NOTE]: `#flashcards/cloze\n\n${LINE}\n` }, "cloze");
  await expect(page.getByTestId("review-card")).toHaveText("The capital of [...] is Paris.");
}

/** The cloze line as it stands on disk. */
const line = async (vault: string) =>
  (await noteText(vault, NOTE)).split("\n").find((row) => row.startsWith(LINE)) ?? "";

const grade = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "Show the answer" }).click();
  await page.getByRole("button", { name, exact: true }).click();
};

test.describe("a cloze card in a sitting", () => {
  test("asks each number in turn, and each grade writes that number's own comment on the line", async ({
    page,
    stack,
  }) => {
    await sitCloze(page, stack.vault);
    await page.getByRole("button", { name: "Show the answer" }).click();
    // The back is the whole sentence with the number filled in.
    await expect(page.getByTestId("review-back")).toHaveText("The capital of France is Paris.");
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await expect.poll(() => line(stack.vault)).toMatch(/^[^<]+ <!--SR:c1!fsrs,[^>]+-->$/);

    await expect(page.getByTestId("review-card")).toHaveText("The capital of France is [a city].");
    await grade(page, "Easy");
    await expect
      .poll(() => line(stack.vault))
      .toMatch(
        /^[^<]+ <!--SR:c1!fsrs,[^>]+--> <!--SR:c2!fsrs,[^>,]+,8,8\.30,1\.00,2,1,0,0,[^>]+-->$/,
      );
    await expect(page.getByTestId("review-done")).toBeVisible();
  });

  test("a number asked again rewrites its own comment in place", async ({ page, stack }) => {
    // Counted only once the third grade's write is answered: the second's line already passes,
    // and a second Again on a learning card may write the same comment again.
    let answered = 0;
    page.on("response", (response) => {
      const path = decodeURIComponent(new URL(response.url()).pathname);
      if (response.request().method() === "PUT" && path === `/api/files/${NOTE}`) answered += 1;
    });
    await sitCloze(page, stack.vault);
    await grade(page, "Again");
    // c2, then c1 once more at the back of the queue.
    await expect(page.getByTestId("review-card")).toHaveText("The capital of France is [a city].");
    await grade(page, "Good");
    await expect(page.getByTestId("review-card")).toHaveText("The capital of [...] is Paris.");
    await grade(page, "Again");
    await expect.poll(() => answered).toBe(3);
    const text = await line(stack.vault);
    expect([text.match(/<!--SR:c1!/g)?.length, text.match(/<!--SR:c2!/g)?.length]).toEqual([1, 1]);
  });

  test("a typed answer is matched against the hidden text, not the sentence", async ({
    page,
    stack,
  }) => {
    await sitCloze(page, stack.vault);
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await page.getByLabel("your answer").fill("france");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-verdict")).toContainText("Matched");
  });

  test("parking the card drops every number of it from the sitting", async ({ page, stack }) => {
    await sitCloze(page, stack.vault);
    await page.getByRole("button", { name: "Park this card" }).click();
    await expect(page.getByTestId("review-done")).toBeVisible();
    await expect.poll(() => line(stack.vault)).toBe(`${LINE} !suspended`);
  });
});

/** A one-card deck of `back`, the review pane open on it and its question shown. */
async function sitTyped(page: Page, vault: string, back: string): Promise<void> {
  await sitDeck(
    page,
    vault,
    { "03 Flashcards/typed.md": `#flashcards/typed\n\nWhat is it?::${back}\n` },
    "typed",
  );
  await expect(page.getByTestId("review-card")).toHaveText("What is it?");
}

/** Types `words` into the answer box, Type pressed first, and sends them. */
async function answer(page: Page, words: string): Promise<void> {
  await page.getByRole("button", { name: "Type", exact: true }).click();
  await page.getByLabel("your answer").fill(words);
  await page.keyboard.press("Enter");
}

test.describe("a typed answer", () => {
  test("Type swaps Show the answer for the answer box, and the grades wait for the answer", async ({
    page,
    stack,
  }) => {
    await sitTyped(page, stack.vault, "Simple Storage Service");
    const reveal = page.getByRole("button", { name: "Show the answer" });
    const box = page.getByLabel("your answer");
    const good = page.getByRole("button", { name: "Good", exact: true });
    await expect(reveal).toBeVisible();
    await expect(box).toHaveCount(0);

    await page.getByRole("button", { name: "Type", exact: true }).click();
    await expect(box).toBeVisible();
    await expect(reveal).toHaveCount(0);
    await expect(good).toHaveCount(0);
    await expect(page.getByTestId("review-back")).toHaveCount(0);

    await box.fill("simple storage service");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("review-back")).toHaveText("Simple Storage Service");
    await expect(page.getByTestId("review-verdict")).toHaveText("Matched");
    await expect(good).toBeVisible();
  });

  test("an answer that differs says what was typed, and the grades still stand", async ({
    page,
    stack,
  }) => {
    await sitTyped(page, stack.vault, "Simple Storage Service");
    await answer(page, "Simple Store Service");
    await expect(page.getByTestId("review-verdict")).toHaveText("You typed Simple Store Service");
    await expect(page.getByRole("button", { name: "Easy", exact: true })).toBeVisible();
  });

  for (const [back, typed] of [
    ["a\\\\-b \\*c\\* <!--anki:1:0:abcdef12-->", "a\\-b *c*"],
    ["a\\\\\\&#58; \\&#58; <!--anki:1:0:abcdef12-->", "a\\&#58; &#58;"],
  ])
    test(`an imported back's escapes are no part of the answer: ${typed} matches`, async ({
      page,
      stack,
    }) => {
      await sitTyped(page, stack.vault, back);
      await answer(page, typed);
      await expect(page.getByTestId("review-verdict")).toHaveText("Matched");
    });

  test("the choice to type holds across a reload", async ({ page, stack }) => {
    await sitTyped(page, stack.vault, "Simple Storage Service");
    await page.getByRole("button", { name: "Type", exact: true }).click();
    await expect(page.getByLabel("your answer")).toBeVisible();
    await page.reload();
    await leader(page, "gs");
    await page.getByRole("heading", { name: "Review" }).click();
    await page.locator('button[data-deck="typed"]').click();
    await expect(page.getByLabel("your answer")).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the answer" })).toHaveCount(0);
  });
});

test.describe("Undo puts a parked card back (#600)", () => {
  test("A6 a parked cloze comes back with its other number in the queue too", async ({
    page,
    stack,
  }) => {
    await sitCloze(page, stack.vault);
    await page.getByRole("button", { name: "Park this card" }).click();
    await expect(page.getByTestId("review-done")).toBeVisible();
    await expect.poll(() => line(stack.vault)).toBe(`${LINE} !suspended`);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("review-question")).toHaveText("The capital of [...] is Paris.");
    await expect(page.getByTestId("review-back")).toHaveText("The capital of France is Paris.");
    await expect(page.getByText(/^\d+ left$/)).toHaveText("2 left");
    await expect.poll(() => line(stack.vault)).toBe(LINE);
  });

  test("I6 a whole note gets its frontmatter schedule back, and then its suspend", async ({
    page,
    stack,
  }) => {
    const TLS = "notes/tls.md";
    const START = ["sr-due: 2026-01-01", "sr-interval: 4", "sr-ease: 250"];
    const body = "# TLS #review\n\nthe handshake\n";
    await sitDeck(page, stack.vault, { [TLS]: `---\n${START.join("\n")}\n---\n${body}` }, "tls");
    const sr = async () =>
      (await noteText(stack.vault, TLS)).split("\n").filter((row) => row.startsWith("sr-"));
    const card = page.getByTestId("review-card");
    await page.getByRole("button", { name: "Good", exact: true }).click();
    await expect.poll(sr).toContain("sr-interval: 10");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(sr).toEqual(START);
    await expect(card).toContainText("the handshake");

    await page.getByRole("button", { name: "Park this card" }).click();
    await expect.poll(sr).toContain("sr-suspended: true");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(sr).toEqual(START);
    await expect(card).toContainText("the handshake");
    expect(bodyOf(await noteText(stack.vault, TLS))).toBe(body);
  });
});

test.describe("Undo in a sitting (#600)", () => {
  const TWO_NOTE = "03 Flashcards/two.md";
  const TWO = "#flashcards/two\n\nWhat is a VPC?::A private cloud\n\nWhat is S3?::Storage\n";
  const MOVED_ON = "The note changed since that step, so it was not undone.";
  const card = (page: Page) => page.getByTestId("review-card");
  const back = (page: Page) => page.getByTestId("review-back");
  const left = (page: Page) => page.getByText(/^\d+ left$/);
  const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
  const disk = async (vault: string) => bodyOf(await noteText(vault, TWO_NOTE));
  const rating = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

  /** Counts the PUTs that write the note, from here on. */
  function countPuts(page: Page): () => number {
    let puts = 0;
    page.on("request", (r) => {
      if (r.method() === "PUT" && decodeURIComponent(r.url()).endsWith(TWO_NOTE)) puts += 1;
    });
    return () => puts;
  }

  /** Sits deck two beside `notes`; returns the count of PUTs that write its note. */
  async function sitTwo(page: Page, vault: string, notes = {}): Promise<() => number> {
    const puts = countPuts(page);
    await sitDeck(page, vault, { [TWO_NOTE]: TWO, ...notes }, "two");
    return puts;
  }

  /** Turns the card and rates it, then waits for the write's answer. */
  async function rate(page: Page, name: string): Promise<void> {
    const landed = page.waitForResponse(
      (r) => r.request().method() === "PUT" && decodeURIComponent(r.url()).endsWith(TWO_NOTE),
    );
    await page.getByRole("button", { name: "Show the answer" }).click();
    await rating(page, name).click();
    await landed;
  }

  /** Aborts each PUT of the note while `down.on`. */
  async function cutWrites(page: Page, down: { on: boolean }) {
    await page.route(
      (url) => decodeURIComponent(url.pathname) === `/api/files/${TWO_NOTE}`,
      (r) => (r.request().method() === "PUT" && down.on ? r.abort() : r.fallback()),
    );
  }
  /** Runs the clock on until `puts` reaches `tries`. */
  const runUntil = (page: Page, puts: () => number, tries: number) =>
    expect
      .poll(
        async () => {
          await page.clock.runFor(15_000);
          return puts();
        },
        { timeout: 20_000 },
      )
      .toBe(tries);

  test("A5 takes back a rating: the old text goes back and the card comes back first, its answer shown", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await rate(page, "Good");
    await expect(card(page)).toContainText("What is S3?");
    await undo(page).click();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect(back(page)).toContainText("A private cloud");
    await expect(left(page)).toHaveText("2 left");
    await expect.poll(() => disk(stack.vault)).toBe(TWO);
    expect(puts()).toBe(2);
  });

  test("A7 I1 stays on the done screen and brings the last card back, one step only, the rating before kept", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await rate(page, "Good");
    await rate(page, "Good");
    await expect(page.getByTestId("review-done")).toContainText("2 answered");
    await undo(page).click();
    await expect(card(page)).toContainText("What is S3?");
    await expect(back(page)).toContainText("Storage");
    await expect(left(page)).toHaveText("1 left");
    await expect(undo(page)).toHaveCount(0);
    await expect.poll(() => disk(stack.vault)).toContain("What is S3?::Storage\n");
    expect(await disk(stack.vault)).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(puts()).toBe(3);
  });

  test("A8 an undone first answer gives the card back its place under the daily new limit", async ({
    page,
    stack,
  }) => {
    await sitTwo(page, stack.vault, { "99 Misc/01 Config/decks.md": "two: 1 new\n" });
    await expect(left(page)).toHaveText("1 left");
    await rate(page, "Good");
    await expect(page.getByTestId("review-done")).toBeVisible();
    await undo(page).click();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect.poll(() => disk(stack.vault)).toBe(TWO);
    await page.getByRole("button", { name: "← Decks" }).click();
    await expect(page.locator('button[data-deck="two"]')).toContainText("1 new");
  });

  test("A9 an undo over a note changed on disk since the step writes nothing and says so", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await rate(page, "Good");
    const other = `${await noteText(stack.vault, TWO_NOTE)}\nwritten elsewhere\n`;
    await vaultWith(stack.vault, { [TWO_NOTE]: other });
    await undo(page).click();
    await expect(page.getByRole("alert")).toHaveText(MOVED_ON);
    expect([await noteText(stack.vault, TWO_NOTE), puts()]).toEqual([other, 2]);
    await expect(card(page)).toContainText("What is S3?");
    await expect(back(page)).toHaveCount(0);
    await expect(left(page)).toHaveText("1 left");
  });

  test("I2 undoing Again leaves no second seat of the card and takes the answer off the count", async ({
    page,
    stack,
  }) => {
    await sitTwo(page, stack.vault);
    await rate(page, "Again");
    await expect(left(page)).toHaveText("2 left");
    await undo(page).click();
    await expect(card(page)).toContainText("What is a VPC?");
    await expect(left(page)).toHaveText("2 left");
    await rating(page, "Good").click();
    await rate(page, "Good");
    await expect(page.getByTestId("review-done")).toContainText("2 answered");
  });

  test("I4 an undo after a jot into the same note is refused, keeping the question", async ({
    page,
    stack,
  }) => {
    const puts = await sitTwo(page, stack.vault);
    await rate(page, "Good");
    await page.getByRole("button", { name: "Write a new question" }).click();
    await page.keyboard.type("What is a moved block?");
    await page.keyboard.press("Enter");
    await expect.poll(() => disk(stack.vault)).toContain("What is a moved block?::");
    await undo(page).click();
    await expect(page.getByRole("alert")).toHaveText(MOVED_ON);
    expect(puts()).toBe(3);
    expect(await disk(stack.vault)).toContain("What is a VPC?::A private cloud <!--SR:");
    expect(await disk(stack.vault)).toContain("What is a moved block?::");
    await expect(card(page)).toContainText("What is S3?");
  });

  test("I5 an undo the network fails restores nothing and says why", async ({ page, stack }) => {
    await page.clock.install();
    const puts = await sitTwo(page, stack.vault);
    await rate(page, "Good");
    const rated = await noteText(stack.vault, TWO_NOTE);
    await cutWrites(page, { on: true });
    await undo(page).click();
    // The write is tried again for about a minute, then the failure shows.
    await runUntil(page, puts, 9);
    await expect(page.getByRole("alert")).toHaveText(
      "The note could not be written: Failed to fetch",
    );
    expect(await noteText(stack.vault, TWO_NOTE)).toBe(rated);
    await expect(card(page)).toContainText("What is S3?");
    await expect(undo(page)).toHaveCount(0);
  });

  test("an undo after the rating's write failed for good is refused, writing nothing", async ({
    page,
    stack,
  }) => {
    await page.clock.install();
    const puts = await sitTwo(page, stack.vault);
    const down = { on: true };
    await cutWrites(page, down);
    await page.getByRole("button", { name: "Show the answer" }).click();
    await rating(page, "Good").click();
    await runUntil(page, puts, 8);
    await expect(page.getByRole("alert")).toContainText("could not be written: Failed to fetch");
    down.on = false;
    await undo(page).click();
    // The rating never landed, so the base the undo names is one the vault never held.
    await expect(page.getByRole("alert")).toHaveText(MOVED_ON);
    expect([await noteText(stack.vault, TWO_NOTE), puts()]).toEqual([TWO, 9]);
    await expect(card(page)).toContainText("What is S3?");
  });
});
