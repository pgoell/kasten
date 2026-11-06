import { findNote, leader, noteText, openApp, phone } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const primer = "04 Books/Primer.md";

test("the book pane reopens a pdf at the page it was left on", async ({ page, stack }) => {
  await openApp(page);
  await findNote(page, "Primer");
  await expect(page.getByRole("tab", { name: "Primer", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toBeFocused();

  // pdf.js draws the pages on a canvas, so no page text reaches the DOM. The header
  // shows the page as a share of the 8 pages: page N reads N/8.
  await leader(page, "gr");
  const pane = page.locator("[data-book-pane]");
  await expect(pane.getByText("13%", { exact: true })).toBeVisible();
  for (const percent of ["25%", "38%", "50%"]) {
    await page.keyboard.press("l");
    await expect(pane.getByText(percent, { exact: true })).toBeVisible();
  }

  // Closing the reader writes the place into the note's frontmatter, and the note beside takes
  // the focus, so the next leader key needs no click first (#1605).
  await page.keyboard.press("q");
  await expect(pane).toHaveCount(0);
  await expect
    .poll(() => noteText(stack.vault, primer), { timeout: 15_000 })
    .toMatch(/^reading: epubcfi\(/m);

  await leader(page, "gr");
  await expect(page.locator("[data-book-pane]").getByText("50%", { exact: true })).toBeVisible();
});

test("Escape in the tree hands the keys back to the book pane", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gr");
  const pane = page.locator("[data-book-pane]");
  await expect(pane.getByText("13%", { exact: true })).toBeVisible();
  await leader(page, "e");
  const tree = page.getByRole("navigation", { name: "Vault" });
  await expect(tree.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(tree).toBeVisible();
  await page.keyboard.press("l");
  await expect(pane.getByText("25%", { exact: true })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use(phone);

  test("closing the book from the palette shows its note again", async ({ page }) => {
    await page.goto(`/?note=${encodeURIComponent(primer)}`);
    const commands = page.getByRole("toolbar", { name: "Commands" });
    await expect(commands).toBeVisible({ timeout: 15_000 });
    const run = async (name: RegExp) => {
      await commands.getByRole("button", { name: "Run a command by name" }).tap();
      await page.getByRole("option", { name }).first().tap();
    };
    await expect(page.getByText("Notes on the primer")).toBeVisible();

    await run(/Read this note's book beside it/);
    await expect(page.locator("[data-book-pane]")).toBeVisible();
    await run(/Close the note, then the pane/);

    // The pane goes with the book, so no empty pane showing Today stacks under the note.
    await expect(page.locator("[data-book-pane]")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toHaveCount(1);
    await expect(page.getByText("Notes on the primer")).toBeVisible();
  });
});
