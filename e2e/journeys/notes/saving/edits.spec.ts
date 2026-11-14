import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  noteText,
  openApp,
  openFromTree,
  openNote,
  phone,
  vaultWith,
} from "../../../harness/app.ts";
import { expect, test } from "../../../harness/stack.ts";

const TYPED = "A line typed by the e2e test.";

test("an edit reaches the file on disk", async ({ page, stack }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Welcome", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("front door");
  await editor.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go");
  await page.keyboard.type(TYPED);
  await page.keyboard.press("Escape");
  await expect
    .poll(() => readFile(join(stack.vault, "Welcome.md"), "utf8"), { timeout: 15_000 })
    .toContain(TYPED);
});

test("an edit with vim off reaches the file on disk", async ({ page, stack }) => {
  await page.addInitScript(() => localStorage.setItem("kasten.vim", "off"));
  await openApp(page);
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(`\n${TYPED}`);
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .toContain(TYPED);
});

/** The note below its frontmatter, which each save restamps. */
const body = (text: string) =>
  text.startsWith("---\n") ? text.slice(text.indexOf("\n---\n") + 5) : text;

test("u after an edit puts the old text back on disk", async ({ page, stack }) => {
  const before = await noteText(stack.vault, "Welcome.md");
  await openApp(page);
  await openFromTree(page, "Welcome");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("Go");
  await page.keyboard.type(TYPED);
  await page.keyboard.press("Escape");
  // The edit must be on disk first, or a poll for the old text passes before any save.
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .toContain(TYPED);
  await page.keyboard.press("u");
  await expect
    .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
    .not.toContain(TYPED);
  // Byte for byte, so the blank line `o` opened goes too (#1662).
  expect(body(await noteText(stack.vault, "Welcome.md"))).toBe(body(before));
});

// An emoji outside the BMP in the second row puts every cell after it one UTF-16 unit off in code points.
const EMOJI_ROW = "| a | b |\n|---|---|\n| 😀 | x |\n| c | d |\n";
// A right-aligned cell's text sits after its padding, so a walk must land past the spaces.
const RIGHT_ALIGNED = "| a | b |\n|--:|--:|\n| xyz | q |\n";

/** Opens `Table.md` holding `table`, the cursor on the header's `a` with vim in insert mode when on. */
async function intoTable(page: Page, vault: string, table: string, vim: "on" | "off") {
  await page.addInitScript((mode) => localStorage.setItem("kasten.vim", mode), vim);
  await vaultWith(vault, { "Table.md": table });
  await openApp(page);
  await openNote(page, "Table");
  await page.locator(".cm-content").getByText("a", { exact: true }).click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  if (vim === "on") await page.keyboard.press("i");
}

for (const vim of ["off", "on"] as const) {
  test.describe(`a table with vim ${vim}`, () => {
    test("Tab and Shift-Tab land on the cell below an emoji row", async ({ page, stack }) => {
      await intoTable(page, stack.vault, EMOJI_ROW, vim);
      for (let step = 0; step < 4; step++) await page.keyboard.press("Tab");
      await page.keyboard.type("Z");
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.type("Y");
      await expect
        .poll(() => noteText(stack.vault, "Table.md"), { timeout: 15_000 })
        .toMatch(/^\| 😀 +\| Yx +\|\n\| Zc +\| d +\|$/m);
    });

    test("Tab into a right-aligned column lands on the text", async ({ page, stack }) => {
      await intoTable(page, stack.vault, RIGHT_ALIGNED, vim);
      await page.keyboard.press("Tab");
      await page.keyboard.type("Z");
      await expect
        .poll(() => noteText(stack.vault, "Table.md"), { timeout: 15_000 })
        .toMatch(/^\| +a \| +Zb \|$/m);
    });
  });
}

test.describe("on a phone", () => {
  test.use(phone);

  test("an edit typed by touch reaches the file on disk", async ({ page, stack }) => {
    // A phone opens on the Today page, so the note comes from the finder.
    await page.goto("/");
    await page.getByRole("button", { name: "Find a note" }).tap({ timeout: 15_000 });
    await page.getByRole("combobox").fill("Welcome");
    await page
      .getByRole("option", { name: /Welcome/ })
      .first()
      .tap();
    const editor = page.locator(".cm-content", { hasText: "front door" });
    await expect(editor).toBeVisible();
    await editor.tap();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(`\n${TYPED}`);
    await expect
      .poll(() => noteText(stack.vault, "Welcome.md"), { timeout: 15_000 })
      .toContain(TYPED);
  });

  for (const vim of ["off", "on"]) {
    test(`with vim ${vim} the gutter is ${vim === "off" ? "gone, its numbers meaning nothing under a finger" : "there, counting from the cursor"}`, async ({
      page,
      stack,
    }) => {
      if (vim === "on") await page.addInitScript(() => localStorage.setItem("kasten.vim", "on"));
      await vaultWith(stack.vault, { "Lines.md": "one\ntwo\nthree\nfour" });
      await page.goto(`/?note=${encodeURIComponent("Lines.md")}`);
      const editor = page.locator(".cm-editor", { hasText: "three" });
      await expect(editor.locator(".cm-line", { hasText: "four" })).toBeVisible({
        timeout: 15_000,
      });
      if (vim === "off") {
        await expect(editor.locator(".cm-gutters")).toBeHidden();
        return;
      }
      await expect(editor.locator(".cm-gutters")).toBeVisible();
      const numbers = () =>
        editor
          .locator(".cm-lineNumbers .cm-gutterElement")
          .evaluateAll((all) =>
            all
              .filter((n) => (n as HTMLElement).style.visibility !== "hidden")
              .map((n) => n.textContent ?? ""),
          );
      await expect.poll(numbers).toEqual(["1", "1", "2", "3"]);
    });
  }
});
