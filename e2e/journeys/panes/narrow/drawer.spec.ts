import type { Page } from "@playwright/test";
import { leader, noteText, panes, phone } from "../../../harness/app.ts";
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

  test("Escape shuts the drawer and puts the focus in the focused pane on screen", async ({
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
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => [
        await tree(page).isVisible(),
        await inert(page),
        await panes(page).evaluateAll((all) =>
          all.findIndex((pane) => pane.contains(document.activeElement)),
        ),
        await panes(page).evaluateAll((all) =>
          all.findIndex((pane) =>
            pane.querySelector("[data-focus-line]")?.classList.contains("bg-k-accent"),
          ),
        ),
      ])
      .toEqual([false, 0, 1, 1]);
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
