import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  hold,
  leader,
  opened,
  openApp,
  openFromTree,
  phone,
  recordOpens,
  vaultWith,
} from "../../../harness/app.ts";
import { root } from "../../../harness/paths.ts";
import { expect, test } from "../../../harness/stack.ts";

// An epub picked in the finder before the notes listing arrives (#2034).
const NOTES = /\/api\/files$/;
const book = (page: Page) => page.locator("[data-book-pane]");

/**
 * Puts a book with its note and one with none in the vault, records each window.open, holds
 * `listing` and loads Welcome by its address, as the tree waits on the notes listing.
 * Waits for the assets, which the finder lists the epubs from.
 */
async function loadHeld(page: Page, vault: string, listing = NOTES, load = openWelcome) {
  const epub = await readFile(join(root, "frontend/tests/fixtures/contents.epub"));
  await vaultWith(vault, { "lit/DDIA.md": "# DDIA\n", "lit/DDIA.epub": epub, "lit/Solo.epub": epub });
  await recordOpens(page);
  const release = await hold(page, listing);
  const assets = page.waitForResponse((response) => response.url().endsWith("/api/vault-assets"));
  await load(page);
  await assets;
  return release;
}

async function openWelcome(page: Page): Promise<void> {
  await page.goto("/?note=Welcome.md");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1, { timeout: 15_000 });
}

/** Opens the finder with Space f f, types `name` and takes the row with Enter. */
async function pick(page: Page, name: string): Promise<void> {
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await finder.getByRole("combobox").fill(name);
  await expect(finder.getByRole("option", { selected: true })).toContainText(`lit/${name}`);
  await page.keyboard.press("Enter");
  await expect(finder).toBeHidden();
}

test("an epub with a note picked while the notes listing loads opens the reader once it arrives", async ({
  page,
  stack,
}) => {
  const release = await loadHeld(page, stack.vault);
  await pick(page, "DDIA.epub");
  await release();
  await expect(book(page)).toBeVisible({ timeout: 15_000 });
  expect(await opened(page)).toEqual([]);
});

test("an epub with no note picked while the notes listing loads opens in a new tab once it arrives", async ({
  page,
  stack,
}) => {
  const release = await loadHeld(page, stack.vault);
  await pick(page, "Solo.epub");
  await release();
  await expect.poll(() => opened(page)).toEqual(["/api/assets/lit/Solo.epub"]);
  await expect(book(page)).toHaveCount(0);
});

test("an epub picked while the notes listing fails opens nothing", async ({ page, stack }) => {
  const release = await loadHeld(page, stack.vault);
  await pick(page, "DDIA.epub");
  const failed = page.waitForEvent("requestfailed", (request) => NOTES.test(request.url()));
  await release(true);
  await failed;
  // One task on, the open's promises have settled, and any tab it asked for is recorded.
  await page.evaluate(() => new Promise((done) => setTimeout(done)));
  expect(await opened(page)).toEqual([]);
  await expect(book(page)).toHaveCount(0);
});

test("an open that waited does not pull back a reader who opened another note in its pane", async ({
  page,
  stack,
}) => {
  // The html listing held, not the notes, so the tree can open the other note while the pick waits.
  const release = await loadHeld(page, stack.vault, /\/api\/html$/, openApp);
  await pick(page, "DDIA.epub");
  await openFromTree(page, "Long note");
  const long = page.getByRole("heading", { name: "Long note", level: 1 });
  await expect(long).toBeVisible();
  await release();
  await expect(book(page)).toHaveCount(0);
  await expect(long).toBeVisible();
});

test.describe("with vim off", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  });

  test("the palette's Find a note and Enter on an epub open the reader once the listing arrives", async ({
    page,
    stack,
  }) => {
    const release = await loadHeld(page, stack.vault);
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("option", { name: /^Find a note/ }).click();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("DDIA.epub");
    await expect(finder.getByRole("option", { selected: true })).toContainText("lit/DDIA.epub");
    await page.keyboard.press("Enter");
    await release();
    await expect(book(page)).toBeVisible({ timeout: 15_000 });
    expect(await opened(page)).toEqual([]);
  });
});

test.describe("on a phone", () => {
  test.use(phone);

  test("a tap on an epub's row opens the reader once the listing arrives", async ({
    page,
    stack,
  }) => {
    const commands = page.getByRole("toolbar", { name: "Commands" });
    const release = await loadHeld(page, stack.vault, NOTES, async () => {
      await page.goto("/?note=Welcome.md");
      await expect(commands).toBeVisible({ timeout: 15_000 });
    });
    await commands.getByRole("button", { name: "Find a note" }).tap();
    const finder = page.getByRole("dialog", { name: "Find note" });
    await finder.getByRole("combobox").fill("DDIA.epub");
    await finder.getByRole("option", { name: /lit\/DDIA\.epub/ }).tap();
    await release();
    await expect(book(page)).toBeVisible({ timeout: 15_000 });
    expect(await opened(page)).toEqual([]);
  });
});
