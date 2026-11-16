import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { bodyOf, findNote, leader, noteText, openApp, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

// Every sequence runs from the editor with vim on, the desktop's default: with vim off,
// as on a phone, the editor takes no leader and the palette holds the same rows.

const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
const row = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const book = (page: Page) => page.locator("[data-book-pane]");
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Waits for the editor to hold the focus, as keys sent sooner are lost (#1615). */
async function inEditor(page: Page): Promise<void> {
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** Shuts the dialog that holds the focus and waits for the editor to take it back. */
async function shut(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await inEditor(page);
}

test("b folds the tree and b unfolds it, and e unfolds it with the focus in it", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "b");
  await expect(tree(page)).toBeHidden();
  await leader(page, "b");
  await expect(tree(page)).toBeVisible();
  await leader(page, "b");
  await expect(tree(page)).toBeHidden();
  await leader(page, "e");
  await expect(tree(page).locator(":focus")).toHaveCount(1);
});

test("E puts the focus on the open note's row in its folded folder, where e lands elsewhere", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Garden");
  await expect(row(page, "Garden")).toHaveCount(0);
  await leader(page, "e");
  await expect(tree(page).locator(":focus")).toHaveCount(1);
  await expect(row(page, "Garden")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  await leader(page, "E");
  await expect(row(page, "Garden")).toBeFocused();
});

test("q closes the open note and ? opens the key help", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Garden");
  await leader(page, "q");
  await expect(page.getByRole("tab", { name: "Garden" })).toHaveCount(0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  await leader(page, "?");
  await expect(dialog(page, "Keyboard shortcuts")).toBeVisible();
});

test("ff, fg and ft each open their own finder and neither of the other two", async ({ page }) => {
  await openApp(page);
  const search = page.getByRole("combobox", { name: "search notes" });
  await leader(page, "ff");
  await expect(dialog(page, "Find note")).toBeVisible();
  await shut(page);
  await leader(page, "fg");
  await expect(search).toBeFocused();
  await expect(dialog(page, "Find note")).toHaveCount(0);
  await shut(page);
  await leader(page, "ft");
  await expect(dialog(page, "Todos")).toBeVisible();
  await expect(dialog(page, "Find note")).toHaveCount(0);
  await expect(search).toHaveCount(0);
});

test("gs opens the review and no book beside Primer, and gr opens Primer's book", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Primer");
  await leader(page, "gs");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await expect(book(page)).toHaveCount(0);
  await findNote(page, "Primer");
  await leader(page, "gr");
  await expect(book(page)).toBeVisible();
});

test("gc opens the book the reading note names, from a note with no book of its own", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "99 Misc/01 Config/reading-now.md": "[[Primer]]\n" });
  await openApp(page);
  await findNote(page, "Welcome");
  await leader(page, "gc");
  await expect(book(page)).toBeVisible();
});

test("gb opens the backlinks with the tree still shown, and go the links out with no backlinks", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "gb");
  await expect(dialog(page, "Backlinks")).toContainText("Reading", { timeout: 15_000 });
  await expect(tree(page)).toBeVisible();
  await shut(page);
  await leader(page, "go");
  await expect(dialog(page, "Outgoing links")).toBeVisible();
  await expect(dialog(page, "Backlinks")).toHaveCount(0);
});

test("cf opens New note on the vault root, rf Rename note on the open note, cb the book picker", async ({
  page,
}) => {
  await openApp(page);
  await findNote(page, "Quote");
  await leader(page, "cf");
  await expect(dialog(page, "New note").getByRole("combobox")).toHaveValue("");
  await shut(page);
  await leader(page, "rf");
  await expect(dialog(page, "Rename note").getByRole("combobox")).toHaveValue("01 Notes/Quote.md");
  await shut(page);
  const chooser = page.waitForEvent("filechooser");
  await leader(page, "cb");
  expect(await (await chooser).element().getAttribute("accept")).toContain(".epub");
});

test("df deletes the open note and du brings it back", async ({ page, stack }) => {
  const seeds = join(stack.vault, "01 Notes/Seeds.md");
  await openApp(page);
  await findNote(page, "Seeds");
  await leader(page, "df");
  await expect.poll(() => exists(seeds)).toBe(false);
  await expect(page.getByRole("tab", { name: "Seeds" })).toHaveCount(0);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await inEditor(page);
  await leader(page, "du");
  await expect(page.getByRole("tab", { name: "Seeds", selected: true })).toBeVisible();
  await expect.poll(() => exists(seeds)).toBe(true);
});

test("dd stays vim's delete line and deletes no note", async ({ page, stack }) => {
  await vaultWith(stack.vault, { "Lines.md": "first line\nsecond line\n" });
  await openApp(page);
  await findNote(page, "Lines");
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await page.keyboard.press("d");
  await expect
    .poll(() => noteText(stack.vault, "Lines.md").then(bodyOf), { timeout: 15_000 })
    .toBe("second line\n");
  await expect(page.getByRole("tab", { name: "Lines", selected: true })).toBeVisible();
});
