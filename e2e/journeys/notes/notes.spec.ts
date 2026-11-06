import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { leader, noteText, openApp } from "../../harness/app.ts";
import { expect, test } from "../../harness/stack.ts";

/** Opens the note finder, types the name, and opens the first row once the finder has listed it. */
async function findNote(page: Page, name: string): Promise<void> {
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder).toBeVisible();
  await finder.getByRole("combobox").fill(name);
  await expect(finder.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");
}

test("a new note made from the note prompt is written to disk with the typed line", async ({
  page,
  stack,
}) => {
  await openApp(page);
  await leader(page, "cf");
  const prompt = page.getByRole("dialog", { name: "New note" });
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.getByRole("combobox").fill("Plans");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Plans", selected: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.keyboard.type("i");
  await page.keyboard.type("Pack the seed potatoes before Sunday.");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => noteText(stack.vault, "Plans.md"), { timeout: 15_000 })
    .toContain("Pack the seed potatoes before Sunday.");
});

test("renaming a note rewrites the links that named it", async ({ page, stack }) => {
  await openApp(page);
  await findNote(page, "Quote");
  await expect(page.getByRole("tab", { name: "Quote", selected: true })).toBeVisible({
    timeout: 15_000,
  });
  // The keys must reach the editor, which takes the focus after the tab shows.
  await expect(page.locator(".cm-content")).toContainText("The best time");
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await leader(page, "rf");
  const prompt = page.getByRole("dialog", { name: "Rename note" });
  await expect(prompt).toBeVisible({ timeout: 15_000 });
  await prompt.getByRole("combobox").fill("01 Notes/Proverb");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Proverb.md"), { timeout: 15_000 })
    .toContain("The best time to plant a tree");
  await expect.poll(() => readdir(join(stack.vault, "01 Notes"))).not.toContain("Quote.md");
  await expect
    .poll(() => noteText(stack.vault, "01 Notes/Reading.md"), { timeout: 15_000 })
    .toMatch(/\[\[Proverb\]\][\s\S]*!\[\[Proverb\]\]/);
});

test("following a wikilink opens the note it names", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Welcome");
  const editor = page.locator(".cm-editor", { hasText: "front door" });
  await expect(editor).toBeVisible();
  await editor.getByText("Garden", { exact: true }).click({ modifiers: ["Control"] });
  await expect(page.getByRole("tab", { name: "Garden", selected: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("water the tomatoes");
});

test("the backlinks panel lists the note that links to the open one", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Quote");
  await expect(page.getByRole("tab", { name: "Quote", selected: true })).toBeVisible();
  // The keys must reach the editor, which takes the focus once the finder closes.
  await expect(page.locator(".cm-content")).toContainText("The best time");
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
  await leader(page, "gb");
  const panel = page.getByRole("dialog", { name: "Backlinks" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // The backlinks are asked for once the panel opens, which can trail the editor under load.
  await expect(panel).toContainText("Reading", { timeout: 15_000 });
  await expect(panel).toContainText("[[Quote]]");
});

test("an embed draws the text of the note it names inside the note", async ({ page }) => {
  await openApp(page);
  await findNote(page, "Reading");
  await expect(page.getByRole("tab", { name: "Reading", selected: true })).toBeVisible();
  await expect(page.locator(".cm-embed")).toContainText(
    "The best time to plant a tree was twenty years ago.",
  );
});
