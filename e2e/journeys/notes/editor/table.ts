import type { Page } from "@playwright/test";
import { bodyOf, noteText, openApp, openNote, vaultWith } from "../../../harness/app.ts";
import { expect } from "../../../harness/stack.ts";

// A ragged table as typed by hand, then with `c` typed after its `b`, then that lined up.
export const RAGGED = "| a | longer |\n| - | - |\n| xx | b |\n\nafter";
export const TYPED_C = RAGGED.replace("| xx | b |", "| xx | bc |");
export const LINED = "| a   | longer |\n| --- | ------ |\n| xx  | bc     |\n\nafter";

export type Vim = "on" | "off";

/** Opens `Table.md` holding `text`, the cursor at the end of line `row` (from 0), vim in normal mode. */
export async function rowEnd(page: Page, vault: string, text: string, row: number, vim: Vim) {
  await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
  await vaultWith(vault, { "Table.md": text });
  await openApp(page);
  await openNote(page, "Table");
  await page.locator(".cm-content").getByText("after", { exact: true }).click();
  if (vim === "on") {
    await page.keyboard.press("Escape");
    await page.keyboard.type(`${row + 1}G$`);
    return;
  }
  await page.keyboard.press("Control+Home");
  for (let step = 0; step < row; step++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("End");
}

/** From a row's end, types `text` before its last cell's closing space and pipe. */
export async function typeInLast(page: Page, text: string, vim: Vim) {
  if (vim === "on") {
    await page.keyboard.type(`hi${text}`);
    await page.keyboard.press("Escape");
    return;
  }
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type(text);
}

/** Saves the note by vim's way or the plain one. */
export const SAVE: Record<Vim, (page: Page) => Promise<void>> = {
  off: (page) => page.keyboard.press("Control+s"),
  on: async (page) => {
    await page.keyboard.type(":w");
    await page.keyboard.press("Enter");
  },
};

/** Waits for the first save's frontmatter to reach the editor, when the head names the note's type. */
export const stamped = (page: Page) =>
  expect(page.locator('[data-head="meta"]:visible')).toContainText("Note", { timeout: 15_000 });

/** Polls the note below its frontmatter until it reads `text`. */
export const onDisk = (vault: string, text: string) =>
  expect
    .poll(async () => bodyOf(await noteText(vault, "Table.md")), { timeout: 15_000 })
    .toBe(text);

// Each cell padded to its column, as the line-up writes a table.
export const pad = (rows: string[][]) =>
  rows.map((row) => `| ${row.map((cell, n) => cell.padEnd([3, 6, 3][n] ?? 3)).join(" | ")} |`);
