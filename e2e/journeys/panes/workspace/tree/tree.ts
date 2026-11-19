import type { Page } from "@playwright/test";
import { leader } from "../../../../harness/app.ts";
import { expect } from "../../../../harness/stack.ts";

export const tree = (page: Page) => page.getByRole("navigation", { name: "Vault" });
export const row = (page: Page, name: string) =>
  tree(page).getByRole("button", { name, exact: true });
/** The row the tree's keys act on, its one tab stop, whether or not the tree holds the focus. */
export const cursor = (page: Page) => tree(page).locator('[data-row][tabindex="0"]');
export const prompt = (page: Page, name: string) =>
  page.getByRole("dialog", { name }).getByRole("combobox");
export const panel = (page: Page) => page.getByRole("dialog", { name: "Leader keys" });

/** The cursor sits on the row of this name. */
export async function at(page: Page, name: string): Promise<void> {
  await expect(cursor(page)).toHaveAccessibleName(name);
}

/** Space e: the focus goes to the tree's cursor row. */
export async function intoTree(page: Page): Promise<void> {
  await leader(page, "e");
  await expect(cursor(page)).toBeFocused();
}

/** Shuts the prompt by Escape and waits for the focus to come back to the cursor row. */
export async function shut(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name })).toHaveCount(0);
  await expect(cursor(page)).toBeFocused();
}
