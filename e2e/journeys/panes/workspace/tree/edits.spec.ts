import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { findNote, leader, openApp, phone, vaultWith } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { at, cursor, intoTree, panel, prompt, row, shut, tree } from "./tree.ts";

const listed = (dir: string) => readdir(dir).then((names) => names.sort());

test("c opens the new note prompt in the cursor's folder, the folder of the cursor's note, or the root", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("c");
  await expect(prompt(page, "New note")).toHaveValue("01 Notes/");
  await shut(page, "New note");
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await at(page, "Lecture");
  await page.keyboard.press("c");
  await expect(prompt(page, "New note")).toHaveValue("01 Notes/");
  await shut(page, "New note");
  await page.keyboard.press("G");
  await at(page, "Welcome");
  await page.keyboard.press("c");
  await expect(prompt(page, "New note")).toHaveValue("");
});

test("r renames the note or the folder under the cursor, a nested folder by its full path", async ({
  page,
  stack,
}) => {
  await vaultWith(stack.vault, { "02 Projects/Garden/Beds.md": "# Beds\n" });
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("j");
  await page.keyboard.press("r");
  await expect(prompt(page, "Rename folder")).toHaveValue("02 Projects");
  await shut(page, "Rename folder");
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(cursor(page)).toHaveAttribute("title", "02 Projects/Garden.md");
  await page.keyboard.press("r");
  await expect(prompt(page, "Rename note")).toHaveValue("02 Projects/Garden.md");
  await shut(page, "Rename note");
  await page.keyboard.press("k");
  await at(page, "Garden");
  await page.keyboard.press("r");
  await expect(prompt(page, "Rename folder")).toHaveValue("02 Projects/Garden");
  await prompt(page, "Rename folder").fill("02 Projects/Plot");
  await page.keyboard.press("Enter");
  await expect(row(page, "Plot")).toBeVisible();
  expect(await listed(join(stack.vault, "02 Projects/Plot"))).toEqual(["Beds.md"]);
});

test("d deletes the note or the folder under the cursor, and the focus stays in the tree for the next key", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("G");
  await page.keyboard.press("k");
  await at(page, "Long note");
  await page.keyboard.press("d");
  await expect(row(page, "Long note")).toHaveCount(0);
  await expect(cursor(page)).toBeFocused();
  await expect.poll(() => listed(stack.vault)).not.toContain("Long note.md");

  await page.keyboard.type("gg");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await at(page, "03 Flashcards");
  await page.keyboard.press("d");
  await expect(row(page, "03 Flashcards")).toHaveCount(0);
  await expect(cursor(page)).toBeFocused();
  await expect.poll(() => listed(stack.vault)).not.toContain("03 Flashcards");
  await page.keyboard.press("k");
  await at(page, "02 Projects");
});

test("f opens the finder and s the content search, whatever row the cursor is on", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("f");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
  await shut(page, "Find note");
  await page.keyboard.press("G");
  await page.keyboard.press("f");
  await expect(page.getByRole("dialog", { name: "Find note" })).toBeVisible();
  await shut(page, "Find note");
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog", { name: "Search notes" })).toBeVisible();
});

test.describe("the leader from the tree, through its panel", () => {
  test("Space and a digit go to that tab, Space c f and Space r f act on the cursor's row, and Space b shuts the tree", async ({
    page,
  }) => {
    await openApp(page);
    await leader(page, "ct");
    await expect(page.getByRole("tab", { selected: true })).toHaveCount(1);
    await expect(page.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await intoTree(page);
    await leader(page, "1");
    await expect(page.getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");

    await intoTree(page);
    await page.keyboard.press("j");
    await leader(page, "cf");
    await expect(prompt(page, "New note")).toHaveValue("02 Projects/");
    await shut(page, "New note");
    // A folder: nothing opens, so the j after it still moves the cursor.
    await leader(page, "rf");
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("j");
    await at(page, "03 Flashcards");
    await page.keyboard.press("k");
    await page.keyboard.press("l");
    await page.keyboard.press("j");
    await expect(cursor(page)).toHaveAttribute("title", "02 Projects/Garden.md");
    await leader(page, "rf");
    await expect(prompt(page, "Rename note")).toHaveValue("02 Projects/Garden.md");
    await shut(page, "Rename note");
    await leader(page, "b");
    await expect(tree(page)).toBeHidden();
  });

  test("Space c waits, Space c x and Space c g drop and keep the cursor, and Space Shift E reveals the open note", async ({
    page,
  }) => {
    await openApp(page);
    await findNote(page, "Garden");
    await intoTree(page);
    await page.keyboard.press("j");
    await leader(page, "c");
    await expect(panel(page).getByLabel("Keys pressed")).toHaveText(/c/);
    await expect(page.getByRole("dialog", { name: "New note" })).toHaveCount(0);
    await page.keyboard.press("x");
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("j");
    await at(page, "03 Flashcards");
    await leader(page, "cg");
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press("j");
    await at(page, "04 Books");
    // Shift's own press comes before the E, as a keyboard sends it.
    await page.keyboard.press("Space");
    await page.keyboard.down("Shift");
    await page.keyboard.press("E");
    await page.keyboard.up("Shift");
    await expect(tree(page).getByTitle("02 Projects/Garden.md")).toBeFocused();
  });
});

test.describe("on a phone with a keyboard, where no panel takes the leader", () => {
  test.use(phone);

  test("the tree's own leader runs: Space c f opens the prompt in the cursor's folder, Space r f does nothing on a folder, Space c x then j moves", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "File tree", exact: true }).tap();
    // The drawer leaves the focus where it was; a keyboard's Tab reaches the cursor row, the tree's one tab stop.
    await cursor(page).focus();
    await expect(cursor(page)).toBeFocused();
    await page.keyboard.press("j");
    await at(page, "02 Projects");
    await leader(page, "cf");
    await expect(prompt(page, "New note")).toHaveValue("02 Projects/");
    await shut(page, "New note");
    await leader(page, "rf");
    await page.keyboard.press("j");
    await at(page, "03 Flashcards");
    await expect(page.getByRole("dialog", { name: "Rename note" })).toHaveCount(0);
    await leader(page, "cx");
    await page.keyboard.press("j");
    await at(page, "04 Books");
  });
});
