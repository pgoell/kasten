import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

/** Loads the app and waits until the tree lists the vault and the editor holds the focus. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  // The first load parses the whole bundle, which takes past 5 s on a loaded box (#1615).
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
}

/** Presses Space and then each key, as vim's normal mode reads a leader sequence. */
export async function leader(page: Page, keys: string): Promise<void> {
  await page.keyboard.press("Space");
  for (const key of keys) await page.keyboard.press(key);
}

/**
 * Opens the note finder, types the name, and opens the first row once the finder has listed it.
 * Returns once the note's tab is selected and an editor holds the focus: keys sent sooner are lost on a loaded box (#1615).
 */
export async function findNote(page: Page, name: string): Promise<void> {
  await leader(page, "ff");
  const finder = page.getByRole("dialog", { name: "Find note" });
  await expect(finder).toBeVisible();
  await finder.getByRole("combobox").fill(name);
  await expect(finder.getByRole("option").first()).toContainText(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible({ timeout: 15_000 });
  // `:focus` rather than toBeFocused, which fails outright when two panes each hold an editor.
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** Opens a note from the file tree at the vault's top level. */
export async function openFromTree(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
}

/** A phone as `test.use` takes it: 414 px wide, a finger for a pointer, so vim starts off. */
export const phone = { viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true };

/** A local date as `YYYY-MM-DD`, the way the browser names a daily note. */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Today's date on this box, as the browser names the daily note it sends. */
export const today = (): string => localDate(new Date());

/** A note in the test's vault, or "" while it is not there, so a poll waits for the write. */
export async function noteText(vault: string, path: string): Promise<string> {
  try {
    return await readFile(join(vault, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** The panes on screen; a pane on its way out is hidden. */
export const panes = (page: Page): Locator => page.locator("[data-pane]:visible");

/** Opens a note from the tree and waits for its editor's focus: keys sent sooner are lost (#1738). */
export async function openNote(page: Page, name: string): Promise<void> {
  await openFromTree(page, name);
  await expect(page.locator(".cm-content:focus")).toHaveCount(1);
}

/** A note's text without the id and stamps the vault writes into its frontmatter. */
export const unstamped = (text: string): string =>
  text.replace(/^(id|created|modified): .*\n/gm, "");
