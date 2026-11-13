import type { Page } from "@playwright/test";
import { openApp, openNote, vaultWith } from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const ONTOLOGY = "99 Misc/01 Config/01 Agents/Ontology.md";
const FIRST = "# Ontology\n\n## Relations\n\n- invented-here: only this note says so\n";
const EDITED = "# Ontology\n\n## Relations\n\n- rewritten-since: the note was edited\n";

/** Opens a fresh line below in vim's insert mode and asks for every completion there. */
async function offeredOnNewLine(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+G");
  await page.keyboard.press("o");
  await page.keyboard.press("Control+Space");
}

const labels = (page: Page) => page.locator(".cm-tooltip-autocomplete .cm-completionLabel");

test.beforeEach(async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
  await vaultWith(stack.vault, { [ONTOLOGY]: FIRST, "Plain.md": "intro\n" });
  await openApp(page);
  await openNote(page, "Plain");
});

test("a line head offers the relation names the vault's ontology note lists, and no other", async ({
  page,
}) => {
  await offeredOnNewLine(page);
  await expect(labels(page)).toHaveText(["invented-here"]);
  // The name narrows as it is typed, as any completion does.
  await page.keyboard.type("inv");
  await expect(labels(page)).toHaveText(["invented-here"]);
});

test("an edit to the ontology note on disk changes what a line head offers, with no reload", async ({
  page,
  stack,
}) => {
  await offeredOnNewLine(page);
  await expect(labels(page)).toHaveText(["invented-here"]);
  await page.evaluate(() => Object.assign(window, { sameLoad: true }));

  await vaultWith(stack.vault, { [ONTOLOGY]: EDITED });
  // A new line each try: CodeMirror keeps an open list while the prefix still fits it.
  await expect(async () => {
    await offeredOnNewLine(page);
    await expect(labels(page)).toHaveText(["rewritten-since"], { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { sameLoad?: boolean }).sameLoad)).toBe(
    true,
  );
});
