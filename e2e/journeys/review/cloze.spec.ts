import type { Page } from "@playwright/test";
import { leader, noteText, openApp, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

const NOTE = "03 Flashcards/cloze.md";
const LINE = "The capital of {{c1::France}} is {{c2::Paris::a city}}.";

/** A cloze note of two numbers, the review pane open on it and its first card shown. */
async function sitCloze(page: Page, vault: string): Promise<void> {
  await vaultWith(vault, { [NOTE]: `#flashcards/cloze\n\n${LINE}\n` });
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.locator('button[data-deck="cloze"]').click();
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
  await vaultWith(vault, {
    "03 Flashcards/typed.md": `#flashcards/typed\n\nWhat is it?::${back}\n`,
  });
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.locator('button[data-deck="typed"]').click();
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
