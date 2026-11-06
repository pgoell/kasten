import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { leader, openApp } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const primer = "04 Books/Primer.md";

test("the book pane reopens a pdf at the page it was left on", async ({ page, stack }) => {
  await openApp(page);
  await leader(page, "ff");
  await page.keyboard.type("Primer");
  await page.keyboard.press("Enter");
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

  // Closing the reader writes the place into the note's frontmatter.
  await page.keyboard.press("q");
  await expect(pane).toHaveCount(0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() => readFile(join(stack.vault, primer), "utf8"), { timeout: 15_000 })
    .toMatch(/^reading: epubcfi\(/m);

  await leader(page, "gr");
  await expect(page.locator("[data-book-pane]").getByText("50%", { exact: true })).toBeVisible();
});
