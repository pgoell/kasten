import type { Locator, Page } from "@playwright/test";
import { findNote, leader, openApp, openFromTree } from "../harness/app.ts";
import { expect, test } from "../harness/stack.ts";

const panes = (page: Page): Locator => page.locator("[data-pane]:visible");

/** The panes' boxes, leftmost first, once each has settled on screen. */
async function boxes(page: Page) {
  const found = await Promise.all((await panes(page).all()).map((pane) => pane.boundingBox()));
  return found.filter((box) => box !== null).sort((a, b) => a.x - b.x || a.y - b.y);
}

test("a split keeps the editor and its note", async ({ page }) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  const editor = page.locator(".cm-editor", { hasText: "front door" });
  await editor.click();
  await page.keyboard.press("Escape");
  // A mark on the DOM node: a remounted editor would come back without it.
  await editor.evaluate((node) => node.setAttribute("data-e2e-kept", "yes"));
  await leader(page, "%");
  // The new pane opens on the day page beside the note.
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await expect(page.locator(".cm-editor")).toHaveCount(2);
  await expect(page.locator(".cm-editor[data-e2e-kept=yes]")).toContainText("front door");
});

test("a split right and a split down make three panes, one beside and one below", async ({
  page,
}) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  await leader(page, '"');
  await expect(panes(page)).toHaveCount(3);
  // The Welcome pane stands on the left; the other two stand right of it, one above the other.
  await expect
    .poll(async () => {
      const [left, upper, lower] = await boxes(page);
      return (
        upper !== undefined &&
        lower !== undefined &&
        upper.x > left.x + left.width - 1 &&
        Math.abs(upper.x - lower.x) < 2 &&
        lower.y > upper.y + upper.height - 1
      );
    })
    .toBe(true);
});

test("a close takes the empty pane away and leaves Welcome", async ({ page }) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  // The new pane is empty, so the first q closes it.
  await leader(page, "q");
  await expect(panes(page)).toHaveCount(1);
  await expect(page.locator(".cm-editor", { hasText: "front door" })).toBeVisible();
});

test("the panes and their notes are back after a reload", async ({ page }) => {
  await openApp(page);
  await openFromTree(page, "Welcome");
  await leader(page, "%");
  await findNote(page, "Garden");
  await expect(page.locator(".cm-editor", { hasText: "water the tomatoes" })).toBeVisible();
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  await expect(panes(page).filter({ hasText: "front door" })).toHaveCount(1);
  await expect(panes(page).filter({ hasText: "water the tomatoes" })).toHaveCount(1);
});
