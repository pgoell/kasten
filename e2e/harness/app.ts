import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

/** Loads the app and waits until the tree lists the vault and the editor holds the focus. */
export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Welcome", exact: true })).toBeVisible();
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Escape");
}

/** Presses Space and then each key, as vim's normal mode reads a leader sequence. */
export async function leader(page: Page, keys: string): Promise<void> {
  await page.keyboard.press("Space");
  for (const key of keys) await page.keyboard.press(key);
}

/** Opens a note from the file tree at the vault's top level. */
export async function openFromTree(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, selected: true })).toBeVisible();
}

/** A phone as `test.use` takes it: 414 px wide, a finger for a pointer, so vim starts off. */
export const phone = { viewport: { width: 414, height: 896 }, hasTouch: true, isMobile: true };

/** Today's date on this box, as the daily note is named; the backend runs on the same clock. */
export function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A note in the test's vault, or "" while it is not there, so a poll waits for the write. */
export async function noteText(vault: string, path: string): Promise<string> {
  try {
    return await readFile(join(vault, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
