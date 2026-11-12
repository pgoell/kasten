import type { Page } from "@playwright/test";
import { leader, openApp, openNote, panes, readAll } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** The saved layout of each tab: split direction, zoom, pane count and focused pane, and the active tab. */
const saved = (page: Page) =>
  page.evaluate(() => {
    type Node = { id: string; dir?: string; children?: Node[] };
    const all = (node: Node): Node[] => node.children?.flatMap(all) ?? [node];
    const { layout } = JSON.parse(localStorage.getItem("kasten.workspace.1") ?? "null");
    return {
      active: layout.active as number,
      tabs: (layout.tabs as { root: Node; focus: string; zoom?: boolean }[]).map((tab) => ({
        dir: tab.root.dir ?? null,
        zoom: tab.zoom ?? false,
        leaves: all(tab.root).length,
        focus: all(tab.root).findIndex((leaf) => leaf.id === tab.focus),
      })),
    };
  });

const selected = (page: Page) =>
  readAll(page, '[role="tab"]', (tabs) => tabs.map((tab) => tab.getAttribute("aria-selected")));

/** Opens the palette and runs the row with this name, as vim off reaches every pane command. */
async function runRow(page: Page, name: RegExp) {
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name }).click();
}

test.describe("the pane and tab keys", () => {
  test('Space " splits the pane top and bottom, and the new pane below holds the focus', async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, '"');
    const lower = async () => {
      const [upper, under] = await Promise.all(
        (await panes(page).all()).map((pane) => pane.boundingBox()),
      );
      const focus = await page.locator(".cm-content:focus").boundingBox();
      return !!upper && !!under && !!focus && under.y > upper.y && focus.y >= under.y;
    };
    await expect
      .poll(async () => [await panes(page).count(), await lower(), await saved(page)])
      .toEqual([2, true, { active: 0, tabs: [{ dir: "col", zoom: false, leaves: 2, focus: 1 }] }]);
  });

  test("Space z draws the pane alone, and a second press puts the tab back", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "%");
    await expect(panes(page)).toHaveCount(2);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    const state = async () => [await panes(page).count(), (await saved(page)).tabs[0].zoom];
    await leader(page, "z");
    await expect.poll(state).toEqual([1, true]);
    await leader(page, "z");
    await expect.poll(state).toEqual([2, false]);
  });

  test("Space q on a split closes the note, then the pane, and keeps the tab", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "%");
    await openNote(page, "Long note");
    const state = async () => [
      await panes(page).count(),
      await page.locator(".cm-content", { hasText: "long enough" }).count(),
      await saved(page),
    ];
    await leader(page, "q");
    await expect
      .poll(state)
      .toEqual([2, 0, { active: 0, tabs: [{ dir: "row", zoom: false, leaves: 2, focus: 1 }] }]);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await leader(page, "q");
    await expect
      .poll(state)
      .toEqual([1, 0, { active: 0, tabs: [{ dir: null, zoom: false, leaves: 1, focus: 0 }] }]);
    await expect(page.locator(".cm-content", { hasText: "front door" })).toBeVisible();
  });

  test("Space 1 and Space 2 go to the first and second tab", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "ct");
    await expect.poll(() => selected(page)).toEqual(["false", "true"]);
    await expect(page.locator(".cm-content:focus")).toHaveCount(1);
    await leader(page, "1");
    await expect
      .poll(async () => [await selected(page), (await saved(page)).active])
      .toEqual([["true", "false"], 0]);
    await expect(page.locator(".cm-content:focus", { hasText: "front door" })).toHaveCount(1);
    await leader(page, "2");
    await expect
      .poll(async () => [await selected(page), (await saved(page)).active])
      .toEqual([["false", "true"], 1]);
  });

  test.describe("with vim off", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
    });

    test("the palette row Split the pane left and right splits the pane", async ({ page }) => {
      await openApp(page);
      await openNote(page, "Welcome");
      await expect(page.locator(".cm-vimMode")).toHaveCount(0);
      await runRow(page, /^Split the pane left and right/);
      await expect
        .poll(async () => [await panes(page).count(), await saved(page)])
        .toEqual([2, { active: 0, tabs: [{ dir: "row", zoom: false, leaves: 2, focus: 1 }] }]);
    });

    test("the palette rows Go to tab 1 and Go to tab 2 go to the first and second tab", async ({
      page,
    }) => {
      await openApp(page);
      await openNote(page, "Welcome");
      await runRow(page, /^Create a tab/);
      await expect.poll(() => selected(page)).toEqual(["false", "true"]);
      await runRow(page, /^Go to tab 1(?!\d)/);
      await expect
        .poll(async () => [await selected(page), (await saved(page)).active])
        .toEqual([["true", "false"], 0]);
      await runRow(page, /^Go to tab 2(?!\d)/);
      await expect
        .poll(async () => [await selected(page), (await saved(page)).active])
        .toEqual([["false", "true"], 1]);
    });
  });
});
