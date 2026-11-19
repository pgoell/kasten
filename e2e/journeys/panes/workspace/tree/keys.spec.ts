import { leader, openApp, panes } from "../../../../harness/app.ts";
import { expect, test } from "../../../../harness/stack.ts";
import { at, intoTree, row, tree } from "./tree.ts";

// Each key that could pass on a cursor that never moved is followed by a move whose landing tells the two apart.

test("Space e puts the cursor on the first row, j and k stop at both ends, G and gg go to the last and first", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await at(page, "01 Notes");
  await page.keyboard.press("k");
  await page.keyboard.press("j");
  await at(page, "02 Projects");
  await page.keyboard.press("j");
  await at(page, "03 Flashcards");
  await page.keyboard.press("k");
  await at(page, "02 Projects");
  await page.keyboard.press("G");
  await at(page, "Welcome");
  await page.keyboard.press("j");
  await page.keyboard.press("k");
  await at(page, "Long note");
  await page.keyboard.type("gg");
  await at(page, "01 Notes");
  await expect(row(page, "01 Notes")).toBeFocused();
});

test("a g with another key after it moves nothing, and g c opens no prompt and lets the j after it move", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("j");
  await at(page, "02 Projects");
  await page.keyboard.type("gjj");
  await at(page, "03 Flashcards");
  await page.keyboard.type("gcj");
  await at(page, "04 Books");
  await expect(page.getByRole("dialog", { name: "New note" })).toHaveCount(0);
  await page.keyboard.press("G");
  await page.keyboard.type("gg");
  await at(page, "01 Notes");
});

test("h folds an open folder or climbs to its folder, l unfolds, and l and Enter step into an open folder", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("l");
  await expect(row(page, "Lecture")).toBeVisible();
  await at(page, "01 Notes");
  await page.keyboard.press("l");
  await at(page, "Lecture");
  await page.keyboard.press("h");
  await at(page, "01 Notes");
  await expect(row(page, "Lecture")).toBeVisible();
  await page.keyboard.press("h");
  await expect(row(page, "Lecture")).toHaveCount(0);
  await at(page, "01 Notes");
  await page.keyboard.press("Enter");
  await expect(row(page, "Lecture")).toBeVisible();
  await at(page, "01 Notes");
  await page.keyboard.press("Enter");
  await at(page, "Lecture");
});

test("l and Enter open the note under the cursor", async ({ page }) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("l");
  await page.keyboard.press("l");
  await page.keyboard.press("j");
  await at(page, "Quote");
  await page.keyboard.press("l");
  await expect(page.getByRole("tab", { name: "Quote", selected: true })).toBeVisible();
  await intoTree(page);
  await page.keyboard.press("G");
  await page.keyboard.press("k");
  await at(page, "Long note");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Long note", selected: true })).toBeVisible();
});

test("Escape leaves the panel open and q shuts it, each handing the focus to the focused pane, not the first editor", async ({
  page,
}) => {
  await openApp(page);
  await leader(page, "%");
  await expect(panes(page)).toHaveCount(2);
  const second = panes(page).nth(1).locator(".cm-content");
  await expect(second).toBeFocused();

  await intoTree(page);
  await page.keyboard.press("Escape");
  await expect(second).toBeFocused();
  await expect(tree(page)).toBeVisible();

  await intoTree(page);
  await page.keyboard.press("q");
  await expect(tree(page)).toBeHidden();
  await expect(second).toBeFocused();
});

test("Space e takes the focus to the cursor row where it was left, after the panel folds away and back", async ({
  page,
}) => {
  await openApp(page);
  await intoTree(page);
  await page.keyboard.press("j");
  await at(page, "02 Projects");
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await leader(page, "b");
  await expect(tree(page)).toBeHidden();
  await leader(page, "b");
  await expect(row(page, "Welcome")).toBeVisible();
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
  await expect(tree(page).locator(":focus")).toHaveCount(0);
  await intoTree(page);
  await at(page, "02 Projects");
});
