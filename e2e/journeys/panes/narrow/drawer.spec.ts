import type { Page } from "@playwright/test";
import { leader, noteText, PANE, panes, phone, readAll, tapHeight } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";
import { COARSE, stored } from "../workspace/stored.ts";

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
/** How many parts of the page an open drawer has put out of reach. */
const inert = (page: Page) => page.locator("[inert]").count();

/** Loads the app and waits for the editor of the note it opens on. */
async function load(page: Page) {
  await page.goto("/");
  await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
}

/** Opens the drawer from the phone's toolbar and waits for a tree row to hold the focus. */
async function openDrawer(page: Page) {
  await page.getByRole("button", { name: "File tree", exact: true }).tap();
  await expect(tree(page)).toBeVisible();
}

test.describe("the tree's drawer in a narrow window under a mouse", () => {
  test.use({ viewport: { width: 700, height: 800 } });

  test("the status bar is out of reach while the drawer is open", async ({ page }) => {
    await load(page);
    // Inside `main` the bar's footer is no landmark, so no role finds it.
    const status = page.locator("main > footer");
    await expect(status).toBeVisible();
    await expect(status).not.toHaveAttribute("inert");

    await page.getByRole("button", { name: "Show file tree" }).click();

    await expect(tree(page)).toBeVisible();
    await expect(status).toHaveAttribute("inert");
  });

  // `q` closes the drawer itself before it hands the focus on, so each key gets its own run.
  for (const key of ["Escape", "q"]) {
    test(`${key} shuts the drawer and puts the focus in the focused pane on screen`, async ({
      page,
    }) => {
      await load(page);
      await page.locator(".cm-content").first().click();
      await page.keyboard.press("Escape");
      // Two panes with the second focused, so the first editor in the page is not the one to land in.
      await leader(page, "%");
      await expect(panes(page)).toHaveCount(2);

      await page.getByRole("button", { name: "Show file tree" }).click();
      await expect
        .poll(async () => [await tree(page).isVisible(), (await inert(page)) > 0])
        .toEqual([true, true]);
      await tree(page).getByRole("button", { name: "Welcome", exact: true }).focus();
      await page.keyboard.press(key);

      await expect
        .poll(async () => [
          await tree(page).isVisible(),
          await inert(page),
          await readAll(page, PANE, (all) =>
            all.findIndex((pane) => pane.contains(document.activeElement)),
          ),
          await readAll(page, PANE, (all) =>
            all.findIndex((pane) =>
              pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent"),
            ),
          ),
        ])
        .toEqual([false, 0, 1, 1]);
    });
  }

  test("the rail is out of reach under the open drawer, and a click outside shuts the drawer and brings the rail back", async ({
    page,
  }) => {
    await load(page);
    // The rail comes first in the page, ahead of the drawer's own toggle.
    const rail = page.locator("button[title$='file tree (Space B)']").first().locator("..");
    await expect(rail).not.toHaveAttribute("inert");

    await page.getByRole("button", { name: "Show file tree" }).click();
    await expect(tree(page)).toBeVisible();
    await expect(rail).toHaveAttribute("inert");
    // The backdrop's middle lies right of the 288 px drawer in a 700 px window.
    await page.getByRole("button", { name: "Close file tree" }).click();

    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await page.getByRole("button", { name: "Show file tree" }).isVisible(),
      ])
      .toEqual([false, true]);
    await expect(rail).not.toHaveAttribute("inert");
  });
});

test.describe("the tree's drawer on a phone", () => {
  test.use(phone);

  test("starts shut with no rail, and shuts again on the note a tap opens, which the coarse key stores", async ({
    page,
  }) => {
    await load(page);
    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await page.getByRole("button", { name: "Show file tree" }).count(),
      ])
      .toEqual([false, 0]);

    await openDrawer(page);
    await tree(page).getByRole("button", { name: "Long note", exact: true }).tap();

    await expect
      .poll(async () => [
        await page.locator(".cm-content", { hasText: "long enough" }).count(),
        await tree(page).isVisible(),
        (await stored(page, COARSE)) ?? "",
      ])
      .toEqual([1, false, expect.stringContaining("Long note.md")]);
  });

  test("the drawer's rows and buttons are 44 px under a finger, and the drawer has no grip and its own width", async ({
    page,
  }) => {
    await load(page);
    await openDrawer(page);
    const drawer = page.locator("aside");
    await expect(tree(page).getByRole("button", { name: "Welcome", exact: true })).toBeVisible();
    const rows = await page.locator("[data-row]").all();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(await tapHeight(row)).toBeGreaterThanOrEqual(44);
    for (const name of ["New note", "Hide file tree"]) {
      const button = drawer.getByRole("button", { name });
      expect(await tapHeight(button)).toBeGreaterThanOrEqual(44);
      expect((await button.boundingBox())?.width).toBeGreaterThanOrEqual(44);
    }

    await expect(page.getByRole("separator", { name: "Resize file tree" })).toHaveCount(0);
    await expect(drawer).toHaveCSS("position", "fixed");
    // `w-72`, not the 256 px a wide window's panel starts at.
    expect((await drawer.boundingBox())?.width).toBe(288);
  });

  test("a tap outside the drawer shuts it and leaves no rail, the toolbar being the way back in", async ({
    page,
  }) => {
    await load(page);
    await openDrawer(page);
    // Right of the 288 px drawer: the backdrop's own middle lies under the drawer.
    await page.touchscreen.tap(380, 448);

    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await page.getByRole("button", { name: "Close file tree" }).count(),
        await page.getByRole("button", { name: "Show file tree" }).count(),
      ])
      .toEqual([false, 0, 0]);
  });

  test("the toolbar is out of reach while the drawer is open", async ({ page }) => {
    await load(page);
    const bar = page.getByRole("toolbar", { name: "Commands" });
    await expect(bar).not.toHaveAttribute("inert");

    await openDrawer(page);

    await expect(bar).toHaveAttribute("inert");
  });

  test("the drawer shuts on the note its own New note button makes, and the note is on disk", async ({
    page,
    stack,
  }) => {
    await load(page);
    await openDrawer(page);
    // The tab strip has a New note button too, so the drawer's own is found inside its aside.
    await page.locator("aside").getByRole("button", { name: "New note" }).tap();
    const name = page.getByRole("dialog", { name: "New note" }).getByRole("combobox");
    await expect(name).toBeFocused();
    await name.fill("fresh");
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => [
        await page.getByRole("tab", { name: "fresh", selected: true }).count(),
        await tree(page).isVisible(),
        (await noteText(stack.vault, "fresh.md")) !== "",
      ])
      .toEqual([1, false, true]);
  });

  test("the drawer stays open under the finder its f key opens, and shuts on the note the finder opens", async ({
    page,
  }) => {
    await load(page);
    await openDrawer(page);
    const row = tree(page).getByRole("button", { name: "Long note", exact: true });
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press("f");
    const finder = page.getByRole("dialog", { name: "Find note" });
    await expect
      .poll(async () => [await finder.isVisible(), await tree(page).isVisible()])
      .toEqual([true, true]);
    await expect(finder.getByRole("combobox")).toBeFocused();
    await finder.getByRole("combobox").fill("Long note");
    await expect(finder.getByRole("option").first()).toContainText("Long note");
    await page.keyboard.press("Enter");

    await expect
      .poll(async () => [
        await finder.count(),
        await tree(page).isVisible(),
        await page.locator(".cm-content", { hasText: "long enough" }).count(),
      ])
      .toEqual([0, false, 1]);
  });
});
