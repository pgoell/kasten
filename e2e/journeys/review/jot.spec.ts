import type { Page } from "@playwright/test";
import { leader, noteText, openApp, vaultWith } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

// One deck over two notes, so the note a question goes to is the shown card's and no other.
const NOTES: Record<string, string> = {
  "03 Flashcards/jot-a.md": "#flashcards/jot\n\nWhat is a VPC?::A private cloud\n",
  "03 Flashcards/jot-b.md": "#flashcards/jot\n\nWhat is S3?::Storage\n",
};

/** Sits the jot deck; returns the shown card's question and the note it came from. */
async function sitJot(page: Page, vault: string): Promise<{ question: string; note: string }> {
  await vaultWith(vault, NOTES);
  await openApp(page);
  await leader(page, "gs");
  await page.getByRole("heading", { name: "Review" }).click();
  await page.locator('button[data-deck="jot"]').click();
  const card = page.getByTestId("review-card");
  await expect(card).toContainText("?");
  const question = (await card.textContent())?.includes("VPC") ? "What is a VPC?" : "What is S3?";
  const note = Object.keys(NOTES).find((path) => NOTES[path]?.includes(question)) ?? "";
  return { question, note };
}

/** Counts the PUTs that write `path`, from here on. */
function countPuts(page: Page, path: string): () => number {
  let puts = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "PUT" && decodeURIComponent(url.pathname) === `/api/files/${path}`)
      puts += 1;
  });
  return () => puts;
}

const jotButton = (page: Page) => page.getByRole("button", { name: "Write a new question" });
const field = (page: Page) => page.getByLabel("a new question");

test.describe("a question jotted in a sitting", () => {
  test("goes to the end of the note the card on screen came from, and to no other", async ({
    page,
    stack,
  }) => {
    const { note } = await sitJot(page, stack.vault);
    const other = Object.keys(NOTES).find((path) => path !== note) ?? "";

    await jotButton(page).click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.type("What is a moved block?");
    await page.keyboard.press("Enter");

    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toMatch(/\nWhat is a moved block\?::\s*$/);
    expect(await noteText(stack.vault, other)).not.toContain("moved block");
  });

  test("leaves the card on screen and the count of cards left alone, and the field closes", async ({
    page,
    stack,
  }) => {
    const { question, note } = await sitJot(page, stack.vault);
    const left = page.getByText(/^\d+ left$/);
    await expect(left).toHaveText("2 left");

    await jotButton(page).click();
    await page.keyboard.type("What is a moved block?");
    await page.keyboard.press("Enter");

    // On disk first, so the reads below come after any refetch the write could start.
    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toContain("What is a moved block?::");
    await expect(field(page)).toHaveCount(0);
    await expect(page.getByTestId("review-card")).toContainText(question);
    await expect(left).toHaveText("2 left");
  });

  test("a second tap shuts the field and writes nothing", async ({ page, stack }) => {
    const { note } = await sitJot(page, stack.vault);
    const puts = countPuts(page, note);
    const button = jotButton(page);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.type("Dropped words");
    await button.click();
    await expect(field(page)).toHaveCount(0);
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // The next jot is the one write: the dropped words never went out before it.
    await button.click();
    await page.keyboard.type("Kept words");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => noteText(stack.vault, note), { timeout: 15_000 })
      .toContain("Kept words::");
    expect(puts()).toBe(1);
    expect(await noteText(stack.vault, note)).not.toContain("Dropped words");
  });
});
