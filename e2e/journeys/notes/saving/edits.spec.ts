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

// A ragged table as typed by hand, then with `c` typed after its `b`, then that lined up.
const RAGGED = "| a | longer |\n| - | - |\n| xx | b |\n\nafter";
const TYPED_C = RAGGED.replace("| xx | b |", "| xx | bc |");
const LINED = "| a   | longer |\n| --- | ------ |\n| xx  | bc     |\n\nafter";

/** Opens `Table.md` holding `text`, the cursor at the end of line `row` (from 0). */
async function rowEnd(page: Page, vault: string, text: string, row: number, vim: "on" | "off") {
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

/** Polls the note below its frontmatter until it reads `text`. */
const onDisk = (vault: string, text: string) =>
  expect
    .poll(async () => body(await noteText(vault, "Table.md")), { timeout: 15_000 })
    .toBe(text);

test.describe("the table line-up takes only what the reader typed into (#792)", () => {
  test("Enter at the end of the last row, vim off, leaves the table as it is", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, RAGGED.replace("| xx | b |", "| xx | b |\n"));
  });

  test("o at the end of the last row and dd above the head, vim on, leave the table as it is", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, `above\n${RAGGED}`, 3, "on");
    await page.keyboard.type("o");
    await page.keyboard.press("Escape");
    await page.keyboard.type("ggdd");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, RAGGED.replace("| xx | b |", "| xx | b |\n"));
  });

  test("dap on one table, vim on, leaves the next as it is", async ({ page, stack }) => {
    const second = "| e | longer |\n| - | - |\n| xx | y |\n\nafter";
    await rowEnd(page, stack.vault, `| a | b |\n| - | - |\n| c | d |\n\n${second}`, 0, "on");
    await page.keyboard.type("dap");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, second);
  });

  test("type, u, then leave, vim on, keeps the table byte for byte", async ({ page, stack }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "on");
    await page.keyboard.type("hic");
    await page.keyboard.press("Escape");
    await page.keyboard.type("u");
    // Out of the table, then an edit below it, so a save provably lands after the leave.
    await page.keyboard.type("GA!");
    await page.keyboard.press("Escape");
    await onDisk(stack.vault, `${RAGGED}!`);
  });

  test("leave by an arrow key, ctrl+z, then save, vim off, keeps the ragged table", async ({
    page,
    stack,
  }) => {
    await rowEnd(page, stack.vault, RAGGED, 2, "off");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("c");
    await page.keyboard.press("ArrowDown");
    await onDisk(stack.vault, LINED);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+s");
    await onDisk(stack.vault, TYPED_C);
  });

  test("a list line with a pipe under a table, vim off, is left as it is", async ({
    page,
    stack,
  }) => {
    const listed = RAGGED.replace("| xx | b |\n", "| xx | b |\n- note | x\n");
    await rowEnd(page, stack.vault, listed, 2, "off");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("c");
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+s");
    const lined = LINED.replace("| xx  | bc     |\n", "| xx  | bc     |\n- note | x\n");
    await onDisk(stack.vault, lined);
  });
});

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
