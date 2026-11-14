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
    await sitCloze(page, stack.vault);
    await grade(page, "Again");
    // c2, then c1 once more at the back of the queue.
    await expect(page.getByTestId("review-card")).toHaveText("The capital of France is [a city].");
    await grade(page, "Good");
    await expect(page.getByTestId("review-card")).toHaveText("The capital of [...] is Paris.");
    await grade(page, "Again");
    await expect
      .poll(async () => {
        const text = await line(stack.vault);
        return [text.match(/<!--SR:c1!/g)?.length, text.match(/<!--SR:c2!/g)?.length];
      })
      .toEqual([1, 1]);
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
