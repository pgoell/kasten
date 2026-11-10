import type { Page } from "@playwright/test";
import { leader, openApp, openNote, panes, phone } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { COARSE, FINE, load, saved, seed, selectedTab, stored } from "./stored.ts";

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const NARROW = { width: 700, height: 800 };

/** Reloads and waits for the editor holding `text`, then hands it the keys. */
async function reload(page: Page, text: string) {
  await page.reload();
  const editor = page.locator(".cm-content", { hasText: text });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.click();
  await page.keyboard.press("Escape");
}

test.describe("the workspace across a reload", () => {
  test("the splits, tabs, focus and zoom made by keys come back, and the page writes the same layout back", async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "%");
    await expect(panes(page)).toHaveCount(2);
    await openNote(page, "Long note");
    await leader(page, "z");
    await expect(panes(page)).toHaveCount(1);
    await leader(page, "ct");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await openNote(page, "Welcome");
    await expect
      .poll(() => saved(page))
      .toMatchObject({
        active: 1,
        tabs: [{ zoom: true, focus: 1, root: { dir: "row" } }, { focus: 0 }],
      });
    const before = await saved(page);

    await reload(page, "front door");
    await expect
      .poll(async () => [
        await page.getByRole("tab").count(),
        await selectedTab(page),
        await saved(page),
      ])
      .toEqual([2, expect.stringContaining("Welcome"), before]);
    await leader(page, "1");
    // The first tab is still zoomed on its focused pane, Long note on the right.
    await expect
      .poll(async () => [
        await panes(page).count(),
        await panes(page).filter({ hasText: "long enough" }).count(),
        (await page.locator(".cm-content:focus", { hasText: "long enough" }).count()) > 0,
      ])
      .toEqual([1, 1, true]);
  });

  test("the tree shut on a desktop stays shut, opens again by key, and a narrow window starts it shut", async ({
    page,
  }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "b");
    await expect(tree(page)).toBeHidden();
    await expect.poll(() => saved(page)).toMatchObject({ treeOpen: false });

    await reload(page, "front door");
    await expect(tree(page)).toBeHidden();
    await leader(page, "b");
    await expect
      .poll(async () => [await tree(page).isVisible(), await saved(page)])
      .toEqual([true, expect.objectContaining({ treeOpen: true })]);

    await page.setViewportSize(NARROW);
    await reload(page, "front door");
    await expect(tree(page)).toBeHidden();
  });

  test("a narrow window loaded in between leaves the desktop's open tree open", async ({
    page,
    context,
  }) => {
    await openApp(page);
    await expect(tree(page)).toBeVisible();
    await page.goto("about:blank");
    // A second window, narrow from its first load; a live resize is narrow/resize.spec.ts.
    const narrow = await context.newPage();
    await narrow.setViewportSize(NARROW);
    await narrow.goto("/");
    await expect(narrow.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => [await tree(narrow).isVisible(), await saved(narrow)])
      .toEqual([false, expect.objectContaining({ treeOpen: true })]);
    await narrow.close();

    await page.goto("/");
    await expect(tree(page)).toBeVisible({ timeout: 15_000 });
  });

  test("a broken saved workspace starts clean and is written over", async ({ page }) => {
    await seed(page, { [FINE]: "{not json" });
    await load(page);
    await expect
      .poll(async () => [await tree(page).isVisible(), await panes(page).count(), await saved(page)])
      .toEqual([true, 1, expect.objectContaining({ tabs: [expect.objectContaining({ focus: 0 })] })]);
  });

  test("storage refusing every touch of the workspace still starts the app and opens a note", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const tried: string[] = [];
      (window as unknown as { tried: string[] }).tried = tried;
      const { getItem, setItem } = Storage.prototype;
      const refused = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Storage.prototype.getItem = function (key) {
        if (key.startsWith("kasten.workspace")) refused();
        return getItem.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("kasten.workspace")) {
          tried.push(key);
          refused();
        }
        setItem.call(this, key, value);
      };
    });
    await openApp(page);
    await openNote(page, "Long note");
    await expect(page.locator(".cm-content", { hasText: "long enough" })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { tried: string[] }).tried))
      .toContain(FINE);
  });

  test("the x on the active tab closes it, and Today goes to the empty tab", async ({ page }) => {
    await openApp(page);
    await openNote(page, "Welcome");
    await leader(page, "ct");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await page.getByRole("button", { name: "Close New tab" }).click();
    await expect
      .poll(async () => [
        await page.getByRole("tab").count(),
        await page.locator(".cm-content", { hasText: "front door" }).count(),
        ((await saved(page)) as { tabs: unknown[] }).tabs.length,
      ])
      .toEqual([1, 1, 1]);

    await page.locator(".cm-content").first().click();
    await page.keyboard.press("Escape");
    await leader(page, "ct");
    await expect(page.getByRole("tab")).toHaveCount(2);
    await leader(page, "1");
    await expect(page.getByRole("tab", { name: "Welcome", selected: true })).toBeVisible();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect
      .poll(async () => [
        await selectedTab(page),
        await page.getByRole("tab").count(),
        ((await saved(page)) as { active: number }).active,
      ])
      .toEqual([expect.stringContaining("New tab"), 2, 1]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a note opened by a tap comes back, under the coarse pointer's key, with the tree shut", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "File tree" }).tap({ timeout: 15_000 });
    await page.getByRole("button", { name: "Long note", exact: true }).tap();
    await expect(page.locator(".cm-content", { hasText: "long enough" })).toBeVisible();

    await page.reload();
    await expect(page.locator(".cm-content", { hasText: "long enough" })).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => [
        (await stored(page, COARSE)) ?? "",
        await stored(page, FINE),
        await tree(page).isVisible(),
      ])
      .toEqual([expect.stringContaining("Long note.md"), null, false]);
  });
});
