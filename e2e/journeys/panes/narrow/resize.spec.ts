import type { Page } from "@playwright/test";
import { leader, openApp, openNote, panes } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { saved } from "../workspace/stored.ts";

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 700, height: 800 };

/** The style of each pane on screen that places it: `top` when stacked, `left` side by side. */
const placed = (page: Page, side: "top" | "left") =>
  panes(page).evaluateAll((all, key) => all.map((pane) => pane.style[key]), side);

test.describe("a live window narrowed and widened again", () => {
  test("the open tree shuts under the narrow window and comes back as the wide one left it, open in the store throughout", async ({
    page,
  }) => {
    await openApp(page);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([true, expect.objectContaining({ treeOpen: true })]);

    await page.setViewportSize(NARROW);
    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await page.getByRole("button", { name: "Close file tree" }).count(),
        await saved(page),
      ])
      .toEqual([false, 0, expect.objectContaining({ treeOpen: true })]);

    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([true, expect.objectContaining({ treeOpen: true })]);
    await page.reload();
    await expect(tree(page)).toBeVisible({ timeout: 15_000 });
  });

  test("a tree shut by key in the wide window stays shut through the narrow one, and in the store", async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "b");
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([false, expect.objectContaining({ treeOpen: false })]);

    await page.setViewportSize(NARROW);
    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([false, expect.objectContaining({ treeOpen: false })]);
  });

  test("a split stacks in the narrow window, counts its panes in the bar, and stands side by side once widened", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await page.goto("/");
    const editor = page.locator(".cm-content").first();
    await editor.click({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pane-shown")).toHaveCount(0);

    await leader(page, "%");
    await expect
      .poll(async () => [
        await placed(page, "top"),
        await page.getByTestId("pane-shown").textContent(),
        await page.locator(".cm-content:focus").count(),
      ])
      .toEqual([["0px", "calc(50% + 1px)"], "pane 2/2", 1]);

    await leader(page, "o");
    await expect
      .poll(async () => [
        await panes(page).count(),
        await page.getByTestId("pane-shown").textContent(),
      ])
      .toEqual([2, "pane 1/2"]);

    await page.setViewportSize(WIDE);
    await expect
      .poll(async () => [await placed(page, "left"), await page.getByTestId("pane-shown").count()])
      .toEqual([["0px", "calc(50% + 1px)"], 0]);
  });
});
